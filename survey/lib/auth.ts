import { NextRequest } from 'next/server';

export function requireApiKey(req: NextRequest): { ok: true } | { ok: false; status: 401 | 500 } {
  const expected = process.env.SURVEY_API_KEY;
  if (!expected) return { ok: false, status: 500 };
  const auth = req.headers.get('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m || m[1] !== expected) return { ok: false, status: 401 };
  return { ok: true };
}
