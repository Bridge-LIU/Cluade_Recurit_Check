import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

const pipelineMock = vi.hoisted(() => ({
  set: vi.fn(),
  sadd: vi.fn(),
  exec: vi.fn(),
}));

const redisMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  pipeline: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({
  redis: redisMock,
  k: {
    survey: (t: string) => `q:${t}`,
    lock: (t: string) => `q:${t}:lock`,
    response: (t: string) => `q:${t}:resp`,
    pending: 'pending:hr',
  },
}));

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/surveys/x/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  email: 'a@b.com',
  nameConfirmed: '山田',
  answers: [{ questionText: 'Q', answerText: 'A' }],
  supplementary: '',
};

describe('POST /api/surveys/[token]/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.get.mockResolvedValue({ expiresAt: new Date(Date.now() + 1000_000).toISOString() });
    redisMock.set.mockResolvedValue('OK');
    redisMock.pipeline.mockReturnValue(pipelineMock);
    pipelineMock.set.mockReturnValue(pipelineMock);
    pipelineMock.sadd.mockReturnValue(pipelineMock);
    pipelineMock.exec.mockResolvedValue([]);
  });

  it('returns 410 if survey expired/missing', async () => {
    redisMock.get.mockResolvedValueOnce(null);
    const res = await POST(makeReq(validBody), { params: { token: 'x' } });
    expect(res.status).toBe(410);
  });

  it('returns 409 if lock already set', async () => {
    redisMock.set.mockResolvedValueOnce(null);
    const res = await POST(makeReq(validBody), { params: { token: 'x' } });
    expect(res.status).toBe(409);
  });

  it('returns 400 on invalid email', async () => {
    const res = await POST(makeReq({ ...validBody, email: 'not-an-email' }), { params: { token: 'x' } });
    expect(res.status).toBe(400);
  });

  it('stores response and sets lock on success', async () => {
    const res = await POST(makeReq(validBody), { params: { token: 'x' } });
    expect(res.status).toBe(200);
    expect(redisMock.set).toHaveBeenCalledWith('q:x:lock', '1', expect.objectContaining({ nx: true }));
    expect(pipelineMock.set).toHaveBeenCalledWith('q:x:resp', expect.any(Object), expect.any(Object));
    expect(pipelineMock.sadd).toHaveBeenCalledWith('pending:hr', 'x');
    expect(pipelineMock.exec).toHaveBeenCalled();
  });
});
