// server/lib/scoring.js
// 候補者のアンケート回答を Claude (-p) で採点する。
// 各質問 0-100 点 + 1〜2 文の点評、最後に平均点。

import { spawn } from 'child_process';

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p'], { shell: true, windowsHide: true });
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

function parseJsonResponse(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('JSON body not found');
  return JSON.parse(body.slice(start, end + 1));
}

function buildPrompt(answers) {
  const qaList = answers.map((a, i) =>
    `【質問${i + 1}】（${a.groupTitle || ''}）\n質問: ${a.questionText}\n意図(HR用): ${a.aim || '（指定なし）'}\n回答: ${a.answerText || '（未回答）'}`
  ).join('\n\n');

  return `あなたは面接前アンケート回答の評価アシスタントです。以下の各質問・回答について、0〜100 の整数で点数を付け、1〜2 文の簡潔な点評を付けてください。

評価軸の参考：
- 質問の意図に対する答えの的確さ
- 具体性（数字・固有名詞・経験の詳細）
- 論理的な構成と一貫性

未回答や極端に短い回答は低めに（10〜30 点）。

${qaList}

出力は以下の JSON のみ。前置き・後書き・コードフェンス禁止:
{
  "scores": [
    {"score": 85, "comment": "..."},
    {"score": 70, "comment": "..."}
  ]
}

scores 配列の長さと順序は質問と同じにしてください。`;
}

export async function scoreAnswers(answersData, { claude = callClaude } = {}) {
  if (!Array.isArray(answersData.answers) || answersData.answers.length === 0) {
    return { ...answersData, averageScore: null, scoredAt: null };
  }

  const prompt = buildPrompt(answersData.answers);
  const raw = await claude(prompt);
  const parsed = parseJsonResponse(raw);

  if (!Array.isArray(parsed.scores)) {
    throw new Error('scores が配列でない');
  }
  if (parsed.scores.length !== answersData.answers.length) {
    throw new Error(`scores 長さ不一致: 期待 ${answersData.answers.length}、実際 ${parsed.scores.length}`);
  }

  const scored = answersData.answers.map((a, i) => {
    const s = parsed.scores[i];
    const num = typeof s?.score === 'number' ? Math.round(Math.max(0, Math.min(100, s.score))) : null;
    return { ...a, score: num, scoreComment: s?.comment ?? '' };
  });

  const valid = scored.map((a) => a.score).filter((s) => typeof s === 'number');
  const averageScore = valid.length > 0
    ? Math.round(valid.reduce((acc, s) => acc + s, 0) / valid.length)
    : null;

  return {
    ...answersData,
    answers: scored,
    averageScore,
    scoredAt: new Date().toISOString(),
  };
}
