// Clarus 管理画面 — フロント

const PAGE_TITLES = {
  req:  ['募集要件', 'プリセットを選んで、職種ごとの必須スキルと評価の重みを設定します。'],
  new:  ['新規評価', '履歷スキルシートをアップロードして人物像を要約します。'],
  q:    ['質問生成', '①要件 ＋ ②要約 から候補者向け WEB アンケートを生成します（第二期）。'],
  hist: ['評価履歴', 'これまでの人物像要約を一覧表示します。'],
  set:  ['設定', '保存先と引擎の状態。'],
};

const AXES = ['技術適合', '業界経験', '具体性', '管理推進', '安定性'];

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

// ===== Nav =====
$$('.navitem').forEach(el => {
  el.addEventListener('click', () => {
    const key = el.dataset.page;
    $$('.navitem').forEach(n => n.classList.toggle('active', n === el));
    $$('.page').forEach(p => p.classList.toggle('active', p.dataset.page === key));
    $('#pageTitle').textContent = PAGE_TITLES[key][0];
    $('#pageSub').textContent  = PAGE_TITLES[key][1];
    if (key === 'hist') loadHistory();
    if (key === 'new') refreshReqStrip();
    if (key === 'q')   loadQTab();
  });
});

function refreshStrip(root) {
  if (!root) return;
  const r = state.req;
  const title = root.querySelector('.rs-title');
  const meta = root.querySelector('.rs-r');
  const skills = root.querySelector('.rs-skills');
  if (!title || !meta) return;

  if (!r.position) {
    title.textContent = '未設定';
    meta.innerHTML = '<span class="rs-warn">先に「募集要件」タブで設定してください</span>';
    if (skills) skills.innerHTML = '';
    return;
  }
  const presetLabel = state.presets.find(p => p.name === r.preset)?.label || r.preset;
  title.textContent = r.position;
  const yrs = Number(r.experienceYears || 0);
  const parts = [];
  if (presetLabel) parts.push(`<span>${escapeHtml(presetLabel)}</span>`);
  parts.push(`<span>経験 <b>${yrs > 0 ? yrs : '不問'}</b>${yrs > 0 ? '年以上' : ''}</span>`);
  meta.innerHTML = parts.join('');

  if (skills) {
    const rows = [];
    if (r.necessary.length) {
      rows.push(`<div class="rs-row"><span class="rs-key">必須</span>${r.necessary.map(s => `<span class="tag">${escapeHtml(s)}</span>`).join('')}</div>`);
    }
    if (r.preferred.length) {
      rows.push(`<div class="rs-row"><span class="rs-key">歓迎</span>${r.preferred.map(s => `<span class="tag tag-skill">${escapeHtml(s)}</span>`).join('')}</div>`);
    }
    skills.innerHTML = rows.join('');
  }
}

function refreshReqStrip() {
  refreshStrip($('#reqStrip'));
  refreshStrip($('#qReqStrip'));
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// HTML5 <dialog> ベースの確認モーダル（confirm() 置き換え）
function confirmDialog({ title = '確認', message = '', confirmText = 'OK', cancelText = 'キャンセル', danger = false } = {}) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'app-dialog';
    dlg.innerHTML = `
      <form method="dialog" class="dlg-body">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="dlg-actions">
          <button value="cancel" class="btn-ghost">${escapeHtml(cancelText)}</button>
          <button value="confirm" class="${danger ? 'btn-danger' : 'btn-primary'}">${escapeHtml(confirmText)}</button>
        </div>
      </form>
    `;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'confirm';
      dlg.remove();
      resolve(ok);
    });
    // ESC でキャンセル扱い（dialog のデフォルト close は returnValue が空）
    dlg.showModal();
  });
}

// ===== State =====
const state = {
  presets: [],
  req: {
    preset:'', position:'', experienceYears:0,
    weights: { 技術適合:0, 業界経験:0, 具体性:0, 管理推進:0, 安定性:0 },
    necessary:[], preferred:[], body:'', updatedAt:'',
  },
};

// ===== Tag helpers =====
function renderNecessary() {
  const host = $('#necessaryTags');
  host.innerHTML = '';
  state.req.necessary.forEach((t, i) => {
    const el = document.createElement('span');
    el.className = 'tag';
    el.innerHTML = `${escapeHtml(t)} <span class="tag-del">×</span>`;
    el.querySelector('.tag-del').addEventListener('click', () => {
      state.req.necessary.splice(i, 1); renderNecessary();
    });
    host.appendChild(el);
  });
}

function renderPreferred() {
  const host = $('#preferredTags');
  host.innerHTML = '';
  state.req.preferred.forEach((t, i) => {
    const el = document.createElement('span');
    el.className = 'tag tag-skill';
    el.innerHTML = `${escapeHtml(t)} <span class="tag-del">×</span>`;
    el.querySelector('.tag-del').addEventListener('click', () => {
      state.req.preferred.splice(i, 1); renderPreferred();
    });
    host.appendChild(el);
  });
}

// ===== Preset chips =====
function renderPresetChips() {
  const host = $('#presetChips');
  host.innerHTML = state.presets.map(p =>
    `<div class="chip ${state.req.preset === p.name ? 'on' : ''}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.label || p.name)}</div>`
  ).join('');
  $$('#presetChips .chip').forEach(c => {
    c.addEventListener('click', () => {
      state.req.preset = c.dataset.name;
      $('#preset').value = c.dataset.name;
      applyPreset(true);
    });
  });
}

// ===== Weight bars + number inputs =====
function setWeight(axis, val) {
  const v = Math.min(10, Math.max(0, Number(val) || 0));
  state.req.weights[axis] = v;
  const inp = $(`[data-w="${axis}"]`);
  if (inp) inp.value = v;
  const bar = $(`.bar[data-axis="${axis}"]`);
  if (bar) {
    bar.querySelector('.b-num').textContent = v;
    bar.querySelector('.b-fill').style.height = `${v * 10}%`;
  }
}

