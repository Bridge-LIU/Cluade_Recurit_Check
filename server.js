// Bridge — server.js
// 本地小程序：localhost:3939。引擎は `claude -p` を子プロセスで叩く。

import express from 'express';
import multer from 'multer';
import { spawn, exec } from 'child_process';
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';

import { readQuestions, writeQuestions, readAnswers, writeAnswers, defaultDispatch } from './server/lib/questions-store.js';
import { loadSettings, loadSurveyConfig, saveSettings, saveSurveyConfig } from './server/lib/settings.js';
import { expandTemplate, buildTemplateVars } from './server/lib/template.js';
import { createSurvey, fetchResult, closeSurvey } from './server/lib/survey-client.js';
import { startPoller } from './server/lib/poller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3939;
const ROOT = __dirname;
const DIRS = {
  presets: path.join(ROOT, 'presets'),
  requirements: path.join(ROOT, 'requirements'),
  reports: path.join(ROOT, 'reports'),
  questions: path.join(ROOT, 'questions'),
  processed: path.join(ROOT, 'processed'),
  templates: path.join(ROOT, 'templates'),
  public: path.join(ROOT, 'public'),
};

for (const d of Object.values(DIRS)) {
  if (!fssync.existsSync(d)) fssync.mkdirSync(d, { recursive: true });
}

const app = express();
app.use(express.json({ limit: '10mb' }));

// index.html はアセットの mtime をバージョンクエリとして注入し、
// app.js / styles.css を編集するたびにブラウザが必ず新版を取得するようにする。
// （express.static より前に登録して「/」「/index.html」の配信を上書き）
app.get(['/', '/index.html'], (req, res) => {
  const indexPath = path.join(DIRS.public, 'index.html');
  try {
    let html = fssync.readFileSync(indexPath, 'utf8');
    const ver = (f) => {
      try { return Math.floor(fssync.statSync(path.join(DIRS.public, f)).mtimeMs); }
      catch { return '0'; }
    };
    html = html
      .replace('/app.js', `/app.js?v=${ver('app.js')}`)
      .replace('/styles.css', `/styles.css?v=${ver('styles.css')}`);
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html);
  } catch (e) {
    res.sendFile(indexPath);
  }
});

// 静的アセットは常に再検証（古い app.js / styles.css のキャッシュ事故を防ぐ）
app.use(express.static(DIRS.public, {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
// 旧 URL（/reports/<id>.html）→ ディスク上の slug 名へ透過リライト。
// 既に slug 付きファイル名で来た場合は static 配信にそのまま委ねる。
app.use('/reports', (req, res, next) => {
  const m = req.path.match(/^\/([A-Za-z0-9_-]{1,64})\.(html|json)$/);
  if (!m) return next();
  const direct = path.join(DIRS.reports, `${m[1]}.${m[2]}`);
  if (fssync.existsSync(direct)) return next();
  let entries;
  try { entries = fssync.readdirSync(DIRS.reports); }
  catch { return next(); }
  const suffix = `_${m[1]}.${m[2]}`;
  const hit = entries.find((f) => f.endsWith(suffix));
  if (hit) req.url = '/' + hit;
  next();
});
app.use('/reports', express.static(DIRS.reports));

const upload = multer({ dest: path.join(DIRS.processed, '_tmp') });

// ---------- ヘルパ ----------

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const yaml = m[1];
  const body = m[2] || '';
  const meta = {};
  let currentKey = null;
  let currentObj = null;
  let currentArr = null;
  for (const raw of yaml.split('\n')) {
    if (!raw.trim()) continue;
    const indented = raw.startsWith('  ');
    if (!indented) {
      const km = raw.match(/^([^:]+):\s*(.*)$/);
      if (!km) continue;
      currentKey = km[1].trim();
      const val = km[2].trim();
      if (val === '' || val === '{}' || val === '[]') {
        if (val === '[]') { meta[currentKey] = []; currentArr = meta[currentKey]; currentObj = null; }
        else { meta[currentKey] = {}; currentObj = meta[currentKey]; currentArr = null; }
      } else {
        meta[currentKey] = stripQuote(val);
        currentObj = null; currentArr = null;
      }
    } else {
      const line = raw.slice(2);
      if (line.startsWith('- ')) {
        if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
        meta[currentKey].push(stripQuote(line.slice(2).trim()));
      } else {
        const km = line.match(/^([^:]+):\s*(.*)$/);
        if (km && currentObj) {
          const v = stripQuote(km[2].trim());
          currentObj[km[1].trim()] = isNaN(Number(v)) ? v : Number(v);
        }
      }
    }
  }
  return { meta, body };
}

function stripQuote(v) {
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
}

function toYaml(meta) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v === null || v === undefined) { lines.push(`${k}: ""`); continue; }
    if (Array.isArray(v)) {
      if (v.length === 0) lines.push(`${k}: []`);
      else { lines.push(`${k}:`); for (const it of v) lines.push(`  - ${it}`); }
    } else if (typeof v === 'object') {
      lines.push(`${k}:`);
      for (const [k2, v2] of Object.entries(v)) lines.push(`  ${k2}: ${v2}`);
    } else {
      lines.push(`${k}: ${typeof v === 'string' ? `"${v.replace(/"/g, '\\"')}"` : v}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// ---------- レポート ファイル名ヘルパ ----------
// レポートはディスク上で `<氏名>_<職種>_<YYYYMMDD>_<id>.json/html` の形で保存する。
// id はファイル末尾の `_<id>.<ext>` で API から逆引きできる。旧 `<id>.json` も互換で読める。

function sanitizeForFilename(s) {
  if (!s) return '';
  return String(s)
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 50);
}

