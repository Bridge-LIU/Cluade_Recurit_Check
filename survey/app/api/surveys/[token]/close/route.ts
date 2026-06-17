import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { redis, k } from '@/lib/redis';
import { log } from '@/lib/logger';

export const runtime = 'edge';

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const auth = requireApiKey(req);
  if (!auth.ok) {
    log.warn('surveys.close.unauthorized', { status: auth.status });
    return NextResponse.json({ error: 'unauthorized' }, { status: auth.status });
  }

  const { token } = params;
  await redis.set(k.lock(token), '1', { ex: 604800 });
  log.info('surveys.close.ok', { token });
  return NextResponse.json({ ok: true });
}
