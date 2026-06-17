import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { loadSettings, saveSettings, loadSurveyConfig, defaultSettings } from './settings.js';

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
