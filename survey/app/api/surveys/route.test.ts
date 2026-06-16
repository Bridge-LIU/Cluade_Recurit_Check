import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/redis', () => ({
  redis: { set: vi.fn().mockResolvedValue('OK') },
  k: { survey: (t: string) => `q:${t}` },
}));

process.env.SURVEY_API_KEY = 'test-key';

function makeReq(body: unknown, auth = 'Bearer test-key') {
  return new NextRequest('http://localhost/api/surveys', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify(body),
  });
}

const validBody = {
  candidateId: 'a1',
  candidateName: '山田',
  position: 'NW Engineer',
  groups: [{ title: 'g1', items: [{ text: 'q1', aim: 'aim1' }] }],
  companyName: 'X',
  hrName: 'Y',
  hrEmail: 'z@x.com',
  surveyPageTitle: 'T',
  surveyPageDescription: 'D',
  ttlSeconds: 604800,
};

describe('POST /api/surveys', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects without API key', async () => {
    const res = await POST(makeReq(validBody, 'Bearer wrong'));
    expect(res.status).toBe(401);
  });

  it('returns token and url on success', async () => {
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.token).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(json.surveyUrl).toContain(json.token);
    expect(json.expiresAt).toBeTruthy();
  });

  it('rejects invalid body', async () => {
    const res = await POST(makeReq({ candidateId: '' }));
    expect(res.status).toBe(400);
  });
});
