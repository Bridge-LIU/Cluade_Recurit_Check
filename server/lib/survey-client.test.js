import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSurvey, fetchResult, closeSurvey } from './survey-client.js';

const config = { endpoint: 'https://x.vercel.app', apiKey: 'k' };

beforeEach(() => {
  global.fetch = vi.fn();
});

describe('createSurvey', () => {
  it('POSTs to /api/surveys with auth header', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ token: 't', surveyUrl: 'u', expiresAt: 'e' }),
    });
    const r = await createSurvey(config, { candidateId: 'a' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://x.vercel.app/api/surveys',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer k' }),
      })
    );
    expect(r.token).toBe('t');
  });

  it('throws on non-ok', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
      json: async () => ({ error: 'unauthorized' }),
    });
    await expect(createSurvey(config, {})).rejects.toThrow(/401/);
  });

  it('propagates network errors', async () => {
    global.fetch.mockRejectedValue(new Error('network'));
    await expect(createSurvey(config, {})).rejects.toThrow('network');
  });
});

describe('fetchResult', () => {
  it('GETs /result?ack=1 and returns json', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'pending' }) });
    const r = await fetchResult(config, 'tok');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://x.vercel.app/api/surveys/tok/result?ack=1',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer k' }) })
    );
    expect(r.status).toBe('pending');
  });

  it('does not set Content-Type on GET /result', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    await fetchResult(config, 'tok');
    const sentHeaders = global.fetch.mock.calls[0][1].headers;
    expect(sentHeaders['Content-Type']).toBeUndefined();
    expect(sentHeaders.Authorization).toBe('Bearer k');
  });

  it('URL-encodes the token', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    await fetchResult(config, 'a/b?c');
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('a%2Fb%3Fc');
  });

  it('fetchResult passes signal to fetch when provided', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const ctrl = new AbortController();
    await fetchResult(config, 'tok', { signal: ctrl.signal });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: ctrl.signal })
    );
  });
});

describe('closeSurvey', () => {
  it('POSTs /close without Content-Type since there is no body', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await closeSurvey(config, 'tok');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://x.vercel.app/api/surveys/tok/close',
      expect.objectContaining({ method: 'POST' })
    );
    const sentHeaders = global.fetch.mock.calls[0][1].headers;
    expect(sentHeaders['Content-Type']).toBeUndefined();
  });
});
