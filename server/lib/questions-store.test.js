import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { readQuestions, writeQuestions, defaultDispatch } from './questions-store.js';

let tmpDir;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clarus-test-'));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('readQuestions', () => {
  it('fills missing status/dispatch fields with defaults', async () => {
    const legacy = { candidateId: 'a1', candidateName: 'X', groups: [] };
    await fs.writeFile(path.join(tmpDir, 'a1.json'), JSON.stringify(legacy));
    const r = await readQuestions(tmpDir, 'a1');
    expect(r.status).toBe('draft');
    expect(r.dispatch).toEqual(defaultDispatch());
    expect(r.editedAt).toBeTruthy();
  });

  it('preserves existing status and dispatch', async () => {
    const newer = {
      candidateId: 'a1', candidateName: 'X', groups: [],
      status: 'sent',
      editedAt: '2026-06-16T10:00:00Z',
      dispatch: { token: 'abc', surveyUrl: 'u', createdAt: 'c', sentAt: 's', expiresAt: 'e' },
    };
    await fs.writeFile(path.join(tmpDir, 'a1.json'), JSON.stringify(newer));
    const r = await readQuestions(tmpDir, 'a1');
    expect(r.status).toBe('sent');
    expect(r.dispatch.token).toBe('abc');
  });
});

describe('writeQuestions', () => {
  it('writes JSON file', async () => {
    await writeQuestions(tmpDir, 'a1', {
      candidateId: 'a1', candidateName: 'X', groups: [],
      status: 'draft', editedAt: '2026-06-16T00:00:00Z', dispatch: defaultDispatch(),
    });
    const raw = await fs.readFile(path.join(tmpDir, 'a1.json'), 'utf8');
    expect(JSON.parse(raw).candidateId).toBe('a1');
  });
});
