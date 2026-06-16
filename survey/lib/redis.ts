import { Redis } from '@upstash/redis';

export const redis = Redis.fromEnv();

// キー命名規約
export const k = {
  survey: (token: string) => `q:${token}`,
  lock: (token: string) => `q:${token}:lock`,
  response: (token: string) => `q:${token}:resp`,
  pending: 'pending:hr',
};
