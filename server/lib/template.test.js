import { describe, it, expect } from 'vitest';
import { expandTemplate } from './template.js';

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