function buildReportSlug(json, originalBasename = '') {
  const id = json.id;
  const iso = json.createdAt || new Date().toISOString();
  const dateStr = iso.slice(0, 10).replace(/-/g, '');
  const namePart = json.name && String(json.name).trim()
    ? sanitizeForFilename(json.name)
    : `匿名_${sanitizeForFilename(originalBasename) || id}`;
  const posPart = sanitizeForFilename(json.position || '');
  return [namePart, posPart, dateStr, id].filter(Boolean).join('_');
}

function findReportPath(id, ext) {
  const direct = path.join(DIRS.reports, `${id}.${ext}`);
  if (fssync.existsSync(direct)) return direct;
  let entries;
  try { entries = fssync.readdirSync(DIRS.reports); }
  catch { return null; }
  const suffix = `_${id}.${ext}`;
  const hit = entries.find((f) => f.endsWith(suffix));
  return hit ? path.join(DIRS.reports, hit) : null;
}

// ---------- 履历抽出 ----------

async function extractText(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  try {
    if (ext === '.pdf') {
      const buf = await fs.readFile(filePath);
      const out = await pdfParse(buf);
      return out.text || '';
    }
    if (ext === '.docx') {
      const out = await mammoth.extractRawText({ path: filePath });
      return out.value || '';
    }
    if (ext === '.xlsx' || ext === '.xls') {
      // SheetJS の ESM では readFile が namespace に無いため、buffer 経由で read を使う
      const buf = await fs.readFile(filePath);
      const wb = XLSX.read(buf, { type: 'buffer' });
      const parts = [];
      for (const name of wb.SheetNames) {
        const sheet = wb.Sheets[name];
        parts.push(`# ${name}\n` + XLSX.utils.sheet_to_csv(sheet, { blankrows: false }));
      }
      return parts.join('\n\n');
    }
    if (ext === '.html' || ext === '.htm') {
      const raw = await fs.readFile(filePath, 'utf8');
      return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return await fs.readFile(filePath, 'utf8');
  } catch (e) {
    console.error(`[extractText 失敗] ${originalName} (${ext}) → ${e.message}`);
    return `[抽出失敗：${originalName} / ${e.message}]`;
  }
}

// ---------- claude 引擎呼び出し ----------

const DEFAULT_MODEL = process.env.BRIDGE_MODEL || 'claude-haiku-4-5';

function callClaude(prompt, { model = DEFAULT_MODEL } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p'];
    if (model) args.push('--model', model);
    const child = spawn('claude', args, {
      shell: true,
      cwd: ROOT,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`claude exited ${code}: ${stderr}`));
      else resolve(stdout);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// 履歷テキスト前処理：余分な空白・重複行を除去し、長さを抑える
// CJK 文字間の単一スペースも除去（pdf-parse が日本語 PDF で各文字間に挿入する）
// CSV ノイズも圧縮（xlsx → csv で大量に出る "，，，，"）
const CJK_RE = /([、-ヿ一-鿿＀-￯]) (?=[、-ヿ一-鿿＀-￯])/g;

function cleanText(text, maxChars = 15000) {
  if (!text) return '';
  let normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t　]+/g, ' ')             // 連続空白（全角含む）を1個に
    .replace(/^[ \t]+|[ \t]+$/gm, '');      // 行頭末尾の空白除去
  // CJK 間の単一空白を消す（pdf-parse 由来の「業 種 構 築」→「業種構築」）
  // 一度の replace では「業 種 構」のように奇数並びを完全には潰せないため 2 回まわす
  normalized = normalized.replace(CJK_RE, '$1').replace(CJK_RE, '$1');

  const lines = normalized.split('\n');
  const stage1 = [];
  let prev = '', blanks = 0;
  for (const ln of lines) {
    let t = ln.trim();
    // CSV ノイズ削減
    if (t.includes(',')) {
      t = t.replace(/,{2,}/g, ',').replace(/^,+|,+$/g, '').trim();
    }
    if (!t) {
      if (blanks < 1) stage1.push('');
      blanks++;
      continue;
    }
    blanks = 0;
    if (t === prev) continue;
    stage1.push(t);
    prev = t;
  }

  // 1〜2 文字の CJK だけの行が連続しているラン（pdf-parse の縦割れ）を 1 行に結合
  const isSingleCJK = (s) => /^[、-ヿ一-鿿＀-￯・]{1,2}$/.test(s);
  const out = [];
  let run = [];
  const flushRun = () => {
    if (run.length >= 2) out.push(run.join(''));
    else for (const x of run) out.push(x);
    run = [];
  };
  for (const ln of stage1) {
    if (isSingleCJK(ln)) run.push(ln);
    else { flushRun(); out.push(ln); }
  }
  flushRun();

  return out.join('\n').slice(0, maxChars);
}

function tryParseJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('JSON 本体が見つからない');
  return JSON.parse(body.slice(start, end + 1));
}

// JSON形式の需求定義を内部形式に変換
function normalizeJsonToRequirements(jsonData) {
  // ウェイト軸の変換マップ
  const weightMap = {
    'tech': '技術適合',
    'technology': '技術適合',
    'industry': '業界経験',
    'logic': '具体性',
    'specificity': '具体性',
    'mgmt': '管理推進',
    'management': '管理推進',
    'stability': '安定性',
  };

  // ウェイトを内部形式に変換
  const weights = {
    '技術適合': 0,
    '業界経験': 0,
    '具体性': 0,
    '管理推進': 0,
    '安定性': 0,
  };

  if (jsonData.weights && typeof jsonData.weights === 'object') {
    for (const [key, val] of Object.entries(jsonData.weights)) {
      const internalKey = weightMap[key.toLowerCase()] || key;
      if (weights.hasOwnProperty(internalKey)) {
        weights[internalKey] = Number(val) || 0;
      }
    }
  }

  // 本体を生成（memoまたはmainBodyから）
  let body = '';
  if (jsonData.memo) {
    body = typeof jsonData.memo === 'string' ? jsonData.memo : '';
  } else if (jsonData.body) {
    body = typeof jsonData.body === 'string' ? jsonData.body : '';
  }
  if (!body.trim()) {
    body = `# 募集要件（${jsonData.name || jsonData.position || '未設定'}）`;
  }

  return {
    preset: jsonData.id || jsonData.preset || '',
    position: jsonData.name || jsonData.position || '',
    experienceYears: Number(jsonData.experienceYears || 0),
    weights: weights,
    necessary: Array.isArray(jsonData.mustSkills) ? jsonData.mustSkills : (Array.isArray(jsonData.necessary) ? jsonData.necessary : []),
    preferred: Array.isArray(jsonData.niceSkills) ? jsonData.niceSkills : (Array.isArray(jsonData.preferred) ? jsonData.preferred : []),
    body: body,
  };
}

// ---------- API: presets ----------

app.get('/api/presets', async (_req, res) => {
  const files = await fs.readdir(DIRS.presets);
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const raw = await fs.readFile(path.join(DIRS.presets, f), 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    out.push({ ...meta, body });
  }
  res.json(out);
});

// ---------- API: requirements ----------

app.get('/api/requirements', async (_req, res) => {
  const p = path.join(DIRS.requirements, 'requirements.md');
  const raw = await fs.readFile(p, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  res.json({ ...meta, body });
});

app.post('/api/requirements', async (req, res) => {
  let b = req.body || {};
  
  // 如果接收到的是包含 mustSkills/niceSkills/memo 的JSON格式，则转换
  if (b.mustSkills || b.niceSkills || (b.weights && typeof b.weights === 'object' && !b.weights['技術適合'])) {
    try {
      b = normalizeJsonToRequirements(b);
    } catch (e) {
      return res.status(400).json({ error: `JSON变换失败: ${e.message}` });
    }
  }

  const meta = {
    preset: b.preset || '',
    position: b.position || '',
    experienceYears: Number(b.experienceYears || 0),
    weights: b.weights || { 技術適合: 0, 業界経験: 0, 具体性: 0, 管理推進: 0, 安定性: 0 },
    necessary: b.necessary || [],
    preferred: b.preferred || [],
    updatedAt: new Date().toISOString(),
  };
  const body = (b.body && b.body.trim()) ? b.body : `# 募集要件（${meta.position || '未設定'}）`;
  const out = `${toYaml(meta)}\n\n${body}\n`;
  await fs.writeFile(path.join(DIRS.requirements, 'requirements.md'), out, 'utf8');
  res.json({ ok: true, ...meta, body });
});

// ---------- API: reports list ----------

app.get('/api/reports', async (_req, res) => {
  const files = await fs.readdir(DIRS.reports);
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(DIRS.reports, f), 'utf8');
      const j = JSON.parse(raw);
      out.push({
        id: j.id,
        name: j.name || '(匿名)',
        position: j.position || '',
        recommendIndex: j.recommendIndex ?? null,
        summary: (j.summary || '').slice(0, 120),
        createdAt: j.createdAt || null,
      });
    } catch {}
  }
  out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json(out);
});

