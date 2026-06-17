// server/lib/questions-store.js
// questions/{id}.json の読書ラッパ。後方互換性を維持。

import fs from 'fs/promises';
import path from 'path';

export function defaultDispatch() {
  return {
    token: null,
    surveyUrl: null,
    createdAt: null,
    sentAt: null,
    expiresAt: null,
    lastPolledAt: null,
    closedAt: null,
    closeReason: null,
  };
}

export async function readQuestions(dir, id) {
  const p = path.join(dir, `${id}.json`);
  const raw = await fs.readFile(p, 'utf8');
  const data = JSON.parse(raw);
  return {
    ...data,
    status: data.status ?? 'draft',
    editedAt: data.editedAt ?? data.generatedAt ?? new Date().toISOString(),
    dispatch: { ...defaultDispatch(), ...(data.dispatch ?? {}) },
  };
}

export async function writeQuestions(dir, id, data) {
  const p = path.join(dir, `${id}.json`);
  await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8');
}

export async function readAnswers(dir, id) {
  const p = path.join(dir, `${id}.answers.json`);
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function writeAnswers(dir, id, data) {
  const p = path.join(dir, `${id}.answers.json`);
  await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8');
}
