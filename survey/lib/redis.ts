import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

// キー命名規約
export const k = {
  survey: (token: string) => `q:${token}`,
  lock: (token: string) => `q:${token}:lock`,
  response: (token: string) => `q:${token}:resp`,
  pending: 'pending:hr',
};
