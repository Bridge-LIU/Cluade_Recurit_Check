import { describe, it, expect, vi } from 'vitest';
import { scoreAnswers } from './scoring.js';

const sampleAnswers = {
  candidateId: 'a1',
  token: 'tok',
  fetchedAt: '2026-06-17T00:00:00Z',
  respondent: { email: 'a@b.com', nameConfirmed: 'X', submittedAt: '2026-06-17T00:00:00Z' },
  answers: [
    { groupTitle: 'G', questionText: 'Q1', aim: 'A1', answerText: 'ans1' },
    { groupTitle: 'G', questionText: 'Q2', aim: 'A2', answerText: 'ans2' },
  ],
  supplementary: '',
};

describe('scoreAnswers', () => {
  it('attaches per-question score + comment and average', async () => {
    const claude = vi.fn().mockResolvedValue(JSON.stringify({
      scores: [
        { score: 80, comment: '良い' },
        { score: 60, comment: '具体性不足' },
      ],
    }));
    const r = await scoreAnswers(sampleAnswers, { claude });
    expect(r.answers[0].score).toBe(80);
    expect(r.answers[0].scoreComment).toBe('良い');
    expect(r.answers[1].score).toBe(60);
    expect(r.averageScore).toBe(70);
    expect(r.scoredAt).toBeTruthy();
  });

  it('clamps scores to 0..100', async () => {
    const claude = vi.fn().mockResolvedValue(JSON.stringify({
      scores: [{ score: 150, comment: '' }, { score: -20, comment: '' }],
    }));
    const r = await scoreAnswers(sampleAnswers, { claude });
    expect(r.answers[0].score).toBe(100);
    expect(r.answers[1].score).toBe(0);
    expect(r.averageScore).toBe(50);
  });

  it('handles code-fenced JSON output', async () => {
    const claude = vi.fn().mockResolvedValue('```json\n{"scores":[{"score":50,"comment":""},{"score":70,"comment":""}]}\n```');
    const r = await scoreAnswers(sampleAnswers, { claude });
    expect(r.averageScore).toBe(60);
  });

  it('throws on length mismatch', async () => {
    const claude = vi.fn().mockResolvedValue(JSON.stringify({ scores: [{ score: 80, comment: '' }] }));
    await expect(scoreAnswers(sampleAnswers, { claude })).rejects.toThrow(/長さ不一致/);
  });

  it('returns null average when answers list is empty', async () => {
    const claude = vi.fn();
    const r = await scoreAnswers({ ...sampleAnswers, answers: [] }, { claude });
    expect(r.averageScore).toBeNull();
    expect(r.scoredAt).toBeNull();
    expect(claude).not.toHaveBeenCalled();
  });
});
