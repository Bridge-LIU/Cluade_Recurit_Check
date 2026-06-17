import { describe, it, expect } from 'vitest';
import { expandTemplate, buildTemplateVars } from './template.js';

describe('expandTemplate', () => {
  it('replaces placeholders', () => {
    const tpl = 'こんにちは {候補者名} 様、{ポジション} 募集です。';
    const out = expandTemplate(tpl, { 候補者名: '山田', ポジション: 'NW' });
    expect(out).toBe('こんにちは 山田 様、NW 募集です。');
  });

  it('leaves unknown placeholders as-is', () => {
    expect(expandTemplate('{不明} あり', { 候補者名: 'X' })).toBe('{不明} あり');
  });

  it('handles all dispatch placeholders', () => {
    const tpl = '{候補者名}|{ポジション}|{会社名}|{HR 名}|{Survey URL}|{締切日}';
    const out = expandTemplate(tpl, {
      候補者名: 'N', ポジション: 'P', 会社名: 'C', 'HR 名': 'H',
      'Survey URL': 'U', 締切日: '2026-06-23',
    });
    expect(out).toBe('N|P|C|H|U|2026-06-23');
  });

  it('handles empty vars object (all unknown left as-is)', () => {
    expect(expandTemplate('{a}-{b}', {})).toBe('{a}-{b}');
  });

  it('replaces the same placeholder multiple times', () => {
    const tpl = '{候補者名} と {候補者名} さん';
    expect(expandTemplate(tpl, { 候補者名: '山田' })).toBe('山田 と 山田 さん');
  });
});

describe('buildTemplateVars', () => {
  it('returns canonical fallback strings when inputs are empty', () => {
    const v = buildTemplateVars({
      candidateName: '',
      position: '',
      settings: { companyName: '', hrName: '' },
      surveyUrl: '',
      expiresAt: '',
    });
    expect(v['候補者名']).toBe('候補者');
    expect(v['ポジション']).toBe('ご応募ポジション');
    expect(v['会社名']).toBe('弊社');
    expect(v['HR 名']).toBe('採用担当');
    expect(v['Survey URL']).toBe('');
    expect(v['締切日']).toBe('');
  });

  it('slices expiresAt to YYYY-MM-DD', () => {
    const v = buildTemplateVars({
      candidateName: 'X', position: 'P',
      settings: { companyName: 'C', hrName: 'H' },
      surveyUrl: 'U',
      expiresAt: '2026-06-23T15:00:00Z',
    });
    expect(v['締切日']).toBe('2026-06-23');
  });
});
