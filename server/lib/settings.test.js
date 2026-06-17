import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { loadSettings, saveSettings, loadSurveyConfig, saveSurveyConfig, defaultSettings } from './settings.js';

let tmpDir, presets, clarusDir;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clarus-set-'));
  presets = path.join(tmpDir, 'presets');
  clarusDir = path.join(tmpDir, '.clarus');
  await fs.mkdir(presets, { recursive: true });
  await fs.mkdir(clarusDir, { recursive: true });
});
afterEach(() => fs.rm(tmpDir, { recursive: true, force: true }));

describe('loadSettings', () => {
  it('returns defaults when file missing', async () => {
    const s = await loadSettings(presets);
    expect(s.companyName).toBe(defaultSettings().companyName);
  });

  it('reads existing settings.json', async () => {
    await fs.writeFile(path.join(presets, 'settings.json'),
      JSON.stringify({ companyName: 'BridgeVC' }));
    const s = await loadSettings(presets);
    expect(s.companyName).toBe('BridgeVC');
  });
});

describe('loadSurveyConfig', () => {
  it('returns null when missing', async () => {
    const c = await loadSurveyConfig(clarusDir);
    expect(c).toBeNull();
  });

  it('reads endpoint and apiKey', async () => {
    await fs.writeFile(path.join(clarusDir, 'survey-config.json'),
      JSON.stringify({ endpoint: 'https://x.vercel.app', apiKey: 'k' }));
    const c = await loadSurveyConfig(clarusDir);
    expect(c.endpoint).toBe('https://x.vercel.app');
    expect(c.apiKey).toBe('k');
  });
});

describe('saveSettings round-trip', () => {
  it('saveSettings then loadSettings returns same content', async () => {
    const original = { ...defaultSettings(), companyName: 'BridgeVC', hrName: '山田' };
    await saveSettings(presets, original);
    const reloaded = await loadSettings(presets);
    expect(reloaded.companyName).toBe('BridgeVC');
    expect(reloaded.hrName).toBe('山田');
    expect(reloaded.emailTemplate.subject).toBe(original.emailTemplate.subject);
  });

  it('partial nested template falls back to default for missing nested keys', async () => {
    await fs.writeFile(path.join(presets, 'settings.json'),
      JSON.stringify({ emailTemplate: { subject: 'custom' } }));
    const s = await loadSettings(presets);
    expect(s.emailTemplate.subject).toBe('custom');
    expect(s.emailTemplate.body).toBe(defaultSettings().emailTemplate.body);
  });
});

describe('saveSurveyConfig', () => {
  it('creates .clarus directory if missing and writes config', async () => {
    const freshClarusDir = path.join(tmpDir, '.clarus-fresh');
    // do NOT pre-create — verify the recursive mkdir works
    await saveSurveyConfig(freshClarusDir, { endpoint: 'https://x.vercel.app', apiKey: 'k' });
    const c = await loadSurveyConfig(freshClarusDir);
    expect(c.endpoint).toBe('https://x.vercel.app');
    expect(c.apiKey).toBe('k');
  });
});