function renderBars() {
  const host = $('#weightBars');
  host.innerHTML = AXES.map(axis => {
    const v = Number(state.req.weights[axis] || 0);
    return `<div class="bar" data-axis="${escapeHtml(axis)}">
      <div class="b-num">${v}</div>
      <div class="b-bar"><div class="b-fill" style="height:${v*10}%"></div></div>
      <div class="b-name">${escapeHtml(axis)}</div>
    </div>`;
  }).join('');
  $$('#weightBars .b-bar').forEach(bar => {
    bar.addEventListener('click', (e) => {
      const rect = bar.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const v = Math.round((1 - y / rect.height) * 10);
      const axis = bar.parentElement.dataset.axis;
      setWeight(axis, Math.min(10, Math.max(0, v)));
    });
  });
}

function wireWeights() {
  $$('[data-w]').forEach(el => {
    el.addEventListener('input', () => {
      setWeight(el.dataset.w, el.value);
    });
  });
}

// ===== Boot =====
async function boot() {
  const presets = await fetch('/api/presets').then(r => r.json());
  state.presets = presets;
  const sel = $('#preset');
  sel.innerHTML = '<option value="">— 選択してください —</option>' +
    presets.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.label || p.name)}</option>`).join('');
  sel.addEventListener('change', applyPreset);
  renderPresetChips();

  const req = await fetch('/api/requirements').then(r => r.json());
  Object.assign(state.req, {
    preset: req.preset || '',
    position: req.position || '',
    experienceYears: Number(req.experienceYears || 0),
    weights: req.weights || { 技術適合:0, 業界経験:0, 具体性:0, 管理推進:0, 安定性:0 },
    necessary: req.necessary || [],
    preferred: req.preferred || [],
    body: req.body || '',
    updatedAt: req.updatedAt || '',
  });
  fillForm();

  // tag inputs
  $('#necessaryInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      e.preventDefault();
      state.req.necessary.push(e.target.value.trim());
      e.target.value = '';
      renderNecessary();
    }
  });
  $('#preferredInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      e.preventDefault();
      state.req.preferred.push(e.target.value.trim());
      e.target.value = '';
      renderPreferred();
    }
  });

  $('#position').addEventListener('input', (e) => { state.req.position = e.target.value; });
  $('#experienceYears').addEventListener('input', (e) => { state.req.experienceYears = Number(e.target.value) || 0; });
  $('#rawBody').addEventListener('input', (e) => { state.req.body = e.target.value; });

  wireWeights();

  $('#saveReq').addEventListener('click', saveReq);
  $('#resetReq').addEventListener('click', () => {
    if (!state.req.preset) { toast('プリセットを先に選んでください'); return; }
    applyPreset(true);
    toast('プリセット既定値に戻しました');
  });
  $('#parseBtn').addEventListener('click', parseRaw);

  refreshReqStrip();
  wireUpload();
}

function applyPreset(force=false) {
  const name = $('#preset').value;
  const p = state.presets.find(x => x.name === name);
  if (!p) return;
  state.req.preset = name;
  state.req.weights = { ...p.weights };
  if (force || state.req.experienceYears == null) {
    state.req.experienceYears = Number(p.experienceYears || 0);
  }
  if (force || (Array.isArray(p.mustSkills) && state.req.necessary.length === 0)) {
    state.req.necessary = [...(p.mustSkills || [])];
  }
  if (force) state.req.preferred = [...(p.niceSkills || [])];
  if (force || !state.req.position) state.req.position = p.label || name;
  fillForm();
}

function fillForm() {
  $('#preset').value = state.req.preset || '';
  $('#position').value = state.req.position || '';
  $('#experienceYears').value = state.req.experienceYears || 0;
  $('#rawBody').value = state.req.body || '';
  renderBars();
  AXES.forEach(k => setWeight(k, Number(state.req.weights[k] || 0)));
  renderNecessary();
  renderPreferred();
  renderPresetChips();
}

async function saveReq() {
  const btn = $('#saveReq');
  btn.disabled = true;
  $('#saveMsg').innerHTML = '<span class="spinner"></span> 保存中…';
  try {
    const r = await fetch('/api/requirements', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({
        preset: state.req.preset,
        position: state.req.position,
        experienceYears: state.req.experienceYears,
        weights: state.req.weights,
        necessary: state.req.necessary,
        preferred: state.req.preferred,
        body: state.req.body,
      }),
    }).then(r => r.json());
    if (r.ok) {
      state.req.updatedAt = r.updatedAt || new Date().toISOString();
      $('#saveMsg').textContent = '保存しました。';
      toast('募集要件を保存しました');
    } else {
      $('#saveMsg').textContent = '保存失敗';
    }
  } catch(e) {
    $('#saveMsg').textContent = '保存失敗：' + e.message;
  } finally {
    btn.disabled = false;
    setTimeout(()=>{ $('#saveMsg').textContent=''; }, 3000);
  }
}

// ===== 原文 → 構造化 自動入力 =====
function parseRaw() {
  const text = $('#rawBody').value;
  if (!text.trim()) {
    setParseMsg('原文が空です。先に貼り付けてください。', 'ng');
    return;
  }

  // 先に JSON 形式を試す
  let res = tryParseJSON(text);
  if (res) {
    const applied = [];
    if (res.position) { state.req.position = res.position; applied.push('職種名'); }
    if (res.experienceYears != null) { state.req.experienceYears = res.experienceYears; applied.push('経験年数'); }
    if (res.necessary && res.necessary.length) { state.req.necessary = res.necessary; applied.push(`必須 ${res.necessary.length}件`); }
    if (res.preferred && res.preferred.length) { state.req.preferred = res.preferred; applied.push(`歓迎 ${res.preferred.length}件`); }
    if (res.weights && Object.keys(res.weights).length) {
      Object.assign(state.req.weights, res.weights);
      applied.push(`重み ${Object.keys(res.weights).length}軸`);
    }
    fillForm();
    if (applied.length) {
      setParseMsg(`JSON から自動入力しました：${applied.join(' / ')}。保存ボタンで確定してください。`, 'ok');
      toast('JSON から自動入力しました');
    }
    return;
  }

  // JSON 解析失敗 → Markdown 形式で試す
  res = parseRequirementsMarkdown(text);
  const applied = [];

  if (res.position) { state.req.position = res.position; applied.push('職種名'); }
  if (res.experienceYears != null) { state.req.experienceYears = res.experienceYears; applied.push('経験年数'); }
  if (res.necessary && res.necessary.length) { state.req.necessary = res.necessary; applied.push(`必須 ${res.necessary.length}件`); }
  if (res.preferred && res.preferred.length) { state.req.preferred = res.preferred; applied.push(`歓迎 ${res.preferred.length}件`); }
  if (res.weights && Object.keys(res.weights).length) {
    Object.assign(state.req.weights, res.weights);
    applied.push(`重み ${Object.keys(res.weights).length}軸`);
  }

  fillForm();
  if (applied.length) {
    setParseMsg(`Markdown から自動入力しました：${applied.join(' / ')}。保存ボタンで確定してください。`, 'ok');
    toast('Markdown から自動入力しました');
  } else {
    setParseMsg('JSON と Markdown の両方の形式が認識できませんでした。「## 基本情報」「## 必須スキル」等の形式、または JSON 形式を確認してください。', 'ng');
  }
}

function setParseMsg(msg, cls) {
  const el = $('#parseMsg');
  el.textContent = msg;
  el.classList.remove('ok','ng');
  if (cls) el.classList.add(cls);
}

function tryParseJSON(text) {
  try {
    // JSON 本体を抽出（フェンス、または単純に { } で囲む）
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    let body = fence ? fence[1] : text;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end < 0) return null;
    const json = JSON.parse(body.slice(start, end + 1));

    // JSON を内部形式に変換
    const weightMap = {
      'tech': '技術適合', 'technology': '技術適合',
      'industry': '業界経験',
      'logic': '具体性', 'specificity': '具体性',
      'mgmt': '管理推進', 'management': '管理推進',
      'stability': '安定性',
    };
    const weights = {
      '技術適合': 0, '業界経験': 0, '具体性': 0, '管理推進': 0, '安定性': 0,
    };
    if (json.weights && typeof json.weights === 'object') {
      for (const [key, val] of Object.entries(json.weights)) {
        const internalKey = weightMap[key.toLowerCase()] || key;
        if (weights.hasOwnProperty(internalKey)) {
          weights[internalKey] = Math.min(10, Math.max(0, Number(val) || 0));
        }
      }
    }

    return {
      position: json.name || json.position || null,
      experienceYears: json.experienceYears != null ? Number(json.experienceYears) : null,
      necessary: Array.isArray(json.mustSkills) ? json.mustSkills : (Array.isArray(json.necessary) ? json.necessary : []),
      preferred: Array.isArray(json.niceSkills) ? json.niceSkills : (Array.isArray(json.preferred) ? json.preferred : []),
      weights: Object.values(weights).some(v => v > 0) ? weights : {},
    };
  } catch (e) {
    return null;
  }
}

function parseRequirementsMarkdown(text) {
  const HEADER_KW = [
    '基本情報','基本情','概要','職務内容','JD','業務内容',
    '必須スキル','必須要件','必須','MUST',
    '歓迎スキル','歓迎','尚可','あれば','WANT',
    '評価軸の重み','評価軸','重み','評価ウェイト',
  ];
  const isHeader = (line) => {
    const t = line.trim();
    if (!t) return null;
    const md = t.match(/^#{1,4}\s+(.+?)\s*$/);
    if (md) return md[1].trim();
    if (/^[\-\*・●○◇◆]/.test(t)) return null;
    // colon with content → key/value, not header
    if (/[:：]\s*\S/.test(t)) return null;
    if (t.length > 40) return null;
    for (const kw of HEADER_KW) if (t.includes(kw)) return t;
    return null;
  };

  const lines = text.split(/\r?\n/);
  const sections = {};
  let cur = '_intro';
  sections[cur] = [];
  for (const line of lines) {
    const h = isHeader(line);
    if (h) { cur = h; sections[cur] = []; }
    else sections[cur].push(line);
  }

  const out = { position:null, experienceYears:null, necessary:null, preferred:null, weights:{} };

  const find = (kw) => Object.keys(sections).find(k => kw.some(w => k.includes(w)));

  // 基本情報
  const basicKey = find(['基本情報', '基本情', '概要']);
  if (basicKey) {
    for (const ln of sections[basicKey]) {
      const m = ln.match(/^[\s\-\*・]*([^:：]+)[:：]\s*(.+)$/);
      if (!m) continue;
      const k = m[1].trim(); const v = m[2].trim();
      if (/ポジ|職種|役職/.test(k)) out.position = v;
      else if (/経験年数|必要経験|経験/.test(k)) {
        const num = v.match(/(\d+)/);
        if (num) out.experienceYears = Number(num[1]);
        else if (/未経験|未経/.test(v)) out.experienceYears = 0;
      }
    }
  }

  // 必須スキル
  const mustKey = find(['必須スキル', '必須']);
  if (mustKey) out.necessary = extractBullets(sections[mustKey]);

  // 歓迎スキル
  const wantKey = find(['歓迎スキル', '歓迎', '尚可', 'あれば']);
  if (wantKey) out.preferred = extractBullets(sections[wantKey]);

  // 評価軸の重み
  const wKey = find(['評価軸の重み', '評価軸', '重み']);
  if (wKey) {
    for (const ln of sections[wKey]) {
      const m = ln.match(/^[\s\-\*・]*([^:：]+)[:：]\s*(\d+)/);
      if (!m) continue;
      const axis = mapAxis(m[1].trim());
      if (axis) out.weights[axis] = Math.min(10, Math.max(0, Number(m[2])));
    }
  }
  return out;
}

function extractBullets(lines) {
  const out = [];
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) continue;
    if (/[:：]\s*\S/.test(t)) continue; // skip key/value lines
    const m = t.match(/^[\-\*・●○◇◆]\s*(.+?)\s*$/);
    out.push((m ? m[1] : t).replace(/[、,]\s*$/, '').trim());
  }
  return out;
}

function mapAxis(label) {
  const s = label.replace(/\s/g, '');
  if (/技術|技/.test(s) && /適合|スキル|力/.test(s)) return '技術適合';
  if (/技術スキル|技術適合/.test(s)) return '技術適合';
  if (/業界|ドメイン|経験/.test(s)) return '業界経験';
  if (/具体|記述|回答/.test(s)) return '具体性';
  if (/マネ|管理|推進|リーダ/.test(s)) return '管理推進';
  if (/安定|稼働|定着/.test(s)) return '安定性';
  // 緩いフォールバック：1単語ヒット
  if (s.includes('技術')) return '技術適合';
  if (s.includes('業界')) return '業界経験';
  if (s.includes('具体')) return '具体性';
  if (s.includes('管理')) return '管理推進';
  if (s.includes('安定')) return '安定性';
  return null;
}

// ===== Batch upload queue =====
const queue = []; // [{file, status:'pending'|'running'|'done'|'fail', id?, report?, error?}]

function wireUpload() {
  const drop = $('#drop');
  const file = $('#file');
  const run  = $('#runSummary');
  const clr  = $('#clearQueue');

  drop.addEventListener('click', () => file.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('hot'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('hot'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('hot');
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
  file.addEventListener('change', () => {
    if (file.files.length) addFiles(file.files);
    file.value = '';
  });

  clr.addEventListener('click', () => {
    queue.length = 0;
    renderQueue();
    resetDrop();
    $('#runMsg').textContent = '';
  });

  run.addEventListener('click', runBatch);
}

function addFiles(fl) {
  for (const f of fl) {
    if (queue.some(q => q.file.name === f.name && q.file.size === f.size)) continue;
    queue.push({ file: f, status: 'pending' });
  }
  renderQueue();
  updateButtons();
  $('#drop').innerHTML = `<div><b>${queue.length} 件選択中</b></div><div class="hint">クリック / ドラッグでさらに追加</div>`;
}

function resetDrop() {
  $('#drop').innerHTML = `
    <div style="font-size:32px; margin-bottom:6px; opacity:.5">⇪</div>
    <div><b>クリックで選択</b> または ドラッグ＆ドロップ（複数可）</div>
    <div class="hint" style="margin-top:6px">PDF / DOCX / XLS / XLSX / HTML</div>
    <input id="file" type="file" accept=".pdf,.docx,.xls,.xlsx,.html,.htm" multiple hidden />
  `;
  // re-wire input since innerHTML replaced it
  const file = $('#file');
  file.addEventListener('change', () => {
    if (file.files.length) addFiles(file.files);
    file.value = '';
  });
}

function statusIcon(s) {
  if (s === 'pending') return '○';
  if (s === 'running') return '<span class="spinner"></span>';
  if (s === 'done')    return '<span style="color:var(--green)">✓</span>';
  if (s === 'fail')    return '<span style="color:var(--coral-deep)">✗</span>';
  return '';
}

function renderQueue() {
  const host = $('#queue');
  if (!queue.length) { host.innerHTML = ''; return; }
  host.innerHTML = queue.map((q, i) => `
    <div class="qitem ${q.status}">
      <span class="q-status">${statusIcon(q.status)}</span>
      <span class="q-name" title="${escapeHtml(q.file.name)}">${escapeHtml(q.file.name)}</span>
      <span class="q-size">${(q.file.size/1024).toFixed(1)} KB</span>
      ${q.id ? `<a class="q-link" href="/reports/${encodeURIComponent(q.id)}.html" target="_blank">レポート</a>` : ''}
      ${q.error ? `<span class="q-err" title="${escapeHtml(q.error)}">${escapeHtml(q.error)}</span>` : ''}
      ${q.status === 'pending' ? `<span class="q-del" data-i="${i}" title="削除">×</span>` : ''}
    </div>
  `).join('');
  $$('#queue .q-del').forEach(el => {
    el.addEventListener('click', () => {
      queue.splice(Number(el.dataset.i), 1);
      renderQueue();
      updateButtons();
    });
  });
}

function updateButtons() {
  const run = $('#runSummary');
  const clr = $('#clearQueue');
  const hasPending = queue.some(q => q.status === 'pending');
  run.disabled = !hasPending;
  clr.style.display = queue.length ? 'inline-block' : 'none';
  run.textContent = queue.length > 1 ? '一括解析する' : '解析する';
}

async function runBatch() {
  const pending = queue.filter(q => q.status === 'pending');
  if (!pending.length) return;
  const run = $('#runSummary');
  run.disabled = true;

  // 当前 pending 在队列里的位置 → 服务器返回的 i 对应到这里
  const idxMap = new Map();
  pending.forEach((q, idx) => idxMap.set(idx, queue.indexOf(q)));

  const fd = new FormData();
  pending.forEach(q => fd.append('files', q.file));

  $('#runMsg').innerHTML = `<span class="spinner"></span> 並列解析を開始しています…`;

  try {
    const resp = await fetch('/api/summarize-batch', { method:'POST', body: fd });
    if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let total = pending.length, doneCnt = 0, failCnt = 0, concurrency = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }

        if (ev.event === 'start') {
          total = ev.total; concurrency = ev.concurrency;
          $('#runMsg').innerHTML = `<span class="spinner"></span> 並列解析中…（並列度 ${concurrency} / 全 ${total} 件）`;
          continue;
        }
        if (ev.event === 'end' || ev.fatal) continue;

        const qIdx = idxMap.get(ev.i);
        const q = queue[qIdx];
        if (!q) continue;
        q.status = ev.status;
        if (ev.id) q.id = ev.id;
        if (ev.report) q.report = ev.report;
        if (ev.error) q.error = ev.error;
        if (ev.status === 'done') doneCnt++;
        if (ev.status === 'fail') failCnt++;
        renderQueue();
        if (ev.status !== 'running') {
          $('#runMsg').innerHTML = `<span class="spinner"></span> 進捗 ${doneCnt + failCnt}/${total}（並列度 ${concurrency}）`;
        }
      }
    }
  } catch(e) {
    pending.forEach(q => { if (q.status === 'running') { q.status = 'fail'; q.error = e.message; } });
    renderQueue();
    $('#runMsg').textContent = '失敗：' + e.message;
    updateButtons();
    return;
  }

  const done = queue.filter(q => q.status === 'done').length;
  const fail = queue.filter(q => q.status === 'fail').length;
  $('#runMsg').innerHTML = `完了：成功 <b style="color:var(--green)">${done}</b> 件 ／ 失敗 <b style="color:var(--coral-deep)">${fail}</b> 件`;
  updateButtons();
  toast(`${done}/${queue.length} 件解析完了`);
}

// ===== History =====
async function loadHistory() {
  const host = $('#hist');
  const empty = $('#histEmpty');
  host.innerHTML = '<div class="empty"><span class="spinner"></span> 読み込み中…</div>';
  const list = await fetch('/api/reports').then(r => r.json());
  if (!list.length) {
    host.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  host.innerHTML = list.map(r => `
    <div class="h-card-wrap">
      <a class="h-card" href="/reports/${encodeURIComponent(r.id)}.html" target="_blank" style="text-decoration:none; color:inherit">
        <div class="h-name">${escapeHtml(r.name)}</div>
        <div class="h-pos">${escapeHtml(r.position)}</div>
        <div class="h-sum">${escapeHtml(r.summary)}</div>
        <div class="h-foot">${escapeHtml((r.createdAt||'').replace('T',' ').slice(0,16))} ｜ ${escapeHtml(r.id)}</div>
      </a>
      <button class="h-del" data-id="${escapeHtml(r.id)}" data-name="${escapeHtml(r.name)}" title="このレポートを削除">×</button>
    </div>
  `).join('');

  $$('#hist .h-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const id = btn.dataset.id;
      const name = btn.dataset.name;
      const ok = await confirmDialog({
        title: '評価履歴から削除',
        message: `「${name}」を評価履歴から削除します。\nこの操作は取り消せません。`,
        confirmText: '削除する',
        cancelText: 'キャンセル',
        danger: true,
      });
      if (!ok) return;
      btn.disabled = true;
      try {
        const r = await fetch(`/api/reports/${encodeURIComponent(id)}`, { method:'DELETE' }).then(r => r.json());
        if (r.error) throw new Error(r.error);
        toast(`削除しました（${r.deleted.length} ファイル）`);
        loadHistory();
      } catch (err) {
        toast('削除失敗：' + err.message);
        btn.disabled = false;
      }
    });
  });
}

// ===== Question tab =====
let qLastList = [];

async function loadQTab() {
  refreshReqStrip();
  const sel = $('#qCandidate');
  sel.innerHTML = '<option value="">読み込み中…</option>';
  try {
    qLastList = await fetch('/api/reports').then(r => r.json());
  } catch { qLastList = []; }
  if (!qLastList.length) {
    sel.innerHTML = '<option value="">候補者がいません — 先に「新規評価」で履歷を解析してください</option>';
    $('#qGenerate').disabled = true;
    return;
  }
  sel.innerHTML = '<option value="">— 候補者を選択 —</option>' +
    qLastList.map(r =>
      `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)} ｜ ${escapeHtml(r.position || '')} ｜ ${escapeHtml(r.id)}</option>`
    ).join('');

  sel.onchange = async () => {
    const id = sel.value;
    $('#qGenerate').disabled = !id;
    $('#qResult').innerHTML = '';
    $('#qMsg').textContent = '';
    if (!id) return;
    // 既存の質問があれば表示
    $('#qModeBar').style.display = 'none';
    $('#qAnswersPanel').style.display = 'none';
    $('#qAnswersPanel').innerHTML = '';
    try {
      const j = await fetch(`/api/questions/${encodeURIComponent(id)}`).then(r => r.json());
      if (!j.error && j.groups) {
        renderQuestions(j);
        updateQModeBar(j);
        if (j.answers) renderAnswersPanel(j.answers);
        const editedHint = (j.editedAt || j.generatedAt || '').replace('T', ' ').slice(0, 16);
        $('#qMsg').innerHTML = `保存済みの質問を表示中（編集日時：${escapeHtml(editedHint)}）。`;
        $('#qGenerate').textContent = '再生成する';
      } else {
        $('#qGenerate').textContent = '質問を生成';
      }
    } catch {
      $('#qGenerate').textContent = '質問を生成';
    }
  };

  $('#qGenerate').onclick = generateQuestions;
}

async function generateQuestions() {
  const id = $('#qCandidate').value;
  if (!id) return;
  const btn = $('#qGenerate');
  btn.disabled = true;
  $('#qMsg').innerHTML = '<span class="spinner"></span> 質問を生成中…（10〜20 秒）';
  $('#qResult').innerHTML = '';
  try {
    const j = await fetch('/api/generate-questions', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ candidateId: id }),
    }).then(r => r.json());
    if (j.error) throw new Error(j.error);
    // Re-fetch to get the canonical document with status / dispatch filled in
    const canon = await fetch(`/api/questions/${encodeURIComponent(id)}`).then(r => r.json()).catch(() => j);
    renderQuestions(canon);
    updateQModeBar(canon);
    $('#qMsg').innerHTML = `生成完了。<code>questions/${escapeHtml(id)}.json</code> に保存しました。`;
    btn.textContent = '再生成する';
    toast('質問を生成しました');
  } catch(e) {
    $('#qMsg').textContent = '失敗：' + e.message;
  } finally {
    btn.disabled = false;
  }
}

let qCurrentDoc = null; // {candidateId, groups:[...]}

function renderQuestions(j) {
  qCurrentDoc = j;
  const host = $('#qResult');
  const groups = j.groups || [];
  if (!groups.length) {
    host.innerHTML = '<div class="empty">生成された質問はありません</div>';
    return;
  }

  let n = 0;
  const numbered = groups.map(g => (g.items || []).map(q => ({ ...q, n: ++n })));
  const total = n;

  host.innerHTML = `
    <div class="actions" style="margin-bottom:10px; justify-content:flex-end; align-items:center">
      <span class="hint" style="margin-right:auto">全 <b style="font-family:var(--mono); color:var(--coral-deep)">${total}</b> 件 ／ ${groups.length} グループ</span>
      <button class="btn-ghost btn-small" id="qExpandAll">全て開く</button>
      <button class="btn-ghost btn-small" id="qCollapseAll">全て閉じる</button>
      <button class="btn-ghost" id="qCopyAll">全文コピー（本文のみ）</button>
    </div>
    ${groups.map((g, gi) => `
      <div class="q-acc-item ${gi === 0 ? 'open' : ''}" data-g="${gi}">
        <div class="q-acc-head">
          <div class="q-acc-title">
            <span class="q-acc-arrow">▶</span>
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(g.title || `グループ ${gi+1}`)}</span>
            <span class="q-acc-badge">${(g.items || []).length} 件</span>
          </div>
          <div class="q-acc-actions">
            <button class="btn-ghost btn-small q-copy-group" data-g="${gi}">グループコピー</button>
          </div>
        </div>
        <div class="q-acc-body">
          ${numbered[gi].map((q, qi) => `
            <div class="q-acc-q" data-g="${gi}" data-q="${qi}">
              <div class="q-num">Q${q.n}</div>
              <div class="q-body">
                <div class="q-text">${escapeHtml(q.text || '')}</div>
                <div class="q-aim"><b>狙い</b>${escapeHtml(q.aim || '')}</div>
                <div class="q-actions-row">
                  <button class="btn-ghost btn-small q-copy" data-g="${gi}" data-q="${qi}">本文コピー</button>
                  <button class="btn-ghost btn-small q-edit-btn" data-g="${gi}" data-q="${qi}">✎ 編集</button>
                  <button class="btn-ghost btn-small q-regen-btn" data-g="${gi}" data-q="${qi}">⟲ 再生成</button>
                </div>
                <div class="q-edit">
                  <textarea class="set-input q-edit-text" rows="3">${escapeHtml(q.text || '')}</textarea>
                  <textarea class="set-input q-edit-aim" rows="1" placeholder="狙い（HR 内部用）">${escapeHtml(q.aim || '')}</textarea>
                  <div class="q-edit-actions">
                    <button class="btn-primary btn-small q-save-btn" data-g="${gi}" data-q="${qi}">保存</button>
                    <button class="btn-ghost btn-small q-cancel-btn" data-g="${gi}" data-q="${qi}">キャンセル</button>
                  </div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('')}
  `;

  $$('#qResult .q-acc-head').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      el.parentElement.classList.toggle('open');
    });
  });

  $('#qExpandAll')?.addEventListener('click', () => $$('#qResult .q-acc-item').forEach(it => it.classList.add('open')));
  $('#qCollapseAll')?.addEventListener('click', () => $$('#qResult .q-acc-item').forEach(it => it.classList.remove('open')));

  $$('#qResult .q-copy').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const g = Number(btn.dataset.g), q = Number(btn.dataset.q);
      copyToClipboard(groups[g].items[q].text || '');
      toast('質問をコピーしました');
    });
  });
  $$('#qResult .q-copy-group').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const g = Number(btn.dataset.g);
      const text = (groups[g].items || []).map((q, i) => `${i+1}. ${q.text}`).join('\n\n');
      copyToClipboard(text);
      toast('グループをコピーしました');
    });
  });
  $('#qCopyAll')?.addEventListener('click', () => {
    let gn = 0;
    const text = groups.map(g =>
      `【${g.title || ''}】\n` +
      (g.items || []).map(q => `${++gn}. ${q.text}`).join('\n\n')
    ).join('\n\n');
    copyToClipboard(text);
    toast('全文をコピーしました');
  });

  // 編集
  $$('#qResult .q-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = btn.closest('.q-acc-q');
      row.classList.add('editing');
    });
  });
  $$('#qResult .q-cancel-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = btn.closest('.q-acc-q');
      const g = Number(row.dataset.g), q = Number(row.dataset.q);
      const original = qCurrentDoc.groups[g].items[q];
      row.querySelector('.q-edit-text').value = original.text || '';
      row.querySelector('.q-edit-aim').value = original.aim || '';
      row.classList.remove('editing');
    });
  });
  $$('#qResult .q-save-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const row = btn.closest('.q-acc-q');
      const g = Number(row.dataset.g), q = Number(row.dataset.q);
      const newText = row.querySelector('.q-edit-text').value.trim();
      const newAim  = row.querySelector('.q-edit-aim').value.trim();
      if (!newText) { toast('本文は空にできません'); return; }
      qCurrentDoc.groups[g].items[q] = { text: newText, aim: newAim };
      btn.disabled = true;
      try {
        await persistQuestions();
        row.querySelector('.q-text').textContent = newText;
        row.querySelector('.q-aim').innerHTML = `<b>狙い</b>${escapeHtml(newAim)}`;
        row.classList.remove('editing');
        toast('保存しました');
      } catch (err) {
        toast('保存失敗：' + err.message);
      } finally { btn.disabled = false; }
    });
  });

  // 個別再生成
  $$('#qResult .q-regen-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const row = btn.closest('.q-acc-q');
      const g = Number(row.dataset.g), q = Number(row.dataset.q);
      btn.disabled = true;
      const origLabel = btn.textContent;
      btn.innerHTML = '<span class="spinner"></span> 再生成中…';
      try {
        const r = await fetch('/api/regenerate-question', {
          method:'POST', headers:{'content-type':'application/json'},
          body: JSON.stringify({ candidateId: qCurrentDoc.candidateId, groupIndex: g, itemIndex: q }),
        }).then(r => r.json());
        if (r.error) throw new Error(r.error);
        qCurrentDoc.groups[g].items[q] = { text: r.text, aim: r.aim || '' };
        row.querySelector('.q-text').textContent = r.text;
        row.querySelector('.q-aim').innerHTML = `<b>狙い</b>${escapeHtml(r.aim || '')}`;
        row.querySelector('.q-edit-text').value = r.text;
        row.querySelector('.q-edit-aim').value  = r.aim || '';
        toast('再生成しました');
      } catch (err) {
        toast('再生成失敗：' + err.message);
      } finally {
        btn.disabled = false; btn.textContent = origLabel;
      }
    });
  });
}

async function persistQuestions() {
  if (!qCurrentDoc?.candidateId) throw new Error('candidate id 不明');
  const r = await fetch(`/api/questions/${encodeURIComponent(qCurrentDoc.candidateId)}`, {
    method:'PUT',
    headers:{'content-type':'application/json'},
    body: JSON.stringify({ groups: qCurrentDoc.groups }),
  }).then(r => r.json());
  if (r.error) throw new Error(r.error);
  return r;
}

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch {}
  document.body.removeChild(ta);
}

function updateQModeBar(j) {
  const bar = $('#qModeBar');
  if (!bar) return;
  const result = $('#qResult');
  if (result) result.classList.toggle('locked', (j.status || 'draft') !== 'draft');
  bar.style.display = 'flex';
  const badge = $('#qStatusBadge');
  const hint = $('#qStatusHint');
  const status = j.status || 'draft';
  badge.className = `badge ${status}`;
  const labels = {
    draft: '編集中',
    sent: '公開中',
    submitted: '提出済',
    expired: '期限切れ',
    closed: '手動終了',
  };
  badge.textContent = labels[status] || status;
  hint.textContent =
    status === 'sent' && j.dispatch?.expiresAt
      ? `残り ${remainingDays(j.dispatch.expiresAt)} 日`
      : '';
  $('#qDispatchBtn').style.display = status === 'draft' ? '' : 'none';
  $('#qFetchBtn').style.display = status === 'sent' ? '' : 'none';
  $('#qCloseBtn').style.display = status === 'sent' ? '' : 'none';
}

function remainingDays(iso) {
  if (!iso) return '?';
  const d = Math.ceil((new Date(iso) - new Date()) / 86400000);
  return Math.max(0, d);
}

function renderAnswersPanel(a) {
  const host = $('#qAnswersPanel');
  if (!host || !a) return;
  host.style.display = 'block';
  const submittedAt = (a.respondent?.submittedAt || '').replace('T', ' ').slice(0, 16);
  host.innerHTML = `
    <div class="card" style="margin-top:16px">
      <h3>取込済の回答</h3>
      <div class="hint">提出日時：${escapeHtml(submittedAt)}</div>
      <div><b>メアド：</b>${escapeHtml(a.respondent?.email || '')}</div>
      <div><b>氏名確認：</b>${escapeHtml(a.respondent?.nameConfirmed || '')}</div>
      <hr/>
      ${(a.answers || []).map((x, i) => `
        <div style="margin:10px 0">
          <div class="q-num">Q${i + 3}</div>
          <div class="q-text">${escapeHtml(x.questionText || '')}</div>
          ${x.aim ? `<div class="q-aim"><b>狙い</b>${escapeHtml(x.aim)}</div>` : ''}
          <div style="background:#f5f0e8; padding:8px; margin-top:4px; white-space:pre-wrap; border-radius:6px">${escapeHtml(x.answerText || '')}</div>
        </div>
      `).join('')}
      ${a.supplementary ? `
        <hr/>
        <div><b>補足</b></div>
        <div style="background:#f5f0e8; padding:8px; white-space:pre-wrap; border-radius:6px">${escapeHtml(a.supplementary)}</div>
      ` : ''}
    </div>
  `;
}

// ---------------- 公開 / 取得 / 終了 ----------------

$('#qDispatchBtn')?.addEventListener('click', async () => {
  if (!qCurrentDoc) return;
  const candidateName = qCurrentDoc.candidateName;
  if (!candidateName || candidateName === '(匿名)') {
    if (!confirm('候補者氏名が未設定です。メール文面の {候補者名} は「候補者」で展開されます。続行しますか？')) return;
  }
  if (!confirm('アンケートを公開しますか？\n以降、質問の編集は無効化されます。')) return;

  showDispatchModal({ loading: true });
  $('#qDispatchBtn').disabled = true;
  try {
    const id = qCurrentDoc.candidateId;
    const r = await fetch(`/api/questions/${encodeURIComponent(id)}/dispatch`, { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `dispatch failed (${r.status})`);
    showDispatchModal({ result: j });
    // Reload canonical doc to update status badge
    const canon = await fetch(`/api/questions/${encodeURIComponent(id)}`).then(rr => rr.json()).catch(() => null);
    if (canon && canon.groups) {
      qCurrentDoc = canon;
      updateQModeBar(canon);
    }
  } catch (e) {
    showDispatchModal({ error: e.message });
  } finally {
    $('#qDispatchBtn').disabled = false;
  }
});

$('#qFetchBtn')?.addEventListener('click', async () => {
  if (!qCurrentDoc) return;
  const btn = $('#qFetchBtn');
  btn.disabled = true;
  try {
    const id = qCurrentDoc.candidateId;
    const r = await fetch(`/api/questions/${encodeURIComponent(id)}/fetch`, { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `fetch failed (${r.status})`);
    if (j.status === 'pending') {
      toast('まだ回答がありません');
    } else if (j.status === 'submitted') {
      toast('回答を取得しました');
      const canon = await fetch(`/api/questions/${encodeURIComponent(id)}`).then(rr => rr.json()).catch(() => null);
      if (canon && canon.groups) {
        qCurrentDoc = canon;
        updateQModeBar(canon);
        if (canon.answers) renderAnswersPanel(canon.answers);
      }
    }
  } catch (e) {
    toast('取得失敗：' + e.message);
  } finally {
    btn.disabled = false;
  }
});

$('#qCloseBtn')?.addEventListener('click', async () => {
  if (!qCurrentDoc) return;
  if (!confirm('このアンケートを手動終了しますか？\n候補者がアクセスしても回答できなくなります。')) return;
  const btn = $('#qCloseBtn');
  btn.disabled = true;
  try {
    const id = qCurrentDoc.candidateId;
    const r = await fetch(`/api/questions/${encodeURIComponent(id)}/close`, { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `close failed (${r.status})`);
    toast('アンケートを終了しました');
    const canon = await fetch(`/api/questions/${encodeURIComponent(id)}`).then(rr => rr.json()).catch(() => null);
    if (canon && canon.groups) {
      qCurrentDoc = canon;
      updateQModeBar(canon);
    }
  } catch (e) {
    toast('終了失敗：' + e.message);
  } finally {
    btn.disabled = false;
  }
});

function showDispatchModal({ loading, result, error }) {
  const m = $('#qDispatchModal');
  if (!m) return;
  m.style.display = 'flex';
  let inner;
  if (loading) {
    inner = '<div><span class="spinner"></span> Vercel に問巻データを送信しています…</div>';
  } else if (error) {
    const errMsg = error === 'no_survey_config'
      ? 'Vercel 接続が未設定です。<br/>設定タブの「Vercel アンケート連携」でエンドポイントと API Key を登録してください。'
      : `公開失敗：${escapeHtml(error)}`;
    inner = `
      <div style="color:var(--coral-deep, #c0392b)">✗ ${errMsg}</div>
      <div class="actions" style="margin-top:16px; justify-content:flex-end"><button class="btn-ghost" data-close>閉じる</button></div>
    `;
  } else if (result) {
    inner = renderDispatchResult(result);
  } else {
    inner = '';
  }
  m.innerHTML = `<div class="modal-card">${inner}</div>`;

  // Wire close buttons
  m.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { m.style.display = 'none'; }));
  // Wire result-specific buttons (only present when result is rendered)
  const copyUrlBtn = m.querySelector('[data-copy-url]');
  if (copyUrlBtn && result) {
    copyUrlBtn.addEventListener('click', () => {
      copyToClipboard(result.surveyUrl);
      toast('URL をコピーしました');
    });
  }
  const copyEmailBtn = m.querySelector('[data-copy-email]');
  if (copyEmailBtn && result) {
    copyEmailBtn.addEventListener('click', () => {
      copyToClipboard(`件名：${result.email.subject}\n\n${result.email.body}`);
      toast('メール文面をコピーしました');
    });
  }
  const mailBtn = m.querySelector('[data-send-mail]');
  if (mailBtn && result) {
    mailBtn.addEventListener('click', () => {
      const to = m.querySelector('[data-mail-to]')?.value?.trim() ?? '';
      const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(result.email.subject)}&body=${encodeURIComponent(result.email.body)}`;
      window.location.href = url;
    });
  }
}

