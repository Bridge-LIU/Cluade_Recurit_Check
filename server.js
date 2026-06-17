// Clarus — server.js
// 本地小程序：localhost:3939。引擎は `claude -p` を子プロセスで叩く。

import express from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';

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
      const wb = XLSX.readFile(filePath);
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
    return `[抽出失敗：${originalName} / ${e.message}]`;
  }
}

// ---------- claude 引擎呼び出し ----------

const DEFAULT_MODEL = process.env.CLARUS_MODEL || 'claude-haiku-4-5';

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
function cleanText(text, maxChars = 15000) {
  if (!text) return '';
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t　]+/g, ' ')          // 全角スペース含めて連続空白を1個に
    .replace(/^[ \t]+|[ \t]+$/gm, '');      // 行頭末尾の空白除去
  const lines = normalized.split('\n');
  const out = [];
  let prev = '', blanks = 0;
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) {
      if (blanks < 1) out.push('');         // 連続空行は1行までに圧縮
      blanks++;
      continue;
    }
    blanks = 0;
    if (t === prev) continue;               // 直前行と同一なら捨てる（CSV化したシートで頻発）
    out.push(t);
    prev = t;
  }
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
  const p = path.join(DIRS.reports, `${req.params.id}.json`);
  if (!fssync.existsSync(p)) return res.status(404).json({ error: 'not found' });
  res.json(JSON.parse(await fs.readFile(p, 'utf8')));
});

// 候補者レポート削除（JSON + HTML + 関連する questions も一緒に）
app.delete('/api/reports/:id', async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'invalid id' });
  const targets = [
    path.join(DIRS.reports, `${id}.json`),
    path.join(DIRS.reports, `${id}.html`),
    path.join(DIRS.questions, `${id}.json`),
  ];
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

const CONCURRENCY = Number(process.env.CLARUS_CONCURRENCY || 3);

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
  await fs.writeFile(path.join(DIRS.reports, `${id}.json`), JSON.stringify(json, null, 2), 'utf8');
  const html = renderReport(tpl, json);
  await fs.writeFile(path.join(DIRS.reports, `${id}.html`), html, 'utf8');
  await fs.rename(filePath, path.join(DIRS.processed, `${id}__${originalName}`));
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
  emit({ event: 'start', total: files.length, concurrency: CONCURRENCY });

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
  const n = Math.min(CONCURRENCY, files.length);
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
  const candidatePath = path.join(DIRS.reports, `${candidateId}.json`);
  if (!fssync.existsSync(candidatePath)) return res.status(404).json({ error: 'candidate not found' });
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
  const p = path.join(DIRS.questions, `${req.params.id}.json`);
  if (!fssync.existsSync(p)) return res.status(404).json({ error: 'not found' });
  res.json(JSON.parse(await fs.readFile(p, 'utf8')));
});

// 質問 JSON 全体を更新（HR の手動編集後の保存用）
app.put('/api/questions/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  const p = path.join(DIRS.questions, `${req.params.id}.json`);
  if (!fssync.existsSync(p)) return res.status(404).json({ error: 'not found' });
  try {
    const current = JSON.parse(await fs.readFile(p, 'utf8'));
    const body = req.body || {};
    if (Array.isArray(body.groups)) current.groups = body.groups;
    current.updatedAt = new Date().toISOString();
    await fs.writeFile(p, JSON.stringify(current, null, 2), 'utf8');
    res.json({ ok: true, updatedAt: current.updatedAt });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
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
  const rp = path.join(DIRS.reports, `${candidateId}.json`);
  if (!fssync.existsSync(qp) || !fssync.existsSync(rp)) return res.status(404).json({ error: 'not found' });
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
    questions.updatedAt = new Date().toISOString();
    await fs.writeFile(qp, JSON.stringify(questions, null, 2), 'utf8');

    res.json({ ok: true, text: obj.text, aim: obj.aim || '' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---------- 起動 ----------

app.listen(PORT, () => {
  console.log(`Clarus listening: http://localhost:${PORT}`);
});