// ID は randomUUID().slice(0, 8) で英数字のみ。パス穿越防止のため厳格にバリデート。
function isValidId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id) && id.length > 0 && id.length <= 64;
}

app.get('/api/reports/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  const p = findReportPath(req.params.id, 'json');
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(JSON.parse(await fs.readFile(p, 'utf8')));
});

// OS のデフォルトアプリでファイル / フォルダを開く（クロスプラットフォーム）
// shell 経由で実行（spawn の引数クォート問題を回避）
// 注意：targetPath は isValidId バリデート済みの id + 固定 DIRS から組み立てるため、シェル注入の心配はない
function openInOS(targetPath, { select = false } = {}) {
  const platform = process.platform;
  let cmd;
  if (platform === 'win32') {
    // explorer.exe /select, は spawn だと「引数として 1 つに包まれる」問題が起きるため shell で実行
    cmd = select
      ? `explorer.exe /select,"${targetPath}"`
      : `start "" "${targetPath}"`;
  } else if (platform === 'darwin') {
    cmd = select ? `open -R "${targetPath}"` : `open "${targetPath}"`;
  } else {
    cmd = `xdg-open "${select ? path.dirname(targetPath) : targetPath}"`;
  }
  try {
    exec(cmd, (err) => {
      // explorer は成功時も exit 1 を返すので無視
      if (err && err.code !== 1) {
        console.error('[openInOS]', cmd, err.message);
      }
    });
    return true;
  } catch (e) {
    console.error('[openInOS] exec failed:', e.message);
    return false;
  }
}

// HTML レポートをデフォルトアプリで開く
app.post('/api/reports/:id/open-file', async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  const filePath = findReportPath(req.params.id, 'html');
  if (!filePath) return res.status(404).json({ error: 'not found' });
  if (!openInOS(filePath)) return res.status(500).json({ error: 'open failed' });
  res.json({ ok: true });
});

// レポートが入っているフォルダを開く（該当ファイルを選択状態で）
app.post('/api/reports/:id/open-folder', async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  const filePath = findReportPath(req.params.id, 'html');
  if (!openInOS(filePath || DIRS.reports, { select: !!filePath })) {
    return res.status(500).json({ error: 'open failed' });
  }
  res.json({ ok: true });
});

// 候補者名のリネーム（JSON 更新 + HTML 再生成）
app.post('/api/reports/:id/rename', async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  const { name } = req.body || {};
  if (typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  const trimmed = name.trim().slice(0, 100);
  if (!trimmed) return res.status(400).json({ error: 'empty name' });
  const oldJsonPath = findReportPath(req.params.id, 'json');
  const oldHtmlPath = findReportPath(req.params.id, 'html');
  if (!oldJsonPath) return res.status(404).json({ error: 'not found' });
  try {
    const j = JSON.parse(await fs.readFile(oldJsonPath, 'utf8'));
    j.name = trimmed;
    const newSlug = buildReportSlug(j);
    const newJsonPath = path.join(DIRS.reports, `${newSlug}.json`);
    const newHtmlPath = path.join(DIRS.reports, `${newSlug}.html`);
    await fs.writeFile(newJsonPath, JSON.stringify(j, null, 2), 'utf8');
    const tpl = await fs.readFile(path.join(DIRS.templates, 'report_template.html'), 'utf8');
    const html = renderReport(tpl, j);
    await fs.writeFile(newHtmlPath, html, 'utf8');
    if (oldJsonPath !== newJsonPath) {
      try { await fs.unlink(oldJsonPath); } catch {}
    }
    if (oldHtmlPath && oldHtmlPath !== newHtmlPath) {
      try { await fs.unlink(oldHtmlPath); } catch {}
    }
    res.json({ ok: true, name: trimmed });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 候補者レポート削除（JSON + HTML + 関連する questions も一緒に）
app.delete('/api/reports/:id', async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'invalid id' });
  const targets = [
    findReportPath(id, 'json'),
    findReportPath(id, 'html'),
    path.join(DIRS.questions, `${id}.json`),
  ].filter(Boolean);
  const deleted = [];
  for (const p of targets) {
    if (fssync.existsSync(p)) {
      try { await fs.unlink(p); deleted.push(path.basename(p)); }
      catch (e) { /* 個別失敗は無視 */ }
    }
  }
  if (!deleted.length) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, deleted });
});

// ---------- API: 履历 → 人物像要約（TASK=summary） ----------

const CONCURRENCY = Number(process.env.BRIDGE_CONCURRENCY || 3);

function buildSummaryPrompt(id, text, reqMeta) {
  return [
    'TASK=summary',
    '',
    '# 出力規律',
    '- JSON のみ。フェンス・前置き・後書き禁止。',
    '- CLAUDE.md §2 TASK=summary のスキーマに厳密に従う。',
    `- id は "${id}" を使う。`,
    '- recommendIndex は出力しない（点数評価は本ステップでは行わない）。',
    '',
    '# 現在の募集要件',
    `プリセット: ${reqMeta.preset || '(未設定)'}`,
    `職種: ${reqMeta.position || '(未設定)'}`,
    `必須スキル: ${JSON.stringify(reqMeta.necessary || [])}`,
    `歓迎スキル: ${JSON.stringify(reqMeta.preferred || [])}`,
    '',
    '# 履歷テキスト（前処理済み）',
    text,
  ].join('\n');
}

