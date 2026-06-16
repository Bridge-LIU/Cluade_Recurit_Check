import { randomBytes } from 'crypto';

export function generateToken(): string {
  // 9 bytes → 12 chars base64url
  return randomBytes(9).toString('base64url');
}
