import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { redis, k } from '@/lib/redis';
import { log } from '@/lib/logger';

export const runtime = 'edge';

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const auth = requireApiKey(req);
  if (!auth.ok) {
    log.warn('surveys.result.unauthorized', { status: auth.status });
    return NextResponse.json({ error: 'unauthorized' }, { status: auth.status });
  }

  const { token } = params;
  const resp = await redis.get(k.response(token));
  if (!resp) return NextResponse.json({ status: 'pending' });

  const ack = req.nextUrl.searchParams.get('ack') === '1';
  if (ack) {
    await redis.srem(k.pending, token);
    log.info('surveys.result.ack', { token });
  }

  return NextResponse.json({ status: 'submitted', response: resp });
}