async function summarizeOne(filePath, originalName, reqMeta, tpl) {
  const id = randomUUID().slice(0, 8);
  const rawText = await extractText(filePath, originalName);
  const text = cleanText(rawText);
  const prompt = buildSummaryPrompt(id, text, reqMeta);
  const raw = await callClaude(prompt);
  const json = tryParseJson(raw);
  json.id = id;
  json.createdAt = new Date().toISOString();
  // 我方メタデータ（要件画面で確定した職種名）を優先。Claude の出力は揺れるので最後の fallback に下げる。
  json.position = reqMeta.position || reqMeta.preset || json.position || '';
  const originalBasename = path.basename(originalName, path.extname(originalName));
  const slug = buildReportSlug(json, originalBasename);
  await fs.writeFile(path.join(DIRS.reports, `${slug}.json`), JSON.stringify(json, null, 2), 'utf8');
  const html = renderReport(tpl, json);
  await fs.writeFile(path.join(DIRS.reports, `${slug}.html`), html, 'utf8');
  await fs.rename(filePath, path.join(DIRS.processed, `${slug}__${originalName}`));
  return { id, report: json };
}

async function loadRequirementsMeta() {
  const reqRaw = await fs.readFile(path.join(DIRS.requirements, 'requirements.md'), 'utf8');
  return parseFrontmatter(reqRaw).meta;
}

// Single-file（互換用）
app.post('/api/summarize', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  try {
    const reqMeta = await loadRequirementsMeta();
    const tpl = await fs.readFile(path.join(DIRS.templates, 'report_template.html'), 'utf8');
    const out = await summarizeOne(req.file.path, req.file.originalname, reqMeta, tpl);
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Batch + concurrent + NDJSON ストリーム
app.post('/api/summarize-batch', upload.array('files', 50), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'no files' });

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const emit = (obj) => {
    try { res.write(JSON.stringify(obj) + '\n'); } catch {}
  };

  let reqMeta, tpl;
  try {
    reqMeta = await loadRequirementsMeta();
    tpl = await fs.readFile(path.join(DIRS.templates, 'report_template.html'), 'utf8');
  } catch (e) {
    emit({ fatal: String(e.message || e) });
    return res.end();
  }

  const files = req.files.map((f, i) => ({ i, f }));
  const n = Math.min(CONCURRENCY, files.length);
  emit({ event: 'start', total: files.length, concurrency: n });

  let cursor = 0;
  async function worker() {
    while (cursor < files.length) {
      const my = files[cursor++];
      emit({ i: my.i, status: 'running', name: my.f.originalname });
      try {
        const out = await summarizeOne(my.f.path, my.f.originalname, reqMeta, tpl);
        emit({ i: my.i, status: 'done', name: my.f.originalname, id: out.id, report: out.report });
      } catch (e) {
        emit({ i: my.i, status: 'fail', name: my.f.originalname, error: String(e.message || e).slice(0, 300) });
      }
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  emit({ event: 'end' });
  res.end();
});

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderReport(tpl, j) {
  const skills = (j.skills || []).map((s) => `<span class="tag tag-skill">${esc(s)}</span>`).join('');
  const matched = (j.matched || []).map((m) => `<li><b>${esc(m.req)}</b><span class="lvl lvl-${esc(m.level)}">${esc(m.level || '')}</span><div class="ev">${esc(m.evidence || '')}</div></li>`).join('');
  const missing = (j.missing || []).map((m) => `<li>${esc(m)}</li>`).join('');
  const goods = (j.goodPoints || []).map((g) => `<li>${esc(g)}</li>`).join('');
  const concerns = (j.concerns || []).map((c) => `<li>${esc(c)}</li>`).join('');
  const map = {
    '{{id}}': esc(j.id),
    '{{name}}': esc(j.name || '(匿名)'),
    '{{age}}': esc(j.age ?? ''),
    '{{position}}': esc(j.position || ''),
    '{{summary}}': esc(j.summary || ''),
    '{{skills}}': skills,
    '{{matched}}': matched,
    '{{missing}}': missing,
    '{{goodPoints}}': goods,
    '{{concerns}}': concerns,
    '{{createdAt}}': esc(j.createdAt || ''),
  };
  return tpl.replace(/\{\{[^}]+\}\}/g, (m) => map[m] ?? '');
}

// ---------- API: 質問生成（TASK=questions） ----------

