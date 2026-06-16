import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { redis, k } from '@/lib/redis';
import { generateToken } from '@/lib/token';
import { DispatchPayloadSchema } from '@/lib/schema';
import type { SurveyDocument } from '@shared/types';

export async function POST(req: NextRequest) {
  const auth = requireApiKey(req);
  if (!auth.ok) return NextResponse.json({ error: 'unauthorized' }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const parsed = DispatchPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', details: parsed.error.format() }, { status: 400 });
  }

  const p = parsed.data;
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + p.ttlSeconds * 1000);

  const questions = p.groups.flatMap(g =>
    g.items.map(it => ({
      groupTitle: g.title,
      text: it.text,
      aim: it.aim,
      required: true as const,
    }))
  );

  const doc: SurveyDocument = {
    candidateName: p.candidateName,
    position: p.position,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    pageTitle: p.surveyPageTitle,
    pageDescription: p.surveyPageDescription,
    q1Email: { label: 'メールアドレス', required: true },
    q2Name: { label: 'お名前のご確認', required: true, defaultValue: p.candidateName },
    questions,
    supplementary: { label: 'ご質問・補足', required: false },
  };

  await redis.set(k.survey(token), doc, { ex: p.ttlSeconds });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  return NextResponse.json({
    token,
    surveyUrl: `${baseUrl}/q/${token}`,
    expiresAt: expiresAt.toISOString(),
  });
}
