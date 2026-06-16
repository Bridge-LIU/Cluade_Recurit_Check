import { NextRequest, NextResponse } from 'next/server';
import { redis, k } from '@/lib/redis';
import { SubmitPayloadSchema } from '@/lib/schema';
import type { SurveyDocument } from '@shared/types';

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const { token } = params;

  const doc = await redis.get<SurveyDocument>(k.survey(token));
  if (!doc) return NextResponse.json({ error: 'expired' }, { status: 410 });

  const expiresAt = new Date(doc.expiresAt).getTime();
  if (Date.now() > expiresAt) return NextResponse.json({ error: 'expired' }, { status: 410 });

  const locked = await redis.exists(k.lock(token));
  if (locked) return NextResponse.json({ error: 'already_submitted' }, { status: 409 });

  const body = await req.json().catch(() => null);
  const parsed = SubmitPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', details: parsed.error.format() }, { status: 400 });
  }

  // SETNX で原子ロック
  const lockResult = await redis.set(k.lock(token), '1', { nx: true, ex: 604800 });
  if (lockResult === null) {
    return NextResponse.json({ error: 'already_submitted' }, { status: 409 });
  }

  const submittedAt = new Date().toISOString();
  await redis.set(k.response(token), { ...parsed.data, submittedAt }, { ex: 604800 });
  await redis.sadd(k.pending, token);

  return NextResponse.json({ ok: true });
}