function buildQuestionsPrompt(candidate, reqMeta) {
  return [
    'TASK=questions',
    '',
    '# 出力規律',
    '- JSON のみ。フェンス・前置き・後書き禁止。',
    '- CLAUDE.md §2 TASK=questions のスキーマに厳密に従う。',
    '- **合計 15 件以上、上限 20 件**。groups は 4〜6 個、各 group の items は 3〜5 件。',
    '- text は候補者向け本文。敬語・2〜4 行・**具体的**。aim は HR 用 1 行（候補者には見せない狙い）。',
    '',
    '# 質問の具体性ルール（**必ず守る**）',
    '- 履歷の固有名詞（製品・FW・規模・年数・役割・社名）を**最低 1 つ**引用する。例：「直近の◯◯案件で〜」「Kubernetes クラスタの規模感（ノード数・Pod 数）を〜」',
    '- 数字・規模・期間・役割・成果指標を聞き出す形にする。',
    '- 禁止：曖昧な「頑張ったこと」「得意なこと」「苦労したこと」だけの質問。「コミュ力」「やる気」を直接問う質問。',
    '- 各 group の中で、直近 → 過去、概要 → 深掘り、の順で並べる。',
    '',
    '# 設計指針（group 構成のヒント。文言は適宜変えて良い）',
    '- グループ A：直近案件の技術スキル深掘り（必須スキルが実務で使えるレベルか）',
    '- グループ B：障害・運用・トラブル対応の具体事例（安定性・即応力）',
    '- グループ C：設計・意思決定の根拠（具体性・推進力）',
    '- グループ D：**未確認の必須スキル**の実務経験を 1 問ずつ（漏れなく）',
    '- グループ E：歓迎スキル／キャリア志向（マッチ度・定着可能性）',
    '',
    '# 現在の募集要件',
    `職種: ${reqMeta.position || ''}`,
    `経験年数: ${reqMeta.experienceYears || 0}年以上`,
    `必須スキル: ${JSON.stringify(reqMeta.necessary || [])}`,
    `歓迎スキル: ${JSON.stringify(reqMeta.preferred || [])}`,
    '',
    '# 候補者の人物像（②要約より）',
    `氏名: ${candidate.name || '(匿名)'}`,
    `人物像: ${candidate.summary || ''}`,
    `スキル: ${JSON.stringify(candidate.skills || [])}`,
    `照合済み必須: ${JSON.stringify((candidate.matched || []).map(m => `${m.req}（${m.evidence || ''}）`))}`,
    `未確認の必須: ${JSON.stringify(candidate.missing || [])}`,
    '',
    '上記の「照合済み必須」「未確認の必須」を必ず質問に反映すること。未確認のスキルは 1 問ずつ、必ず誰の・何の案件で使ったかを問う形に。',
  ].join('\n');
}

app.post('/api/generate-questions', async (req, res) => {
  const { candidateId } = req.body || {};
  if (!candidateId) return res.status(400).json({ error: 'candidateId required' });
  if (!isValidId(candidateId)) return res.status(400).json({ error: 'invalid candidateId' });
  const candidatePath = findReportPath(candidateId, 'json');
  if (!candidatePath) return res.status(404).json({ error: 'candidate not found' });
  try {
    const candidate = JSON.parse(await fs.readFile(candidatePath, 'utf8'));
    const reqMeta = await loadRequirementsMeta();
    const prompt = buildQuestionsPrompt(candidate, reqMeta);
    const raw = await callClaude(prompt);
    const json = tryParseJson(raw);
    json.candidateId = candidateId;
    json.candidateName = candidate.name || '(匿名)';
    json.position = candidate.position || reqMeta.position || '';
    json.generatedAt = new Date().toISOString();
    await fs.writeFile(path.join(DIRS.questions, `${candidateId}.json`), JSON.stringify(json, null, 2), 'utf8');
    res.json({ ok: true, ...json });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/questions/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const data = await readQuestions(DIRS.questions, req.params.id);
    const answers = await readAnswers(DIRS.questions, req.params.id);
    res.json({ ...data, answers });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 質問 JSON 全体を更新（HR の手動編集後の保存用）
app.put('/api/questions/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const existing = await readQuestions(DIRS.questions, req.params.id);
    if (existing.status !== 'draft') {
      return res.status(409).json({ error: 'not_editable', status: existing.status });
    }
    if (req.body.editedAt && req.body.editedAt !== existing.editedAt) {
      return res.status(409).json({ error: 'stale', currentEditedAt: existing.editedAt });
    }
    const updated = {
      ...existing,
      groups: req.body.groups ?? existing.groups,
      editedAt: new Date().toISOString(),
    };
    await writeQuestions(DIRS.questions, req.params.id, updated);
    res.json({ ok: true, editedAt: updated.editedAt });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
    res.status(500).json({ error: String(e.message || e) });
  }
});

// アンケートをサーベイ基盤に送出（draft → sent）
app.post('/api/questions/:id/dispatch', async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const config = await loadSurveyConfig(path.join(ROOT, '.clarus'));
    if (!config) return res.status(412).json({ error: 'no_survey_config' });
    const settings = await loadSettings(DIRS.presets);
    const data = await readQuestions(DIRS.questions, req.params.id);
    if (data.status !== 'draft') {
      return res.status(409).json({ error: 'not_draft', status: data.status });
    }

    const result = await createSurvey(config, {
      candidateId: data.candidateId,
      candidateName: data.candidateName,
      position: data.position,
      groups: data.groups,
      companyName: settings.companyName,
      hrName: settings.hrName,
      hrEmail: settings.hrEmail,
      surveyPageTitle: expandTemplate(
        settings.surveyPageTemplate.title,
        buildTemplateVars({ candidateName: data.candidateName, position: data.position, settings, surveyUrl: '', expiresAt: '' })
      ),
      surveyPageDescription: expandTemplate(
        settings.surveyPageTemplate.description,
        buildTemplateVars({ candidateName: data.candidateName, position: data.position, settings, surveyUrl: '', expiresAt: '' })
      ),
      ttlSeconds: 604800,
    });

    const updated = {
      ...data,
      status: 'sent',
      dispatch: {
        ...data.dispatch,
        token: result.token,
        surveyUrl: result.surveyUrl,
        createdAt: new Date().toISOString(),
        sentAt: new Date().toISOString(),
        expiresAt: result.expiresAt,
      },
    };
    await writeQuestions(DIRS.questions, req.params.id, updated);

    const vars = buildTemplateVars({
      candidateName: data.candidateName, position: data.position, settings,
      surveyUrl: result.surveyUrl, expiresAt: result.expiresAt,
    });
    res.json({
      ok: true,
      surveyUrl: result.surveyUrl,
      expiresAt: result.expiresAt,
      email: {
        subject: expandTemplate(settings.emailTemplate.subject, vars),
        body: expandTemplate(settings.emailTemplate.body, vars),
      },
    });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
    res.status(500).json({ error: String(e.message || e) });
  }
});

