import { NextRequest, NextResponse } from 'next/server';
import { redis, k } from '@/lib/redis';
import { SubmitPayloadSchema } from '@/lib/schema';
import { log } from '@/lib/logger';
import type { SurveyDocument } from '@shared/types';

export const runtime = 'edge';

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const { token } = params;

  const doc = await redis.get<SurveyDocument>(k.survey(token));
  if (!doc) {
    log.info('surveys.submit.expired', { token });
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }

  if (Date.now() > new Date(doc.expiresAt).getTime()) {
    log.info('surveys.submit.expired', { token });
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }

  const body = await req.json().catch(() => null);
  const parsed = SubmitPayloadSchema.safeParse(body);
  if (!parsed.success) {
    log.warn('surveys.submit.invalid', { token });
    return NextResponse.json({ error: 'invalid', details: parsed.error.format() }, { status: 400 });
  }

  // SETNX が単独で重複送信を阻止する（exists の事前確認は冗長なので削除）
  const lockResult = await redis.set(k.lock(token), '1', { nx: true, ex: 604800 });
  if (lockResult === null) {
    log.info('surveys.submit.locked', { token });
    return NextResponse.json({ error: 'already_submitted' }, { status: 409 });
  }

  const submittedAt = new Date().toISOString();
  // response 書き込みと pending 集合追加を 1 RTT で
  await redis
    .pipeline()
    .set(k.response(token), { ...parsed.data, submittedAt }, { ex: 604800 })
    .sadd(k.pending, token)
    .exec();

  log.info('surveys.submit.ok', { token });
  return NextResponse.json({ ok: true });
}
