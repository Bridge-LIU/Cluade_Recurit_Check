import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { redis, k } from '@/lib/redis';

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const auth = requireApiKey(req);
  if (!auth.ok) return NextResponse.json({ error: 'unauthorized' }, { status: auth.status });

  const { token } = params;
  await redis.set(k.lock(token), '1', { ex: 604800 });
  return NextResponse.json({ ok: true });
}