// サーベイ基盤から回答を取得（pending or submitted）
app.post('/api/questions/:id/fetch', async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const config = await loadSurveyConfig(path.join(ROOT, '.clarus'));
    if (!config) return res.status(412).json({ error: 'no_survey_config' });
    const data = await readQuestions(DIRS.questions, req.params.id);
    if (!data.dispatch.token) return res.status(409).json({ error: 'not_dispatched' });

    const result = await fetchResult(config, data.dispatch.token);
    const updated = {
      ...data,
      dispatch: { ...data.dispatch, lastPolledAt: new Date().toISOString() },
    };

    if (result.status === 'pending') {
      if (data.dispatch.expiresAt && new Date() > new Date(data.dispatch.expiresAt)) {
        updated.status = 'expired';
        updated.dispatch.closedAt = new Date().toISOString();
        updated.dispatch.closeReason = 'expired';
      }
      await writeQuestions(DIRS.questions, req.params.id, updated);
      return res.json({ status: 'pending' });
    }

    const resp = result.response;
    await writeAnswers(DIRS.questions, req.params.id, {
      candidateId: data.candidateId,
      token: data.dispatch.token,
      fetchedAt: new Date().toISOString(),
      respondent: {
        email: resp.email,
        nameConfirmed: resp.nameConfirmed,
        submittedAt: resp.submittedAt,
      },
      answers: data.groups.flatMap(g =>
        g.items.map((it) => {
          const matched = resp.answers.find(a => a.questionText === it.text);
          return {
            groupTitle: g.title,
            questionText: it.text,
            aim: it.aim,
            answerText: matched?.answerText ?? '',
          };
        })
      ),
      supplementary: resp.supplementary,
    });

    updated.status = 'submitted';
    updated.dispatch.closedAt = new Date().toISOString();
    updated.dispatch.closeReason = 'submitted';
    await writeQuestions(DIRS.questions, req.params.id, updated);
    await closeSurvey(config, data.dispatch.token).catch(e => console.warn('[survey] closeSurvey failed on auto-close:', e.message));

    res.json({ status: 'submitted' });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
    res.status(500).json({ error: String(e.message || e) });
  }
});

