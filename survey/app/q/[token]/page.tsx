import { redirect } from 'next/navigation';
import { redis, k } from '@/lib/redis';
import SurveyForm from '@/components/SurveyForm';
import type { SurveyDocument } from '@shared/types';

export const dynamic = 'force-dynamic';

export default async function SurveyPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const doc = await redis.get<SurveyDocument>(k.survey(token));
  if (!doc) redirect(`/q/${token}/expired`);

  const lock = await redis.exists(k.lock(token));
  if (lock) redirect(`/q/${token}/done`);

  return <SurveyForm token={token} doc={doc!} />;
}