function renderDispatchResult(r) {
  const expires = (r.expiresAt || '').replace('T', ' ').slice(0, 16);
  return `
    <h3>✓ アンケートを公開しました</h3>
    <div class="hint" style="margin-top:8px">候補者用 URL</div>
    <div style="display:flex; gap:8px; margin:6px 0">
      <input class="set-input" value="${escapeHtml(r.surveyUrl)}" readonly style="flex:1" />
      <button class="btn-ghost" data-copy-url>コピー</button>
    </div>
    <div class="hint" style="margin-top:4px">期限：${escapeHtml(expires)}</div>

    <h4 style="margin-top:16px; margin-bottom:6px">メール文面</h4>
    <div style="margin-bottom:6px"><b>件名：</b>${escapeHtml(r.email.subject)}</div>
    <textarea class="set-input" rows="10" readonly style="width:100%; font-family:var(--mono, monospace); font-size:13px">${escapeHtml(r.email.body)}</textarea>

    <h4 style="margin-top:16px; margin-bottom:6px">送信先（任意）</h4>
    <div style="display:flex; gap:8px">
      <input data-mail-to type="email" class="set-input" placeholder="candidate@example.com" style="flex:1" />
      <button class="btn-ghost" data-send-mail>メーラーで開く</button>
    </div>

    <div class="actions" style="margin-top:16px; justify-content:flex-end; gap:8px">
      <button class="btn-ghost" data-copy-email>メール文面をコピー</button>
      <button class="btn-primary" data-close>閉じる</button>
    </div>
  `;
}

boot();