// アンケートを手動クローズ
app.post('/api/questions/:id/close', async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const config = await loadSurveyConfig(path.join(ROOT, '.clarus'));
    const data = await readQuestions(DIRS.questions, req.params.id);
    if (data.dispatch.token && config) {
      await closeSurvey(config, data.dispatch.token).catch(e => console.warn('[survey] closeSurvey failed on manual close:', e.message));
    }
    const updated = {
      ...data,
      status: 'closed',
      dispatch: {
        ...data.dispatch,
        closedAt: new Date().toISOString(),
        closeReason: 'manual',
      },
    };
    await writeQuestions(DIRS.questions, req.params.id, updated);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 設定取得（HR 編集可フィールド＋ Vercel 連携情報、APIキーはマスク）
app.get('/api/settings', async (_req, res) => {
  try {
    const settings = await loadSettings(DIRS.presets);
    const config = await loadSurveyConfig(path.join(ROOT, '.clarus'));
    res.json({
      ...settings,
      surveyEndpoint: config?.endpoint ?? '',
      surveyApiKeyMasked: config?.apiKey ? '••••••••' + config.apiKey.slice(-4) : '',
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 設定保存（settings.json と .clarus/survey-config.json に分離して書き込み）
app.post('/api/settings', async (req, res) => {
  try {
    const { surveyEndpoint, surveyApiKey, ...rest } = req.body;
    await saveSettings(DIRS.presets, rest);
    if (surveyEndpoint || surveyApiKey) {
      const cur = await loadSurveyConfig(path.join(ROOT, '.clarus')) ?? {};
      await saveSurveyConfig(path.join(ROOT, '.clarus'), {
        endpoint: surveyEndpoint ?? cur.endpoint,
        apiKey: surveyApiKey || cur.apiKey,
        pollIntervalMs: 300000,
      });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Vercel 疎通確認（bogus token で 404 が返れば到達+認証 OK）
app.get('/api/settings/survey-test', async (_req, res) => {
  try {
    const config = await loadSurveyConfig(path.join(ROOT, '.clarus'));
    if (!config) return res.status(412).json({ error: 'no_config' });
    const r = await fetch(`${config.endpoint}/api/surveys/test-token/result`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    res.json({ reachable: r.status !== 401 && r.status < 500, status: r.status });
  } catch (e) {
    res.json({ reachable: false, error: String(e.message || e) });
  }
});

// 1 件だけ再生成
app.post('/api/regenerate-question', async (req, res) => {
  const { candidateId, groupIndex, itemIndex, hint } = req.body || {};
  if (!candidateId || groupIndex == null || itemIndex == null) {
    return res.status(400).json({ error: 'candidateId / groupIndex / itemIndex 必須' });
  }
  if (!isValidId(candidateId)) return res.status(400).json({ error: 'invalid candidateId' });
  const qp = path.join(DIRS.questions, `${candidateId}.json`);
  const rp = findReportPath(candidateId, 'json');
  if (!fssync.existsSync(qp) || !rp) return res.status(404).json({ error: 'not found' });
  try {
    const questions = JSON.parse(await fs.readFile(qp, 'utf8'));
    const candidate = JSON.parse(await fs.readFile(rp, 'utf8'));
    const reqMeta = await loadRequirementsMeta();
    const group = questions.groups?.[groupIndex];
    const item = group?.items?.[itemIndex];
    if (!group || !item) return res.status(404).json({ error: 'item index 不正' });

    const others = [];
    questions.groups.forEach((g, gi) => (g.items || []).forEach((q, qi) => {
      if (gi !== groupIndex || qi !== itemIndex) others.push(q.text);
    }));

    const prompt = [
      'TASK=regenerate-question',
      '',
      '# 出力規律',
      '- JSON のみ。フェンス禁止。スキーマ：{"text": "...", "aim": "..."}',
      '- text：候補者向け本文。敬語・2〜4 行・履歷の固有名詞を 1 つ以上引用・具体的（数字・規模・期間・役割）。',
      '- aim：HR 用 1 行（候補者には見せない）。',
      '- 「他の質問」と重複しない、別の角度から問う 1 件を返す。',
      hint ? `- ヒント：${hint}` : '',
      '',
      `# 募集要件：${reqMeta.position || ''} ／ 必須: ${JSON.stringify(reqMeta.necessary || [])} ／ 歓迎: ${JSON.stringify(reqMeta.preferred || [])}`,
      `# 候補者：${candidate.name || '(匿名)'}`,
      `人物像: ${candidate.summary || ''}`,
      `スキル: ${JSON.stringify(candidate.skills || [])}`,
      `照合済み必須: ${JSON.stringify((candidate.matched || []).map(m => m.req))}`,
      `未確認必須: ${JSON.stringify(candidate.missing || [])}`,
      '',
      '# 置き換え対象',
      `グループ: ${group.title}`,
      `元の質問: ${item.text}`,
      `元の狙い: ${item.aim || ''}`,
      '',
      '# 他の質問（重複回避用）',
      ...others.map((t, i) => `${i + 1}. ${t}`),
    ].filter(Boolean).join('\n');

    const raw = await callClaude(prompt);
    const obj = tryParseJson(raw);
    if (!obj.text) throw new Error('text フィールドが返ってこない');

    // 即時保存
    questions.groups[groupIndex].items[itemIndex] = { text: obj.text, aim: obj.aim || '' };
    const now = new Date().toISOString();
    questions.updatedAt = now;
    questions.editedAt = now;
    await fs.writeFile(qp, JSON.stringify(questions, null, 2), 'utf8');

    res.json({ ok: true, text: obj.text, aim: obj.aim || '' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---------- 起動 ----------

startPoller({
  questionsDir: DIRS.questions,
  clarusDir: path.join(ROOT, '.clarus'),
  intervalMs: 300000,
});

app.listen(PORT, () => {
  console.log(`Bridge listening: http://localhost:${PORT}`);
});
