import { describe, it, expect } from 'vitest';
import { generateToken } from './token';

describe('generateToken', () => {
  it('returns 12-character url-safe string', () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it('returns different tokens on each call', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(tokens.size).toBe(100);
  });
});
