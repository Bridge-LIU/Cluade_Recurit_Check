# 面接前 WEB アンケート機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridge に「AI 質問生成→候補者にアンケート配信→回答自動取込」のフローを実装。Vercel + Upstash Redis で公開側を、本地 Bridge を拡張する形で本地側を構築する。

**Architecture:** モノレポ構成。`survey/` サブディレクトリに Next.js（App Router）の公開アンケートサービスを置き、Vercel にデプロイ。`shared/types.ts` で両端の契約を共有。本地 Bridge（Express + vanilla JS）は質問編集 UI、配信ボタン、回答取込（手動 + 5 分自動ポーリング）を担当。候補者ごとに独立した 12 文字 token URL、Redis TTL で 7 日自動失効、SETNX で単回提出。

**Tech Stack:**
- Public side: Next.js 14 App Router, TypeScript, Tailwind CSS, `@upstash/redis`, `zod`
- Shared: TypeScript types in `shared/types.ts`
- Local Bridge: Express (既存), vanilla JS frontend, vitest for tests, native `fetch`
- Storage: Upstash Redis (Vercel Marketplace, free tier)
- Auth: Bridge ⇔ Vercel は Bearer API Key, 候補者は無認証 (URL token のみ)

**Spec:** `docs/superpowers/specs/2026-06-16-pre-interview-questionnaire-design.md`

---

## Phase A — 公開側骨格（Vercel）

### Task 1: モノレポ準備と共有契約の定義

**Files:**
- Create: `shared/types.ts`
- Modify: `.gitignore`

- [ ] **Step 1: `shared/types.ts` を作成**

```typescript
// shared/types.ts
// Bridge 本地と survey/ 公開側が共有する契約。

export type DispatchPayload = {
  candidateId: string;
  candidateName: string;
  position: string;
  groups: { title: string; items: { text: string; aim: string }[] }[];
  companyName: string;
  hrName: string;
  hrEmail: string;
  surveyPageTitle: string;
  surveyPageDescription: string;
  ttlSeconds: number; // default 604800
};

export type DispatchResult = {
  token: string;
  surveyUrl: string;
  expiresAt: string; // ISO 8601
};

// Vercel 側 Redis に格納される問巻ドキュメント
export type SurveyDocument = {
  candidateName: string;
  position: string;
  createdAt: string;
  expiresAt: string;
  pageTitle: string;
  pageDescription: string;
  q1Email: { label: string; required: true };
  q2Name: { label: string; required: true; defaultValue: string };
  questions: { groupTitle: string; text: string; aim: string; required: true }[];
  supplementary: { label: string; required: false };
};

// 候補者がフォーム送信する内容
export type SubmitPayload = {
  email: string;
  nameConfirmed: string;
  answers: { questionText: string; answerText: string }[];
  supplementary: string;
};

// Bridge が取込む結果
export type FetchResult =
  | { status: 'pending' }
  | { status: 'submitted'; response: SubmitPayload & { submittedAt: string } };
```

- [ ] **Step 2: `.gitignore` を更新**

`.gitignore` に追加（既存ファイルがなければ新規作成）：

```
# Bridge 秘密情報
.bridge/

# Vercel survey side
survey/node_modules/
survey/.next/
survey/.vercel/
survey/.env*.local
```

- [ ] **Step 3: コミット**

```bash
git add shared/types.ts .gitignore
git commit -m "feat(shared): add survey contract types and gitignore"
```

---

### Task 2: survey/ サブディレクトリの初期化

**Files:**
- Create: `survey/package.json`
- Create: `survey/tsconfig.json`
- Create: `survey/next.config.js`
- Create: `survey/vitest.config.ts`
- Create: `survey/tailwind.config.ts`
- Create: `survey/postcss.config.js`
- Create: `survey/app/layout.tsx`
- Create: `survey/app/globals.css`

- [ ] **Step 1: `survey/package.json` を作成**

```json
{
  "name": "bridge-survey",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@upstash/redis": "^1.31.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.4.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "vitest": "^1.6.0",
    "@vitest/coverage-v8": "^1.6.0"
  }
}
```

- [ ] **Step 2: `survey/tsconfig.json` を作成**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"],
      "@shared/*": ["../shared/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", "../shared/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: `survey/next.config.js`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
  },
};
module.exports = nextConfig;
```

- [ ] **Step 3.5: `survey/vitest.config.ts`** — tsconfig の paths と整合させるため

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: `survey/tailwind.config.ts`**

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        coral: { DEFAULT: '#ff7a59', deep: '#e8553a' },
        ink: '#1a1f2e',
        cream: '#faf6f0',
      },
      fontFamily: {
        sans: ['"Noto Sans JP"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 5: `survey/postcss.config.js`**

```javascript
module.exports = {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 6: `survey/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body { background: #faf6f0; color: #1a1f2e; }
```

- [ ] **Step 7: `survey/app/layout.tsx`**

```typescript
import './globals.css';
import { ReactNode } from 'react';

export const metadata = {
  title: '面接前事前アンケート',
  description: 'Bridge survey',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="font-sans min-h-screen">{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: 動作確認**

```bash
cd survey && npm install
npm run dev
```

Expected: http://localhost:3000 にアクセスして 404 ページが表示される（まだルートがないため）

- [ ] **Step 9: コミット**

```bash
git add survey/package.json survey/tsconfig.json survey/next.config.js survey/vitest.config.ts survey/tailwind.config.ts survey/postcss.config.js survey/app/layout.tsx survey/app/globals.css
git commit -m "feat(survey): scaffold Next.js app with Tailwind and vitest"
```

---

### Task 3: Redis クライアントと認証ライブラリ

**Files:**
- Create: `survey/lib/redis.ts`
- Create: `survey/lib/auth.ts`
- Create: `survey/lib/schema.ts`
- Create: `survey/lib/token.ts`
- Create: `survey/lib/token.test.ts`

- [ ] **Step 1: テスト先行 — `survey/lib/token.test.ts`**

```typescript
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
```

- [ ] **Step 2: テストを走らせて失敗確認**

```bash
cd survey && npx vitest run lib/token.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: `survey/lib/token.ts` を実装**

```typescript
import { randomBytes } from 'crypto';

export function generateToken(): string {
  // 9 bytes → 12 chars base64url
  return randomBytes(9).toString('base64url');
}
```

- [ ] **Step 4: テスト再走、PASS 確認**

```bash
cd survey && npx vitest run lib/token.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: `survey/lib/redis.ts` を実装**

```typescript
import { Redis } from '@upstash/redis';

export const redis = Redis.fromEnv();

// キー命名規約
export const k = {
  survey: (token: string) => `q:${token}`,
  lock: (token: string) => `q:${token}:lock`,
  response: (token: string) => `q:${token}:resp`,
  pending: 'pending:hr',
};
```

- [ ] **Step 6: `survey/lib/auth.ts` を実装**

```typescript
import { NextRequest } from 'next/server';

export function requireApiKey(req: NextRequest): { ok: true } | { ok: false; status: 401 | 500 } {
  const expected = process.env.SURVEY_API_KEY;
  if (!expected) return { ok: false, status: 500 };
  const auth = req.headers.get('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m || m[1] !== expected) return { ok: false, status: 401 };
  return { ok: true };
}
```

- [ ] **Step 7: `survey/lib/schema.ts` を実装**

```typescript
import { z } from 'zod';

export const DispatchPayloadSchema = z.object({
  candidateId: z.string().min(1),
  candidateName: z.string().min(1),
  position: z.string(),
  groups: z.array(z.object({
    title: z.string(),
    items: z.array(z.object({
      text: z.string().min(1),
      aim: z.string(),
    })),
  })),
  companyName: z.string(),
  hrName: z.string(),
  hrEmail: z.string(),
  surveyPageTitle: z.string(),
  surveyPageDescription: z.string(),
  ttlSeconds: z.number().int().positive().default(604800),
});

export const SubmitPayloadSchema = z.object({
  email: z.string().email(),
  nameConfirmed: z.string().min(1),
  answers: z.array(z.object({
    questionText: z.string(),
    answerText: z.string(),
  })),
  supplementary: z.string(),
});
```

- [ ] **Step 8: コミット**

```bash
git add survey/lib/
git commit -m "feat(survey): add redis client, auth, schema and token generator"
```

---

### Task 4: POST /api/surveys — 問巻発行 API

**Files:**
- Create: `survey/app/api/surveys/route.ts`
- Create: `survey/app/api/surveys/route.test.ts`

- [ ] **Step 1: テストファースト**

```typescript
// survey/app/api/surveys/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/redis', () => ({
  redis: { set: vi.fn().mockResolvedValue('OK') },
  k: { survey: (t: string) => `q:${t}` },
}));

process.env.SURVEY_API_KEY = 'test-key';

function makeReq(body: unknown, auth = 'Bearer test-key') {
  return new NextRequest('http://localhost/api/surveys', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify(body),
  });
}

const validBody = {
  candidateId: 'a1',
  candidateName: '山田',
  position: 'NW Engineer',
  groups: [{ title: 'g1', items: [{ text: 'q1', aim: 'aim1' }] }],
  companyName: 'X',
  hrName: 'Y',
  hrEmail: 'z@x.com',
  surveyPageTitle: 'T',
  surveyPageDescription: 'D',
  ttlSeconds: 604800,
};

describe('POST /api/surveys', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects without API key', async () => {
    const res = await POST(makeReq(validBody, 'Bearer wrong'));
    expect(res.status).toBe(401);
  });

  it('returns token and url on success', async () => {
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.token).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(json.surveyUrl).toContain(json.token);
    expect(json.expiresAt).toBeTruthy();
  });

  it('rejects invalid body', async () => {
    const res = await POST(makeReq({ candidateId: '' }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: テスト失敗確認**

```bash
cd survey && npx vitest run app/api/surveys/route.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: `survey/app/api/surveys/route.ts` を実装**

```typescript
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
```

- [ ] **Step 4: テスト PASS 確認**

```bash
cd survey && npx vitest run app/api/surveys/route.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: コミット**

```bash
git add survey/app/api/surveys/
git commit -m "feat(survey): POST /api/surveys to issue per-candidate surveys"
```

---

### Task 5: 候補者ページ /q/[token]（SSR）

**Files:**
- Create: `survey/app/q/[token]/page.tsx`
- Create: `survey/components/SurveyForm.tsx`
- Create: `survey/app/q/[token]/done/page.tsx`
- Create: `survey/app/q/[token]/expired/page.tsx`

- [ ] **Step 1: `survey/app/q/[token]/expired/page.tsx`**

```typescript
export default function ExpiredPage() {
  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">受付期間外</h1>
      <p>このアンケートは公開期限を過ぎております。</p>
      <p>お手数ですが採用担当までご連絡ください。</p>
    </main>
  );
}
```

- [ ] **Step 2: `survey/app/q/[token]/done/page.tsx`**

```typescript
export default function DonePage() {
  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">ご回答ありがとうございました</h1>
      <p>面接のご連絡は別途お送りいたします。</p>
    </main>
  );
}
```

- [ ] **Step 3: `survey/components/SurveyForm.tsx`**

```typescript
'use client';
import { useState, useEffect } from 'react';
import type { SurveyDocument } from '@shared/types';

type Props = { token: string; doc: SurveyDocument };

const STORAGE_KEY = (token: string) => `bridge-survey-draft:${token}`;

export default function SurveyForm({ token, doc }: Props) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState(doc.q2Name.defaultValue);
  const [answers, setAnswers] = useState<string[]>(() => doc.questions.map(() => ''));
  const [supplementary, setSupplementary] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY(token));
    if (saved) {
      try {
        const d = JSON.parse(saved);
        if (d.questionCount === doc.questions.length) {
          setEmail(d.email ?? '');
          setName(d.name ?? doc.q2Name.defaultValue);
          setAnswers(d.answers ?? doc.questions.map(() => ''));
          setSupplementary(d.supplementary ?? '');
        }
      } catch {}
    }
  }, [token, doc.questions.length, doc.q2Name.defaultValue]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY(token), JSON.stringify({
      email, name, answers, supplementary, questionCount: doc.questions.length,
    }));
  }, [token, email, name, answers, supplementary, doc.questions.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const payload = {
      email,
      nameConfirmed: name,
      answers: doc.questions.map((q, i) => ({ questionText: q.text, answerText: answers[i] })),
      supplementary,
    };
    const res = await fetch(`/api/surveys/${token}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      localStorage.removeItem(STORAGE_KEY(token));
      window.location.href = `/q/${token}/done`;
    } else if (res.status === 409) {
      setError('このアンケートは既に回答済です。');
    } else {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? '送信に失敗しました。');
      setSubmitting(false);
    }
  }

  let groupTitle: string | null = null;

  return (
    <form onSubmit={submit} className="space-y-6 max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold">{doc.pageTitle}</h1>
      <p className="whitespace-pre-wrap text-sm">{doc.pageDescription}</p>

      <section>
        <label className="block mb-2">
          <span className="font-medium">Q1. {doc.q1Email.label} <span className="text-coral-deep">*</span></span>
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="block w-full mt-1 border rounded px-3 py-2"
          />
        </label>
        <label className="block mb-2">
          <span className="font-medium">Q2. {doc.q2Name.label} <span className="text-coral-deep">*</span></span>
          <input
            type="text"
            required
            value={name}
            onChange={e => setName(e.target.value)}
            className="block w-full mt-1 border rounded px-3 py-2"
          />
        </label>
      </section>

      {doc.questions.map((q, i) => {
        const showHeader = q.groupTitle !== groupTitle;
        groupTitle = q.groupTitle;
        return (
          <div key={i}>
            {showHeader && <h2 className="text-lg font-bold mt-6 mb-2 border-l-4 border-coral pl-3">{q.groupTitle}</h2>}
            <label className="block mb-2">
              <span className="font-medium">Q{i + 3}. {q.text} <span className="text-coral-deep">*</span></span>
              <textarea
                required
                value={answers[i]}
                onChange={e => setAnswers(a => a.map((v, j) => j === i ? e.target.value : v))}
                rows={4}
                className="block w-full mt-1 border rounded px-3 py-2"
              />
            </label>
          </div>
        );
      })}

      <label className="block">
        <span className="font-medium">{doc.supplementary.label}</span>
        <textarea
          value={supplementary}
          onChange={e => setSupplementary(e.target.value)}
          rows={3}
          className="block w-full mt-1 border rounded px-3 py-2"
        />
      </label>

      {error && <div className="text-coral-deep">{error}</div>}

      <button
        type="submit"
        disabled={submitting}
        className="bg-coral text-white px-6 py-2 rounded disabled:opacity-50"
      >
        {submitting ? '送信中…' : '送信する'}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: `survey/app/q/[token]/page.tsx`**

```typescript
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
```

- [ ] **Step 5: ローカル動作確認**

公開 API 経由で 1 件作成し、開いてフォームが表示されることを確認：

```bash
# survey/ 配下で:
npm run dev
# 別ターミナルで:
curl -X POST http://localhost:3000/api/surveys \
  -H "Authorization: Bearer test-key" \
  -H "Content-Type: application/json" \
  -d '{"candidateId":"a1","candidateName":"山田","position":"NW","groups":[{"title":"g","items":[{"text":"何故弊社？","aim":""}]}],"companyName":"X","hrName":"Y","hrEmail":"z@x.com","surveyPageTitle":"事前アンケート","surveyPageDescription":"…"}'
# レスポンスの surveyUrl をブラウザで開く
```

注：ローカルで Upstash を使う場合、`.env.local` に Upstash の URL/Token、`SURVEY_API_KEY=test-key`、`NEXT_PUBLIC_BASE_URL=http://localhost:3000` を設定する必要がある。

- [ ] **Step 6: コミット**

```bash
git add survey/app/q survey/components
git commit -m "feat(survey): candidate survey page with SSR + localStorage draft"
```

---

### Task 6: POST /api/surveys/[token]/submit — 回答受付

**Files:**
- Create: `survey/app/api/surveys/[token]/submit/route.ts`
- Create: `survey/app/api/surveys/[token]/submit/route.test.ts`

- [ ] **Step 1: テストファースト**

```typescript
// survey/app/api/surveys/[token]/submit/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

const redisMock = {
  exists: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  sadd: vi.fn(),
};

vi.mock('@/lib/redis', () => ({
  redis: redisMock,
  k: {
    survey: (t: string) => `q:${t}`,
    lock: (t: string) => `q:${t}:lock`,
    response: (t: string) => `q:${t}:resp`,
    pending: 'pending:hr',
  },
}));

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/surveys/x/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  email: 'a@b.com',
  nameConfirmed: '山田',
  answers: [{ questionText: 'Q', answerText: 'A' }],
  supplementary: '',
};

describe('POST /api/surveys/[token]/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.get.mockResolvedValue({ expiresAt: new Date(Date.now() + 1000_000).toISOString() });
  });

  it('returns 410 if survey expired/missing', async () => {
    redisMock.get.mockResolvedValueOnce(null);
    const res = await POST(makeReq(validBody), { params: { token: 'x' } });
    expect(res.status).toBe(410);
  });

  it('returns 409 if lock already set', async () => {
    redisMock.exists.mockResolvedValueOnce(1);
    const res = await POST(makeReq(validBody), { params: { token: 'x' } });
    expect(res.status).toBe(409);
  });

  it('returns 400 on invalid email', async () => {
    redisMock.exists.mockResolvedValueOnce(0);
    const res = await POST(makeReq({ ...validBody, email: 'not-an-email' }), { params: { token: 'x' } });
    expect(res.status).toBe(400);
  });

  it('stores response and sets lock on success', async () => {
    redisMock.exists.mockResolvedValueOnce(0);
    const res = await POST(makeReq(validBody), { params: { token: 'x' } });
    expect(res.status).toBe(200);
    expect(redisMock.set).toHaveBeenCalledWith('q:x:lock', '1', expect.objectContaining({ nx: true }));
    expect(redisMock.set).toHaveBeenCalledWith('q:x:resp', expect.any(Object), expect.any(Object));
    expect(redisMock.sadd).toHaveBeenCalledWith('pending:hr', 'x');
  });
});
```

- [ ] **Step 2: テスト失敗確認**

```bash
cd survey && npx vitest run app/api/surveys/'[token]'/submit/route.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: 実装**

```typescript
// survey/app/api/surveys/[token]/submit/route.ts
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
```

- [ ] **Step 4: テスト PASS 確認**

```bash
cd survey && npx vitest run app/api/surveys/'[token]'/submit/route.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: コミット**

```bash
git add survey/app/api/surveys/\[token\]/submit/
git commit -m "feat(survey): submit endpoint with SETNX single-submission lock"
```

---

### Task 7: GET /result + POST /close

**Files:**
- Create: `survey/app/api/surveys/[token]/result/route.ts`
- Create: `survey/app/api/surveys/[token]/close/route.ts`

- [ ] **Step 1: `result/route.ts` を実装**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { redis, k } from '@/lib/redis';

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const auth = requireApiKey(req);
  if (!auth.ok) return NextResponse.json({ error: 'unauthorized' }, { status: auth.status });

  const { token } = params;
  const resp = await redis.get(k.response(token));
  if (!resp) return NextResponse.json({ status: 'pending' });

  const ack = req.nextUrl.searchParams.get('ack') === '1';
  if (ack) await redis.srem(k.pending, token);

  return NextResponse.json({ status: 'submitted', response: resp });
}
```

- [ ] **Step 2: `close/route.ts` を実装**

```typescript
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
```

- [ ] **Step 3: 動作確認 — `/result` を叩いて pending が返る**

```bash
curl -H "Authorization: Bearer test-key" \
  http://localhost:3000/api/surveys/XXX/result
# {"status":"pending"}
```

- [ ] **Step 4: コミット**

```bash
git add survey/app/api/surveys/\[token\]/result survey/app/api/surveys/\[token\]/close
git commit -m "feat(survey): result polling and manual close endpoints"
```

---

### Task 8: Vercel デプロイ

**Files:**
- Create: `survey/.env.local.example`
- Create: `survey/README.md`

- [ ] **Step 1: `.env.local.example`**

```
SURVEY_API_KEY=set-a-32-char-random-hex
KV_REST_API_URL=https://....upstash.io
KV_REST_API_TOKEN=...
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

- [ ] **Step 2: `survey/README.md`**

```markdown
# Bridge Survey (公開アンケート側)

Vercel デプロイ用。

## ローカル開発
1. `cp .env.local.example .env.local`、各値を埋める
2. `npm install`
3. `npm run dev`

## Vercel デプロイ
1. ルートリポを Vercel にインポート
2. プロジェクト設定 → Root Directory = `survey`
3. Marketplace から Upstash Redis を追加（`KV_*` が自動注入される）
4. `SURVEY_API_KEY` を環境変数に追加（`openssl rand -hex 16` で生成）
5. `NEXT_PUBLIC_BASE_URL` を本番 URL に設定（例 `https://bridge-survey-xxx.vercel.app`）
6. デプロイ
```

- [ ] **Step 3: GitHub にプッシュ、Vercel にインポート**

ブラウザ作業：
1. https://vercel.com/new で本リポをインポート
2. Root Directory = `survey`
3. Framework Preset = Next.js（自動検出）
4. Storage タブ → Upstash Redis 追加 → デフォルト無料層
5. Environment Variables：
   - `SURVEY_API_KEY` = `openssl rand -hex 16` の結果
   - `NEXT_PUBLIC_BASE_URL` = デプロイ後割当 URL（一旦空、後で更新）
6. Deploy
7. 割当 URL（例 `bridge-survey-xxx.vercel.app`）を確認
8. `NEXT_PUBLIC_BASE_URL` を更新して再デプロイ
9. `curl https://<url>/api/surveys -H "Authorization: Bearer <key>" -d '{...}'` で動作確認

- [ ] **Step 4: コミット**

```bash
git add survey/.env.local.example survey/README.md
git commit -m "docs(survey): add deployment guide and env example"
```

---

## Phase B — 本地統合（Bridge）

### Task 9: データモデル拡張と vitest セットアップ

**Files:**
- Modify: `package.json`
- Create: `server/lib/questions-store.js`
- Create: `server/lib/questions-store.test.js`

- [ ] **Step 1: `package.json` に vitest を追加**

既存の `package.json` を編集して `devDependencies` と `scripts.test` を加える：

```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^1.6.0"
  }
}
```

`npm install` を実行。

- [ ] **Step 2: テストファースト — `questions-store.test.js`**

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { readQuestions, writeQuestions, defaultDispatch } from './questions-store.js';

let tmpDir;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-test-'));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('readQuestions', () => {
  it('fills missing status/dispatch fields with defaults', async () => {
    const legacy = { candidateId: 'a1', candidateName: 'X', groups: [] };
    await fs.writeFile(path.join(tmpDir, 'a1.json'), JSON.stringify(legacy));
    const r = await readQuestions(tmpDir, 'a1');
    expect(r.status).toBe('draft');
    expect(r.dispatch).toEqual(defaultDispatch());
    expect(r.editedAt).toBeTruthy();
  });

  it('preserves existing status and dispatch', async () => {
    const newer = {
      candidateId: 'a1', candidateName: 'X', groups: [],
      status: 'sent',
      editedAt: '2026-06-16T10:00:00Z',
      dispatch: { token: 'abc', surveyUrl: 'u', createdAt: 'c', sentAt: 's', expiresAt: 'e' },
    };
    await fs.writeFile(path.join(tmpDir, 'a1.json'), JSON.stringify(newer));
    const r = await readQuestions(tmpDir, 'a1');
    expect(r.status).toBe('sent');
    expect(r.dispatch.token).toBe('abc');
  });
});

describe('writeQuestions', () => {
  it('writes JSON file', async () => {
    await writeQuestions(tmpDir, 'a1', {
      candidateId: 'a1', candidateName: 'X', groups: [],
      status: 'draft', editedAt: '2026-06-16T00:00:00Z', dispatch: defaultDispatch(),
    });
    const raw = await fs.readFile(path.join(tmpDir, 'a1.json'), 'utf8');
    expect(JSON.parse(raw).candidateId).toBe('a1');
  });
});
```

- [ ] **Step 3: テスト失敗確認**

```bash
npx vitest run server/lib/questions-store.test.js
```

Expected: FAIL — module not found

- [ ] **Step 4: 実装 — `server/lib/questions-store.js`**

```javascript
// server/lib/questions-store.js
// questions/{id}.json の読書ラッパ。後方互換性を維持。

import fs from 'fs/promises';
import path from 'path';

export function defaultDispatch() {
  return {
    token: null,
    surveyUrl: null,
    createdAt: null,
    sentAt: null,
    expiresAt: null,
    lastPolledAt: null,
    closedAt: null,
    closeReason: null,
  };
}

export async function readQuestions(dir, id) {
  const p = path.join(dir, `${id}.json`);
  const raw = await fs.readFile(p, 'utf8');
  const data = JSON.parse(raw);
  return {
    ...data,
    status: data.status ?? 'draft',
    editedAt: data.editedAt ?? data.generatedAt ?? new Date().toISOString(),
    dispatch: { ...defaultDispatch(), ...(data.dispatch ?? {}) },
  };
}

export async function writeQuestions(dir, id, data) {
  const p = path.join(dir, `${id}.json`);
  await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8');
}

export async function readAnswers(dir, id) {
  const p = path.join(dir, `${id}.answers.json`);
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function writeAnswers(dir, id, data) {
  const p = path.join(dir, `${id}.answers.json`);
  await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8');
}
```

- [ ] **Step 5: テスト PASS 確認**

```bash
npx vitest run server/lib/questions-store.test.js
```

Expected: PASS (3 tests)

- [ ] **Step 6: コミット**

```bash
git add package.json server/lib/questions-store.js server/lib/questions-store.test.js
git commit -m "feat(bridge): questions store with status/dispatch defaults"
```

---

### Task 10: 設定ファイルの読書

**Files:**
- Create: `server/lib/settings.js`
- Create: `server/lib/settings.test.js`
- Create: `presets/settings.json`（必要なら）

- [ ] **Step 1: テストファースト**

```javascript
// server/lib/settings.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { loadSettings, saveSettings, loadSurveyConfig, defaultSettings } from './settings.js';

let tmpDir, presets, bridgeDir;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-set-'));
  presets = path.join(tmpDir, 'presets');
  bridgeDir = path.join(tmpDir, '.bridge');
  await fs.mkdir(presets, { recursive: true });
  await fs.mkdir(bridgeDir, { recursive: true });
});
afterEach(() => fs.rm(tmpDir, { recursive: true, force: true }));

describe('loadSettings', () => {
  it('returns defaults when file missing', async () => {
    const s = await loadSettings(presets);
    expect(s.companyName).toBe(defaultSettings().companyName);
  });

  it('reads existing settings.json', async () => {
    await fs.writeFile(path.join(presets, 'settings.json'),
      JSON.stringify({ companyName: 'BridgeVC' }));
    const s = await loadSettings(presets);
    expect(s.companyName).toBe('BridgeVC');
  });
});

describe('loadSurveyConfig', () => {
  it('returns null when missing', async () => {
    const c = await loadSurveyConfig(bridgeDir);
    expect(c).toBeNull();
  });

  it('reads endpoint and apiKey', async () => {
    await fs.writeFile(path.join(bridgeDir, 'survey-config.json'),
      JSON.stringify({ endpoint: 'https://x.vercel.app', apiKey: 'k' }));
    const c = await loadSurveyConfig(bridgeDir);
    expect(c.endpoint).toBe('https://x.vercel.app');
    expect(c.apiKey).toBe('k');
  });
});
```

- [ ] **Step 2: テスト失敗確認**

```bash
npx vitest run server/lib/settings.test.js
```

Expected: FAIL

- [ ] **Step 3: 実装**

```javascript
// server/lib/settings.js
import fs from 'fs/promises';
import path from 'path';

export function defaultSettings() {
  return {
    companyName: '弊社',
    hrName: '採用担当',
    hrEmail: '',
    emailTemplate: {
      subject: '【{会社名}】面接前アンケートご記入のお願い（{候補者名} 様）',
      body: `{候補者名} 様

この度は弊社 {ポジション} ポジションにご応募いただき、誠にありがとうございます。

面接前に、{締切日} までに下記アンケートへのご記入をお願いいたします。
（所要時間：10〜15 分程度）

▼アンケート URL
{Survey URL}

なお、当アンケートは 1 回のみご回答いただけます。
回答後は自動的に受付終了となります。
ご不明な点がございましたら、本メールにご返信ください。

何卒よろしくお願いいたします。
{HR 名}`,
    },
    surveyPageTemplate: {
      title: '面接前事前アンケート',
      description: `{ポジション} のご応募ありがとうございます。
面接をより有意義なお時間とするため、事前にいくつかご質問させていただきます。
所要時間は 10〜15 分程度です。{締切日} までにご回答ください。

【個人情報の取り扱いについて】
ご回答内容は採用選考の目的のみに使用し、不採用の場合は 6 ヶ月以内に破棄いたします。`,
    },
    pollIntervalMs: 300000,
  };
}

export async function loadSettings(presetsDir) {
  const p = path.join(presetsDir, 'settings.json');
  try {
    const raw = await fs.readFile(p, 'utf8');
    return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch (e) {
    if (e.code === 'ENOENT') return defaultSettings();
    throw e;
  }
}

export async function saveSettings(presetsDir, settings) {
  const p = path.join(presetsDir, 'settings.json');
  await fs.writeFile(p, JSON.stringify(settings, null, 2), 'utf8');
}

export async function loadSurveyConfig(bridgeDir) {
  const p = path.join(bridgeDir, 'survey-config.json');
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function saveSurveyConfig(bridgeDir, config) {
  await fs.mkdir(bridgeDir, { recursive: true });
  const p = path.join(bridgeDir, 'survey-config.json');
  await fs.writeFile(p, JSON.stringify(config, null, 2), 'utf8');
}
```

- [ ] **Step 4: テスト PASS 確認**

```bash
npx vitest run server/lib/settings.test.js
```

Expected: PASS (4 tests)

- [ ] **Step 5: コミット**

```bash
git add server/lib/settings.js server/lib/settings.test.js
git commit -m "feat(bridge): settings loader with defaults and survey-config separation"
```

---

### Task 11: テンプレ展開ロジック

**Files:**
- Create: `server/lib/template.js`
- Create: `server/lib/template.test.js`

- [ ] **Step 1: テストファースト**

```javascript
// server/lib/template.test.js
import { describe, it, expect } from 'vitest';
import { expandTemplate } from './template.js';

describe('expandTemplate', () => {
  it('replaces placeholders', () => {
    const tpl = 'こんにちは {候補者名} 様、{ポジション} 募集です。';
    const out = expandTemplate(tpl, { 候補者名: '山田', ポジション: 'NW' });
    expect(out).toBe('こんにちは 山田 様、NW 募集です。');
  });

  it('leaves unknown placeholders as-is', () => {
    expect(expandTemplate('{不明} あり', { 候補者名: 'X' })).toBe('{不明} あり');
  });

  it('handles all dispatch placeholders', () => {
    const tpl = '{候補者名}|{ポジション}|{会社名}|{HR 名}|{Survey URL}|{締切日}';
    const out = expandTemplate(tpl, {
      候補者名: 'N', ポジション: 'P', 会社名: 'C', 'HR 名': 'H',
      'Survey URL': 'U', 締切日: '2026-06-23',
    });
    expect(out).toBe('N|P|C|H|U|2026-06-23');
  });
});
```

- [ ] **Step 2: テスト失敗確認**

```bash
npx vitest run server/lib/template.test.js
```

Expected: FAIL

- [ ] **Step 3: 実装**

```javascript
// server/lib/template.js
export function expandTemplate(template, vars) {
  return template.replace(/\{([^}]+)\}/g, (m, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : m;
  });
}

export function buildTemplateVars({ candidateName, position, settings, surveyUrl, expiresAt }) {
  const deadline = expiresAt
    ? new Date(expiresAt).toISOString().slice(0, 10)
    : '';
  return {
    候補者名: candidateName || '候補者',
    ポジション: position || 'ご応募ポジション',
    会社名: settings.companyName || '弊社',
    'HR 名': settings.hrName || '採用担当',
    'Survey URL': surveyUrl || '',
    締切日: deadline,
  };
}
```

- [ ] **Step 4: テスト PASS 確認**

```bash
npx vitest run server/lib/template.test.js
```

Expected: PASS (3 tests)

- [ ] **Step 5: コミット**

```bash
git add server/lib/template.js server/lib/template.test.js
git commit -m "feat(bridge): template expansion helper"
```

---

### Task 12: Vercel API クライアント

**Files:**
- Create: `server/lib/survey-client.js`
- Create: `server/lib/survey-client.test.js`

- [ ] **Step 1: テストファースト（fetch をモック）**

```javascript
// server/lib/survey-client.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSurvey, fetchResult, closeSurvey } from './survey-client.js';

const config = { endpoint: 'https://x.vercel.app', apiKey: 'k' };

beforeEach(() => {
  global.fetch = vi.fn();
});

describe('createSurvey', () => {
  it('POSTs to /api/surveys with auth header', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ token: 't', surveyUrl: 'u', expiresAt: 'e' }),
    });
    const r = await createSurvey(config, { candidateId: 'a' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://x.vercel.app/api/surveys',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer k' }),
      })
    );
    expect(r.token).toBe('t');
  });

  it('throws on non-ok', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) });
    await expect(createSurvey(config, {})).rejects.toThrow(/401/);
  });
});

describe('fetchResult', () => {
  it('GETs /result?ack=1 and returns json', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'pending' }) });
    const r = await fetchResult(config, 'tok');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://x.vercel.app/api/surveys/tok/result?ack=1',
      expect.objectContaining({ headers: { Authorization: 'Bearer k' } })
    );
    expect(r.status).toBe('pending');
  });
});

describe('closeSurvey', () => {
  it('POSTs /close', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await closeSurvey(config, 'tok');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://x.vercel.app/api/surveys/tok/close',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
```

- [ ] **Step 2: テスト失敗確認**

```bash
npx vitest run server/lib/survey-client.test.js
```

Expected: FAIL

- [ ] **Step 3: 実装**

```javascript
// server/lib/survey-client.js
async function callJson(url, init, config) {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`survey-client ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export async function createSurvey(config, payload) {
  return callJson(`${config.endpoint}/api/surveys`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, config);
}

export async function fetchResult(config, token) {
  return callJson(`${config.endpoint}/api/surveys/${encodeURIComponent(token)}/result?ack=1`, {
    method: 'GET',
    headers: { 'Content-Type': undefined }, // GET には不要だが Bearer は付く
  }, config);
}

export async function closeSurvey(config, token) {
  return callJson(`${config.endpoint}/api/surveys/${encodeURIComponent(token)}/close`, {
    method: 'POST',
  }, config);
}
```

- [ ] **Step 4: テスト PASS 確認**

```bash
npx vitest run server/lib/survey-client.test.js
```

Expected: PASS (4 tests)

- [ ] **Step 5: コミット**

```bash
git add server/lib/survey-client.js server/lib/survey-client.test.js
git commit -m "feat(bridge): vercel api client wrapper"
```

---

### Task 13: server.js への新 API 追加（編集・配信・取込・終了）

**Files:**
- Modify: `server.js`

- [ ] **Step 1: server.js に import を追加**

`server.js` の冒頭の import 群に追加：

```javascript
import { readQuestions, writeQuestions, readAnswers, writeAnswers, defaultDispatch } from './server/lib/questions-store.js';
import { loadSettings, loadSurveyConfig } from './server/lib/settings.js';
import { expandTemplate, buildTemplateVars } from './server/lib/template.js';
import { createSurvey, fetchResult, closeSurvey } from './server/lib/survey-client.js';
```

- [ ] **Step 2: 既存の `app.get('/api/questions/:id', ...)` を questions-store 経由に置換**

旧コード（server.js:532-536 付近）：
```javascript
app.get('/api/questions/:id', async (req, res) => {
  const p = path.join(DIRS.questions, `${req.params.id}.json`);
  if (!fssync.existsSync(p)) return res.status(404).json({ error: 'not found' });
  res.json(JSON.parse(await fs.readFile(p, 'utf8')));
});
```

新コード：
```javascript
app.get('/api/questions/:id', async (req, res) => {
  try {
    const data = await readQuestions(DIRS.questions, req.params.id);
    const answers = await readAnswers(DIRS.questions, req.params.id);
    res.json({ ...data, answers });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
    res.status(500).json({ error: String(e.message || e) });
  }
});
```

- [ ] **Step 3: PUT /api/questions/:id — 編集保存**

`/api/questions/:id` の GET の直後に追加：

```javascript
app.put('/api/questions/:id', async (req, res) => {
  try {
    const existing = await readQuestions(DIRS.questions, req.params.id);
    if (existing.status !== 'draft') {
      return res.status(409).json({ error: 'not_editable', status: existing.status });
    }
    if (req.body.editedAt && req.body.editedAt !== existing.editedAt) {
      return res.status(409).json({ error: 'stale', currentEditedAt: existing.editedAt });
    }
    const updated = {
      ...existing,
      groups: req.body.groups ?? existing.groups,
      editedAt: new Date().toISOString(),
    };
    await writeQuestions(DIRS.questions, req.params.id, updated);
    res.json({ ok: true, editedAt: updated.editedAt });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
    res.status(500).json({ error: String(e.message || e) });
  }
});
```

- [ ] **Step 4: POST /api/questions/:id/dispatch — Vercel に発行**

```javascript
app.post('/api/questions/:id/dispatch', async (req, res) => {
  try {
    const config = await loadSurveyConfig(path.join(ROOT, '.bridge'));
    if (!config) return res.status(412).json({ error: 'no_survey_config' });
    const settings = await loadSettings(DIRS.presets);
    const data = await readQuestions(DIRS.questions, req.params.id);
    if (data.status !== 'draft') {
      return res.status(409).json({ error: 'not_draft', status: data.status });
    }

    const result = await createSurvey(config, {
      candidateId: data.candidateId,
      candidateName: data.candidateName,
      position: data.position,
      groups: data.groups,
      companyName: settings.companyName,
      hrName: settings.hrName,
      hrEmail: settings.hrEmail,
      surveyPageTitle: expandTemplate(
        settings.surveyPageTemplate.title,
        buildTemplateVars({ candidateName: data.candidateName, position: data.position, settings, surveyUrl: '', expiresAt: '' })
      ),
      surveyPageDescription: expandTemplate(
        settings.surveyPageTemplate.description,
        buildTemplateVars({ candidateName: data.candidateName, position: data.position, settings, surveyUrl: '', expiresAt: '' })
      ),
      ttlSeconds: 604800,
    });

    const updated = {
      ...data,
      status: 'sent',
      dispatch: {
        ...data.dispatch,
        token: result.token,
        surveyUrl: result.surveyUrl,
        createdAt: new Date().toISOString(),
        sentAt: new Date().toISOString(),
        expiresAt: result.expiresAt,
      },
    };
    await writeQuestions(DIRS.questions, req.params.id, updated);

    // メールテンプレを展開
    const vars = buildTemplateVars({
      candidateName: data.candidateName, position: data.position, settings,
      surveyUrl: result.surveyUrl, expiresAt: result.expiresAt,
    });
    res.json({
      ok: true,
      surveyUrl: result.surveyUrl,
      expiresAt: result.expiresAt,
      email: {
        subject: expandTemplate(settings.emailTemplate.subject, vars),
        body: expandTemplate(settings.emailTemplate.body, vars),
      },
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});
```

- [ ] **Step 5: POST /api/questions/:id/fetch — 回答取得**

```javascript
app.post('/api/questions/:id/fetch', async (req, res) => {
  try {
    const config = await loadSurveyConfig(path.join(ROOT, '.bridge'));
    if (!config) return res.status(412).json({ error: 'no_survey_config' });
    const data = await readQuestions(DIRS.questions, req.params.id);
    if (!data.dispatch.token) return res.status(409).json({ error: 'not_dispatched' });

    const result = await fetchResult(config, data.dispatch.token);
    const updated = {
      ...data,
      dispatch: { ...data.dispatch, lastPolledAt: new Date().toISOString() },
    };

    if (result.status === 'pending') {
      // 期限チェック
      if (data.dispatch.expiresAt && new Date() > new Date(data.dispatch.expiresAt)) {
        updated.status = 'expired';
        updated.dispatch.closedAt = new Date().toISOString();
        updated.dispatch.closeReason = 'expired';
      }
      await writeQuestions(DIRS.questions, req.params.id, updated);
      return res.json({ status: 'pending' });
    }

    // submitted
    const resp = result.response;
    await writeAnswers(DIRS.questions, req.params.id, {
      candidateId: data.candidateId,
      token: data.dispatch.token,
      fetchedAt: new Date().toISOString(),
      respondent: {
        email: resp.email,
        nameConfirmed: resp.nameConfirmed,
        submittedAt: resp.submittedAt,
      },
      answers: data.groups.flatMap(g =>
        g.items.map((it, i) => {
          const matched = resp.answers.find(a => a.questionText === it.text);
          return {
            groupTitle: g.title,
            questionText: it.text,
            aim: it.aim,
            answerText: matched?.answerText ?? '',
          };
        })
      ),
      supplementary: resp.supplementary,
    });

    updated.status = 'submitted';
    updated.dispatch.closedAt = new Date().toISOString();
    updated.dispatch.closeReason = 'submitted';
    await writeQuestions(DIRS.questions, req.params.id, updated);
    await closeSurvey(config, data.dispatch.token).catch(() => {}); // best effort

    res.json({ status: 'submitted' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});
```

- [ ] **Step 6: POST /api/questions/:id/close — 手動終了**

```javascript
app.post('/api/questions/:id/close', async (req, res) => {
  try {
    const config = await loadSurveyConfig(path.join(ROOT, '.bridge'));
    const data = await readQuestions(DIRS.questions, req.params.id);
    if (data.dispatch.token && config) {
      await closeSurvey(config, data.dispatch.token).catch(() => {});
    }
    const updated = {
      ...data,
      status: 'closed',
      dispatch: {
        ...data.dispatch,
        closedAt: new Date().toISOString(),
        closeReason: 'manual',
      },
    };
    await writeQuestions(DIRS.questions, req.params.id, updated);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});
```

- [ ] **Step 7: 起動して既存機能が壊れていないか確認**

```bash
npm start
# http://localhost:3939 を開いて、募集要件・新規評価が動くことを目視
```

- [ ] **Step 8: コミット**

```bash
git add server.js
git commit -m "feat(bridge): add survey dispatch/fetch/close endpoints"
```

---

### Task 14: 設定 API（settings.json 読書）

**Files:**
- Modify: `server.js`

- [ ] **Step 1: GET/POST /api/settings を追加**

`server.js` の `/api/presets` の近くに追加：

```javascript
app.get('/api/settings', async (_req, res) => {
  try {
    const settings = await loadSettings(DIRS.presets);
    const config = await loadSurveyConfig(path.join(ROOT, '.bridge'));
    res.json({
      ...settings,
      surveyEndpoint: config?.endpoint ?? '',
      surveyApiKeyMasked: config?.apiKey ? '••••••••' + config.apiKey.slice(-4) : '',
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { surveyEndpoint, surveyApiKey, ...rest } = req.body;
    // settings.json には survey 接続情報を保存しない
    const { saveSettings, saveSurveyConfig } = await import('./server/lib/settings.js');
    await saveSettings(DIRS.presets, rest);
    if (surveyEndpoint || surveyApiKey) {
      const cur = await loadSurveyConfig(path.join(ROOT, '.bridge')) ?? {};
      await saveSurveyConfig(path.join(ROOT, '.bridge'), {
        endpoint: surveyEndpoint ?? cur.endpoint,
        apiKey: surveyApiKey || cur.apiKey,
        pollIntervalMs: 300000,
      });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/settings/survey-test', async (_req, res) => {
  try {
    const config = await loadSurveyConfig(path.join(ROOT, '.bridge'));
    if (!config) return res.status(412).json({ error: 'no_config' });
    const r = await fetch(`${config.endpoint}/api/surveys/test-token/result`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    // 401 = key bad、404/200 どちらでも到達確認はできる
    res.json({ reachable: r.status !== 401 && r.status < 500, status: r.status });
  } catch (e) {
    res.json({ reachable: false, error: String(e.message || e) });
  }
});
```

- [ ] **Step 2: 動作確認**

```bash
npm start
curl http://localhost:3939/api/settings
# defaults が返ってくる
```

- [ ] **Step 3: コミット**

```bash
git add server.js
git commit -m "feat(bridge): settings GET/POST and survey connection test"
```

---

### Task 15: ポーリングジョブ

**Files:**
- Create: `server/lib/poller.js`
- Modify: `server.js`

- [ ] **Step 1: 実装**

```javascript
// server/lib/poller.js
import fs from 'fs/promises';
import path from 'path';
import { readQuestions, writeQuestions, writeAnswers } from './questions-store.js';
import { fetchResult, closeSurvey } from './survey-client.js';
import { loadSurveyConfig } from './settings.js';

export function startPoller({ questionsDir, bridgeDir, intervalMs = 300000 }) {
  let timer = null;
  async function tick() {
    try {
      const config = await loadSurveyConfig(bridgeDir);
      if (!config) return;

      const files = await fs.readdir(questionsDir);
      for (const f of files) {
        if (!f.endsWith('.json') || f.endsWith('.answers.json')) continue;
        const id = f.replace(/\.json$/, '');
        try {
          const data = await readQuestions(questionsDir, id);
          if (data.status !== 'sent') continue;

          // 期限チェック先
          if (data.dispatch.expiresAt && new Date() > new Date(data.dispatch.expiresAt)) {
            await writeQuestions(questionsDir, id, {
              ...data,
              status: 'expired',
              dispatch: { ...data.dispatch, closedAt: new Date().toISOString(), closeReason: 'expired' },
            });
            continue;
          }

          // ポーリング
          const result = await fetchResult(config, data.dispatch.token);
          if (result.status === 'submitted') {
            const resp = result.response;
            await writeAnswers(questionsDir, id, {
              candidateId: data.candidateId,
              token: data.dispatch.token,
              fetchedAt: new Date().toISOString(),
              respondent: {
                email: resp.email,
                nameConfirmed: resp.nameConfirmed,
                submittedAt: resp.submittedAt,
              },
              answers: data.groups.flatMap(g =>
                g.items.map(it => {
                  const matched = resp.answers.find(a => a.questionText === it.text);
                  return {
                    groupTitle: g.title,
                    questionText: it.text,
                    aim: it.aim,
                    answerText: matched?.answerText ?? '',
                  };
                })
              ),
              supplementary: resp.supplementary,
            });
            await writeQuestions(questionsDir, id, {
              ...data,
              status: 'submitted',
              dispatch: {
                ...data.dispatch,
                lastPolledAt: new Date().toISOString(),
                closedAt: new Date().toISOString(),
                closeReason: 'submitted',
              },
            });
            await closeSurvey(config, data.dispatch.token).catch(() => {});
          } else {
            await writeQuestions(questionsDir, id, {
              ...data,
              dispatch: { ...data.dispatch, lastPolledAt: new Date().toISOString() },
            });
          }
        } catch (e) {
          console.error(`[poller] ${id}:`, e.message);
        }
      }
    } catch (e) {
      console.error('[poller]', e.message);
    }
  }
  tick(); // 起動時 1 回
  timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
```

- [ ] **Step 2: server.js から起動**

`server.js` の `app.listen(...)` の直前に追加：

```javascript
import { startPoller } from './server/lib/poller.js';
startPoller({
  questionsDir: DIRS.questions,
  bridgeDir: path.join(ROOT, '.bridge'),
  intervalMs: 300000,
});
```

- [ ] **Step 3: 動作確認**

```bash
npm start
# ログに [poller] エラーが頻発しないこと、5 分待つ必要はない
```

- [ ] **Step 4: コミット**

```bash
git add server/lib/poller.js server.js
git commit -m "feat(bridge): 5-minute polling job for survey responses"
```

---

### Task 16: UI — 質問編集モード

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: `public/index.html` の「質問生成」ページに編集モード用の構造を追加**

既存の `<!-- ③ 質問生成 -->` ブロック内、`<div id="qResult"></div>` の前に追加：

```html
<div id="qModeBar" class="actions" style="margin-top:10px; display:none">
  <span id="qStatusBadge" class="badge"></span>
  <span style="flex:1"></span>
  <button class="btn-ghost" id="qEditBtn" style="display:none">編集</button>
  <button class="btn-ghost" id="qSaveBtn" style="display:none">変更を保存</button>
  <button class="btn-ghost" id="qCancelBtn" style="display:none">破棄</button>
  <button class="btn-primary" id="qDispatchBtn" style="display:none">アンケートを公開</button>
  <button class="btn-ghost" id="qFetchBtn" style="display:none">今すぐ取得</button>
  <button class="btn-ghost" id="qCloseBtn" style="display:none">手動終了</button>
</div>
<div id="qDispatchModal" class="modal" style="display:none"></div>
<div id="qAnswersPanel" style="display:none"></div>
```

- [ ] **Step 2: `public/styles.css` にバッジとモーダルのスタイル**

末尾に追加：

```css
.badge { padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; }
.badge.draft { background: #ddd; color: #555; }
.badge.sent { background: #ffc; color: #884; }
.badge.submitted { background: #cfc; color: #262; }
.badge.expired { background: #fcc; color: #822; }
.badge.closed { background: #ddd; color: #555; }

.modal {
  position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 1000;
  display: flex; align-items: center; justify-content: center;
}
.modal .modal-card {
  background: var(--cream, #faf6f0); padding: 24px; border-radius: 8px;
  max-width: 640px; width: 90%; max-height: 90vh; overflow: auto;
}

.q-edit-box { display: flex; gap: 8px; margin-bottom: 10px; }
.q-edit-box textarea { flex: 1; min-height: 60px; }
.q-edit-box .q-actions { display: flex; flex-direction: column; gap: 4px; }
```

- [ ] **Step 3: `public/app.js` の `loadQTab` と `renderQuestions` を編集可能化**

`renderQuestions(j)` 関数の直前に、編集モード状態を保持する変数を追加：

```javascript
// 編集状態：'view' | 'edit'
let qMode = 'view';
let qCurrentData = null; // 現在表示中の questions/{id}.json データ
```

`loadQTab` 内の `sel.onchange` ハンドラ末尾で、UI 更新呼出を追加：

```javascript
sel.onchange = async () => {
  const id = sel.value;
  $('#qGenerate').disabled = !id;
  $('#qResult').innerHTML = '';
  $('#qMsg').textContent = '';
  $('#qModeBar').style.display = 'none';
  $('#qAnswersPanel').style.display = 'none';
  if (!id) return;
  try {
    const j = await fetch(`/api/questions/${encodeURIComponent(id)}`).then(r => r.json());
    if (!j.error && j.groups) {
      qCurrentData = j;
      qMode = 'view';
      renderQuestions(j);
      updateQModeBar(j);
      if (j.answers) renderAnswersPanel(j.answers);
      $('#qMsg').innerHTML = `保存済の質問を表示中（編集：${escapeHtml((j.editedAt||'').replace('T',' ').slice(0,16))}）`;
      $('#qGenerate').textContent = '再生成する';
    } else {
      $('#qGenerate').textContent = '質問を生成';
    }
  } catch {}
};
```

`generateQuestions` 内、成功時の処理を更新：

```javascript
async function generateQuestions() {
  const id = $('#qCandidate').value;
  if (!id) return;
  const btn = $('#qGenerate');
  btn.disabled = true;
  $('#qMsg').innerHTML = '<span class="spinner"></span> 質問を生成中…（10〜20 秒）';
  $('#qResult').innerHTML = '';
  try {
    const j = await fetch('/api/generate-questions', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ candidateId: id }),
    }).then(r => r.json());
    if (j.error) throw new Error(j.error);
    // 再生成は status を draft に戻すべき → サーバ側で対応必要、現状は draft 前提
    qCurrentData = await fetch(`/api/questions/${encodeURIComponent(id)}`).then(r => r.json());
    qMode = 'view';
    renderQuestions(qCurrentData);
    updateQModeBar(qCurrentData);
    $('#qMsg').innerHTML = `生成完了。`;
    btn.textContent = '再生成する';
    toast('質問を生成しました');
  } catch(e) {
    $('#qMsg').textContent = '失敗：' + e.message;
  } finally {
    btn.disabled = false;
  }
}
```

`renderQuestions` 関数を編集モード対応に書き換え。既存実装の後半（アコーディオン）を残しつつ、`qMode === 'edit'` なら以下のように描画：

```javascript
function renderQuestions(j) {
  const host = $('#qResult');
  const groups = j.groups || [];

  if (qMode === 'edit') {
    host.innerHTML = `
      ${groups.map((g, gi) => `
        <div class="card q-group" data-g="${gi}" style="margin-bottom:12px">
          <div class="actions" style="margin-bottom:8px">
            <input class="set-input q-group-title" value="${escapeHtml(g.title || '')}" data-g="${gi}" style="flex:1" />
            <button class="btn-ghost btn-small q-group-del" data-g="${gi}">グループ削除</button>
          </div>
          ${(g.items || []).map((q, qi) => `
            <div class="q-edit-box">
              <textarea class="set-input q-text" data-g="${gi}" data-q="${qi}">${escapeHtml(q.text || '')}</textarea>
              <div class="q-actions">
                <button class="btn-ghost btn-small q-up" data-g="${gi}" data-q="${qi}">↑</button>
                <button class="btn-ghost btn-small q-down" data-g="${gi}" data-q="${qi}">↓</button>
                <button class="btn-ghost btn-small q-del" data-g="${gi}" data-q="${qi}">✕</button>
              </div>
            </div>
          `).join('')}
          <button class="btn-ghost btn-small q-add" data-g="${gi}">+ 質問を追加</button>
        </div>
      `).join('')}
      <button class="btn-ghost" id="qGroupAdd">+ 新しいグループを追加</button>
    `;
    wireEditEvents(j);
    return;
  }

  // 既存の閲覧モード描画（既存コードをそのまま流用）
  let n = 0;
  const numbered = groups.map(g => (g.items || []).map(q => ({ ...q, n: ++n })));
  const total = n;
  host.innerHTML = `
    <div class="actions" style="margin-bottom:10px; justify-content:flex-end; align-items:center">
      <span class="hint" style="margin-right:auto">全 <b style="font-family:var(--mono); color:var(--coral-deep)">${total}</b> 件 ／ ${groups.length} グループ</span>
      <button class="btn-ghost btn-small" id="qExpandAll">全て開く</button>
      <button class="btn-ghost btn-small" id="qCollapseAll">全て閉じる</button>
      <button class="btn-ghost" id="qCopyAll">全文コピー（本文のみ）</button>
    </div>
    ${groups.map((g, gi) => `
      <div class="q-acc-item ${gi === 0 ? 'open' : ''}" data-g="${gi}">
        <div class="q-acc-head">
          <div class="q-acc-title">
            <span class="q-acc-arrow">▶</span>
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(g.title || `グループ ${gi+1}`)}</span>
            <span class="q-acc-badge">${(g.items || []).length} 件</span>
          </div>
        </div>
        <div class="q-acc-body">
          ${numbered[gi].map((q) => `
            <div class="q-acc-q">
              <div class="q-num">Q${q.n}</div>
              <div class="q-body">
                <div class="q-text">${escapeHtml(q.text || '')}</div>
                <div class="q-aim"><b>狙い</b>${escapeHtml(q.aim || '')}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('')}
  `;
  $$('#qResult .q-acc-head').forEach(el => {
    el.addEventListener('click', () => el.parentElement.classList.toggle('open'));
  });
  $('#qExpandAll')?.addEventListener('click', () => $$('#qResult .q-acc-item').forEach(it => it.classList.add('open')));
  $('#qCollapseAll')?.addEventListener('click', () => $$('#qResult .q-acc-item').forEach(it => it.classList.remove('open')));
}

function wireEditEvents(j) {
  $$('#qResult .q-text').forEach(ta => {
    ta.addEventListener('input', () => {
      const gi = Number(ta.dataset.g), qi = Number(ta.dataset.q);
      j.groups[gi].items[qi].text = ta.value;
    });
  });
  $$('#qResult .q-group-title').forEach(inp => {
    inp.addEventListener('input', () => {
      j.groups[Number(inp.dataset.g)].title = inp.value;
    });
  });
  $$('#qResult .q-del').forEach(b => b.addEventListener('click', () => {
    const gi = Number(b.dataset.g), qi = Number(b.dataset.q);
    j.groups[gi].items.splice(qi, 1);
    renderQuestions(j);
  }));
  $$('#qResult .q-up').forEach(b => b.addEventListener('click', () => {
    const gi = Number(b.dataset.g), qi = Number(b.dataset.q);
    if (qi > 0) {
      const tmp = j.groups[gi].items[qi - 1];
      j.groups[gi].items[qi - 1] = j.groups[gi].items[qi];
      j.groups[gi].items[qi] = tmp;
      renderQuestions(j);
    }
  }));
  $$('#qResult .q-down').forEach(b => b.addEventListener('click', () => {
    const gi = Number(b.dataset.g), qi = Number(b.dataset.q);
    if (qi < j.groups[gi].items.length - 1) {
      const tmp = j.groups[gi].items[qi + 1];
      j.groups[gi].items[qi + 1] = j.groups[gi].items[qi];
      j.groups[gi].items[qi] = tmp;
      renderQuestions(j);
    }
  }));
  $$('#qResult .q-add').forEach(b => b.addEventListener('click', () => {
    const gi = Number(b.dataset.g);
    j.groups[gi].items.push({ text: '新しい質問', aim: '' });
    renderQuestions(j);
  }));
  $$('#qResult .q-group-del').forEach(b => b.addEventListener('click', () => {
    j.groups.splice(Number(b.dataset.g), 1);
    renderQuestions(j);
  }));
  $('#qGroupAdd')?.addEventListener('click', () => {
    j.groups.push({ title: '新しいグループ', items: [{ text: '', aim: '' }] });
    renderQuestions(j);
  });
}
```

- [ ] **Step 4: `updateQModeBar` と編集モード切替**

```javascript
function updateQModeBar(j) {
  const bar = $('#qModeBar');
  bar.style.display = 'flex';
  const badge = $('#qStatusBadge');
  badge.className = `badge ${j.status}`;
  const labels = {
    draft: '編集中',
    sent: `公開中 ／ 残 ${remainingDays(j.dispatch?.expiresAt)} 日`,
    submitted: '提出済',
    expired: '期限切れ',
    closed: '手動終了',
  };
  badge.textContent = labels[j.status] || j.status;
  $('#qEditBtn').style.display = (j.status === 'draft' && qMode === 'view') ? '' : 'none';
  $('#qSaveBtn').style.display = (j.status === 'draft' && qMode === 'edit') ? '' : 'none';
  $('#qCancelBtn').style.display = (j.status === 'draft' && qMode === 'edit') ? '' : 'none';
  $('#qDispatchBtn').style.display = (j.status === 'draft' && qMode === 'view') ? '' : 'none';
  $('#qFetchBtn').style.display = (j.status === 'sent') ? '' : 'none';
  $('#qCloseBtn').style.display = (j.status === 'sent') ? '' : 'none';
}

function remainingDays(iso) {
  if (!iso) return '?';
  const d = Math.ceil((new Date(iso) - new Date()) / 86400000);
  return Math.max(0, d);
}

$('#qEditBtn').onclick = () => {
  qMode = 'edit';
  renderQuestions(qCurrentData);
  updateQModeBar(qCurrentData);
};

$('#qSaveBtn').onclick = async () => {
  const id = qCurrentData.candidateId;
  const r = await fetch(`/api/questions/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ groups: qCurrentData.groups, editedAt: qCurrentData.editedAt }),
  }).then(r => r.json());
  if (r.ok) {
    qCurrentData.editedAt = r.editedAt;
    qMode = 'view';
    renderQuestions(qCurrentData);
    updateQModeBar(qCurrentData);
    toast('保存しました');
  } else {
    toast('保存失敗：' + (r.error || '不明'));
  }
};

$('#qCancelBtn').onclick = async () => {
  const id = qCurrentData.candidateId;
  qCurrentData = await fetch(`/api/questions/${encodeURIComponent(id)}`).then(r => r.json());
  qMode = 'view';
  renderQuestions(qCurrentData);
  updateQModeBar(qCurrentData);
};
```

- [ ] **Step 5: 動作確認**

```bash
npm start
# 既存の候補者を選んで、「編集」→ 修正 → 保存 → 反映確認
```

- [ ] **Step 6: コミット**

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "feat(bridge): inline edit mode for questions"
```

---

### Task 17: UI — 発送モーダルと回答取込パネル

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: 発送モーダルの実装**

`public/app.js` 末尾に追加：

```javascript
$('#qDispatchBtn').onclick = async () => {
  if (!confirm('アンケートを公開しますか？\n以降、質問の編集はできません。')) return;
  $('#qDispatchBtn').disabled = true;
  showDispatchModal({ loading: true });
  try {
    const id = qCurrentData.candidateId;
    const r = await fetch(`/api/questions/${encodeURIComponent(id)}/dispatch`, { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'dispatch failed');
    showDispatchModal({ result: j });
    qCurrentData = await fetch(`/api/questions/${encodeURIComponent(id)}`).then(r => r.json());
    updateQModeBar(qCurrentData);
    renderQuestions(qCurrentData);
  } catch (e) {
    showDispatchModal({ error: e.message });
  } finally {
    $('#qDispatchBtn').disabled = false;
  }
};

function showDispatchModal({ loading, result, error }) {
  const m = $('#qDispatchModal');
  m.style.display = 'flex';
  m.innerHTML = `<div class="modal-card">${
    loading ? '<div><span class="spinner"></span> Vercel に問巻データを送信しています…</div>' :
    error ? `<div style="color:var(--coral-deep)">✗ 公開失敗：${escapeHtml(error)}</div>
             <div class="actions"><button class="btn-ghost" id="qModalClose">閉じる</button></div>` :
    result ? renderDispatchResult(result) : ''
  }</div>`;
  $('#qModalClose')?.addEventListener('click', () => m.style.display = 'none');
  $('#qCopyUrl')?.addEventListener('click', () => {
    copyToClipboard(result.surveyUrl);
    toast('URL をコピーしました');
  });
  $('#qCopyEmail')?.addEventListener('click', () => {
    copyToClipboard(`件名：${result.email.subject}\n\n${result.email.body}`);
    toast('メール文面をコピーしました');
  });
  $('#qSendMail')?.addEventListener('click', () => {
    const to = $('#qMailTo').value.trim();
    const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(result.email.subject)}&body=${encodeURIComponent(result.email.body)}`;
    window.location.href = url;
  });
}

function renderDispatchResult(r) {
  return `
    <h3>✓ アンケートを公開しました</h3>
    <div class="hint">候補者用 URL（候補者にはこちらを送る）</div>
    <div style="display:flex; gap:8px; margin:6px 0">
      <input class="set-input" value="${escapeHtml(r.surveyUrl)}" readonly style="flex:1" />
      <button class="btn-ghost" id="qCopyUrl">コピー</button>
    </div>
    <div class="hint" style="margin-top:8px">期限：${escapeHtml((r.expiresAt || '').replace('T', ' ').slice(0, 16))}</div>

    <h4 style="margin-top:16px">メール文面（編集可、設定ページでテンプレ変更可能）</h4>
    <div><b>件名：</b>${escapeHtml(r.email.subject)}</div>
    <textarea class="set-input" rows="10" readonly style="margin-top:6px; width:100%">${escapeHtml(r.email.body)}</textarea>

    <h4 style="margin-top:16px">送信先（任意）</h4>
    <div style="display:flex; gap:8px">
      <input id="qMailTo" type="email" class="set-input" placeholder="candidate@example.com" style="flex:1" />
      <button class="btn-ghost" id="qSendMail">メールで送る</button>
    </div>

    <div class="actions" style="margin-top:16px; justify-content:flex-end">
      <button class="btn-ghost" id="qCopyEmail">メール文面をコピー</button>
      <button class="btn-primary" id="qModalClose">閉じる</button>
    </div>
  `;
}
```

- [ ] **Step 2: 回答取込パネル**

```javascript
$('#qFetchBtn').onclick = async () => {
  const id = qCurrentData.candidateId;
  const btn = $('#qFetchBtn');
  btn.disabled = true;
  try {
    const r = await fetch(`/api/questions/${encodeURIComponent(id)}/fetch`, { method: 'POST' });
    const j = await r.json();
    if (j.status === 'pending') {
      toast('まだ回答がありません');
    } else if (j.status === 'submitted') {
      toast('回答を取得しました');
      qCurrentData = await fetch(`/api/questions/${encodeURIComponent(id)}`).then(r => r.json());
      updateQModeBar(qCurrentData);
      renderQuestions(qCurrentData);
      if (qCurrentData.answers) renderAnswersPanel(qCurrentData.answers);
    }
  } catch (e) {
    toast('取得失敗：' + e.message);
  } finally {
    btn.disabled = false;
  }
};

$('#qCloseBtn').onclick = async () => {
  if (!confirm('このアンケートを手動で終了しますか？\n候補者が以降アクセスしても期限切れとして表示されます。')) return;
  const id = qCurrentData.candidateId;
  await fetch(`/api/questions/${encodeURIComponent(id)}/close`, { method: 'POST' });
  qCurrentData = await fetch(`/api/questions/${encodeURIComponent(id)}`).then(r => r.json());
  updateQModeBar(qCurrentData);
  toast('終了しました');
};

function renderAnswersPanel(a) {
  const host = $('#qAnswersPanel');
  host.style.display = 'block';
  host.innerHTML = `
    <div class="card" style="margin-top:16px">
      <h3>取込済の回答</h3>
      <div class="hint">提出日時：${escapeHtml((a.respondent?.submittedAt || '').replace('T', ' ').slice(0, 16))}</div>
      <div><b>メアド：</b>${escapeHtml(a.respondent?.email || '')}</div>
      <div><b>氏名確認：</b>${escapeHtml(a.respondent?.nameConfirmed || '')}</div>
      <hr/>
      ${a.answers.map((x, i) => `
        <div style="margin:10px 0">
          <div class="q-num">Q${i + 3}</div>
          <div class="q-text">${escapeHtml(x.questionText)}</div>
          <div class="q-aim"><b>狙い</b>${escapeHtml(x.aim)}</div>
          <div style="background:#f5f0e8; padding:8px; margin-top:4px; white-space:pre-wrap">${escapeHtml(x.answerText)}</div>
        </div>
      `).join('')}
      ${a.supplementary ? `
        <hr/>
        <div><b>補足</b></div>
        <div style="background:#f5f0e8; padding:8px; white-space:pre-wrap">${escapeHtml(a.supplementary)}</div>
      ` : ''}
    </div>
  `;
}
```

- [ ] **Step 3: 動作確認**

```bash
npm start
# 候補者選択 → 「公開」→ モーダルが出る（Vercel 接続済前提）
# 候補者 URL を別ブラウザで開いて回答 → 「今すぐ取得」で取込確認
```

- [ ] **Step 4: コミット**

```bash
git add public/app.js
git commit -m "feat(bridge): dispatch modal and answers panel"
```

---

### Task 18: UI — 設定ページの拡張

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`

- [ ] **Step 1: `public/index.html` の設定ページに新セクションを追加**

既存の `<!-- ⑤ 設定 -->` ブロックの末尾に追加：

```html
<div class="card" style="margin-top:16px">
  <h2>Vercel アンケート連携</h2>
  <div class="row">
    <div class="label">状態</div>
    <div>
      <span id="surveyStatus">未設定</span>
      <button class="btn-ghost btn-small" id="surveyTest" style="margin-left:8px">接続テスト</button>
    </div>
  </div>
  <div class="row">
    <div class="label">API エンドポイント</div>
    <div><input id="surveyEndpoint" class="set-input" placeholder="https://your-app.vercel.app" /></div>
  </div>
  <div class="row">
    <div class="label">API Key</div>
    <div>
      <input id="surveyApiKey" class="set-input" type="password" placeholder="現在: ••••" />
      <span class="hint">空のままにすると変更されません</span>
    </div>
  </div>
</div>

<div class="card" style="margin-top:16px">
  <h2>送信元情報</h2>
  <div class="row">
    <div class="label">会社名</div>
    <div><input id="companyName" class="set-input" /></div>
  </div>
  <div class="row">
    <div class="label">HR 担当者名</div>
    <div><input id="hrName" class="set-input" /></div>
  </div>
  <div class="row">
    <div class="label">HR メアド</div>
    <div><input id="hrEmail" class="set-input" type="email" /></div>
  </div>
</div>

<div class="card" style="margin-top:16px">
  <h2>メール文面テンプレ</h2>
  <div class="row">
    <div class="label">件名</div>
    <div><input id="emailSubject" class="set-input" /></div>
  </div>
  <div class="row">
    <div class="label">本文</div>
    <div><textarea id="emailBody" class="set-input" rows="14"></textarea></div>
  </div>
  <div class="hint">プレースホルダ：{候補者名} {ポジション} {会社名} {HR 名} {Survey URL} {締切日}</div>
  <button class="btn-ghost" id="emailReset">初期テンプレに戻す</button>
</div>

<div class="card" style="margin-top:16px">
  <h2>アンケートページ説明文</h2>
  <div class="row">
    <div class="label">タイトル</div>
    <div><input id="surveyTitle" class="set-input" /></div>
  </div>
  <div class="row">
    <div class="label">説明文</div>
    <div><textarea id="surveyDesc" class="set-input" rows="10"></textarea></div>
  </div>
  <div class="hint">プレースホルダ：{候補者名} {ポジション} {会社名} {締切日}</div>
  <button class="btn-ghost" id="surveyDescReset">初期テンプレに戻す</button>
</div>

<div class="actions" style="margin-top:16px">
  <button class="btn-primary" id="settingsSave">設定を保存</button>
  <span id="settingsMsg" class="hint"></span>
</div>
```

- [ ] **Step 2: `public/app.js` の nav ハンドラに設定ロードを追加**

`PAGE_TITLES['set']` の case を nav switch に追加（既存の if/else パターンに合わせる）：

```javascript
// 既存の navitem click ハンドラ内の if 群に追加：
if (key === 'set') loadSettings();
```

`public/app.js` 末尾に新規関数：

```javascript
const DEFAULT_EMAIL_SUBJECT = '【{会社名}】面接前アンケートご記入のお願い（{候補者名} 様）';
const DEFAULT_EMAIL_BODY = `{候補者名} 様

この度は弊社 {ポジション} ポジションにご応募いただき、誠にありがとうございます。

面接前に、{締切日} までに下記アンケートへのご記入をお願いいたします。
（所要時間：10〜15 分程度）

▼アンケート URL
{Survey URL}

なお、当アンケートは 1 回のみご回答いただけます。
回答後は自動的に受付終了となります。
ご不明な点がございましたら、本メールにご返信ください。

何卒よろしくお願いいたします。
{HR 名}`;
const DEFAULT_SURVEY_TITLE = '面接前事前アンケート';
const DEFAULT_SURVEY_DESC = `{ポジション} のご応募ありがとうございます。
面接をより有意義なお時間とするため、事前にいくつかご質問させていただきます。
所要時間は 10〜15 分程度です。{締切日} までにご回答ください。

【個人情報の取り扱いについて】
ご回答内容は採用選考の目的のみに使用し、不採用の場合は 6 ヶ月以内に破棄いたします。`;

async function loadSettings() {
  const s = await fetch('/api/settings').then(r => r.json());
  $('#surveyEndpoint').value = s.surveyEndpoint || '';
  $('#surveyApiKey').placeholder = s.surveyApiKeyMasked ? `現在: ${s.surveyApiKeyMasked}` : '未設定';
  $('#surveyStatus').textContent = s.surveyEndpoint ? `エンドポイント設定済（${s.surveyEndpoint}）` : '未設定';
  $('#companyName').value = s.companyName || '';
  $('#hrName').value = s.hrName || '';
  $('#hrEmail').value = s.hrEmail || '';
  $('#emailSubject').value = s.emailTemplate?.subject || DEFAULT_EMAIL_SUBJECT;
  $('#emailBody').value = s.emailTemplate?.body || DEFAULT_EMAIL_BODY;
  $('#surveyTitle').value = s.surveyPageTemplate?.title || DEFAULT_SURVEY_TITLE;
  $('#surveyDesc').value = s.surveyPageTemplate?.description || DEFAULT_SURVEY_DESC;

  $('#settingsSave').onclick = saveSettingsPage;
  $('#emailReset').onclick = () => {
    $('#emailSubject').value = DEFAULT_EMAIL_SUBJECT;
    $('#emailBody').value = DEFAULT_EMAIL_BODY;
  };
  $('#surveyDescReset').onclick = () => {
    $('#surveyTitle').value = DEFAULT_SURVEY_TITLE;
    $('#surveyDesc').value = DEFAULT_SURVEY_DESC;
  };
  $('#surveyTest').onclick = async () => {
    const r = await fetch('/api/settings/survey-test').then(r => r.json());
    if (r.reachable) toast('✓ 接続 OK'); else toast('✗ 接続失敗：' + (r.error || `HTTP ${r.status}`));
  };
}

async function saveSettingsPage() {
  $('#settingsMsg').innerHTML = '<span class="spinner"></span> 保存中…';
  const body = {
    companyName: $('#companyName').value,
    hrName: $('#hrName').value,
    hrEmail: $('#hrEmail').value,
    emailTemplate: { subject: $('#emailSubject').value, body: $('#emailBody').value },
    surveyPageTemplate: { title: $('#surveyTitle').value, description: $('#surveyDesc').value },
    surveyEndpoint: $('#surveyEndpoint').value,
    surveyApiKey: $('#surveyApiKey').value || undefined,
  };
  const r = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());
  if (r.ok) {
    $('#settingsMsg').textContent = '保存しました';
    $('#surveyApiKey').value = '';
    toast('設定を保存しました');
    setTimeout(() => loadSettings(), 100);
  } else {
    $('#settingsMsg').textContent = '保存失敗：' + (r.error || '不明');
  }
}
```

- [ ] **Step 3: 動作確認**

```bash
npm start
# 設定タブを開いて、各フィールド編集 → 保存 → リロードで保持確認
```

- [ ] **Step 4: コミット**

```bash
git add public/index.html public/app.js
git commit -m "feat(bridge): settings page with vercel link, templates editor"
```

---

## Phase C — 仕上げ

### Task 19: 失敗モード対応（候補者氏名抽出失敗 / 楽観的ロック警告 / dispatch ガード）

**Files:**
- Modify: `public/app.js`
- Modify: `server.js`

- [ ] **Step 1: 候補者氏名が「(匿名)」の場合、dispatch ボタン押下時に警告**

`public/app.js` の `$('#qDispatchBtn').onclick` 冒頭で：

```javascript
$('#qDispatchBtn').onclick = async () => {
  if (qCurrentData.candidateName === '(匿名)' || !qCurrentData.candidateName) {
    if (!confirm('候補者氏名が未設定です。メールテンプレの {候補者名} は「候補者」となります。続行しますか？')) return;
  }
  if (!confirm('アンケートを公開しますか？\n以降、質問の編集はできません。')) return;
  // 以降は既存と同じ
};
```

- [ ] **Step 2: PUT API の楽観的ロック失敗時のリトライ案内**

`$('#qSaveBtn').onclick` でレスポンスが `error === 'stale'` の時に再読込を提案：

```javascript
$('#qSaveBtn').onclick = async () => {
  const id = qCurrentData.candidateId;
  const r = await fetch(`/api/questions/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ groups: qCurrentData.groups, editedAt: qCurrentData.editedAt }),
  }).then(r => r.json());
  if (r.ok) {
    qCurrentData.editedAt = r.editedAt;
    qMode = 'view';
    renderQuestions(qCurrentData);
    updateQModeBar(qCurrentData);
    toast('保存しました');
  } else if (r.error === 'stale') {
    if (confirm('他のタブで更新されています。最新を読込んで破棄しますか？\n（キャンセル：このまま保留）')) {
      qCurrentData = await fetch(`/api/questions/${encodeURIComponent(id)}`).then(r => r.json());
      qMode = 'view';
      renderQuestions(qCurrentData);
      updateQModeBar(qCurrentData);
    }
  } else {
    toast('保存失敗：' + (r.error || '不明'));
  }
};
```

- [ ] **Step 3: dispatch 時に survey-config 未設定の場合のメッセージ改善**

`showDispatchModal` の error 分岐で、`error === 'no_survey_config'` の特別表示を入れる：

```javascript
error ? (error === 'no_survey_config'
  ? `<div style="color:var(--coral-deep)">✗ Vercel 接続が未設定です。<br/>設定ページの「Vercel アンケート連携」で エンドポイントと API Key を登録してください。</div>
     <div class="actions"><button class="btn-ghost" id="qModalClose">閉じる</button></div>`
  : `<div style="color:var(--coral-deep)">✗ 公開失敗：${escapeHtml(error)}</div>
     <div class="actions"><button class="btn-ghost" id="qModalClose">閉じる</button></div>`) :
```

- [ ] **Step 4: コミット**

```bash
git add public/app.js
git commit -m "feat(bridge): friendlier failure messages and dispatch guards"
```

---

### Task 20: 手動 E2E 1 周

**Files:** （変更なし。確認のみ）

- [ ] **Step 1: Vercel デプロイ済を前提に、設定ページで接続情報を登録**

```
設定 → Vercel アンケート連携
エンドポイント：https://bridge-survey-xxx.vercel.app
API Key：（Vercel ダッシュボードからコピー）
[接続テスト] → ✓ 接続 OK
[設定を保存]
```

- [ ] **Step 2: 履歷から人物像生成 → 質問生成 → 編集**

1. 募集要件タブで要件を設定
2. 新規評価タブで履歷をアップロード（既存機能、サンプル PDF を 1 件用意）
3. 質問生成タブで候補者を選び「質問を生成」
4. 編集モードで 1-2 問を修正、削除、追加
5. 保存

- [ ] **Step 3: 公開 → URL を別ブラウザで開いて回答**

1. 「アンケートを公開」→ モーダル表示
2. URL をコピー、シークレットウィンドウで開く
3. メアド入力、氏名確認、全質問回答、補足を記入
4. 「送信する」→ 「ご回答ありがとうございました」表示
5. 同 URL を再度開く → 「ご回答ありがとうございました」が出る（lock 機能の確認）

- [ ] **Step 4: 取込確認**

1. Bridge に戻る、候補者の「今すぐ取得」ボタンをクリック
2. 「回答を取得しました」トースト
3. ステータスバッジが「提出済」に変わる
4. 「取込済の回答」パネルが表示、内容が正しい

- [ ] **Step 5: 期限切れシナリオ**

1. もう 1 件公開、`questions/{id}.json` を手で開いて `dispatch.expiresAt` を過去日時に書換
2. ポーリングジョブを待つ（5 分）か、サーバ再起動
3. ステータスが「期限切れ」に遷移
4. URL を開くと「受付期間外」表示

- [ ] **Step 6: 手動終了シナリオ**

1. もう 1 件公開
2. 「手動終了」ボタン → 確認 → 「終了しました」
3. URL を開くと「ご回答ありがとうございました」表示（lock 設定で）

- [ ] **Step 7: コミット（このタスクで発見されたバグ修正のみ。E2E 自体は記録不要）**

E2E で問題なければスキップ。バグ修正があれば：

```bash
git add -A
git commit -m "fix(bridge): <bug found during E2E>"
```

---

### Task 21: README 更新

**Files:**
- Modify: `Claude_Resume_Check/README.md`（既存ファイル無ければ新規作成）

- [ ] **Step 1: ルート README に survey/ の節を追加**

`Claude_Resume_Check/README.md` に以下を追記（既存内容の末尾に）：

```markdown
## 面接前 WEB アンケート機能

### 概要
候補者に Web アンケートを送り、回答を Bridge に取込んで面接前に共有する。

### 構成
- 本地 Bridge（このリポ）：質問生成、編集、配信制御、回答取込
- `survey/`：Vercel デプロイ用の Next.js アプリ（候補者が回答するページ）
- `shared/types.ts`：両端の契約

### セットアップ
1. `survey/README.md` に従って Vercel デプロイ
2. Vercel ダッシュボードで `SURVEY_API_KEY` を生成（`openssl rand -hex 16`）
3. Bridge 起動 → 設定タブ → 「Vercel アンケート連携」にエンドポイントと API Key を登録
4. 「接続テスト」で確認

### 使い方
1. 履歷をアップロード（既存「新規評価」）
2. 「質問生成」タブで候補者を選び「質問を生成」
3. 必要なら編集
4. 「アンケートを公開」→ モーダルの URL またはメール文面を候補者に送る
5. 候補者が回答 → 5 分以内に自動取込、または「今すぐ取得」ボタン
6. 「取込済の回答」パネルで内容確認

### 設定可能項目（設定タブ）
- 会社名、HR 担当者名、HR メアド
- メール件名・本文テンプレ（プレースホルダ使用可）
- アンケートページタイトル・説明文テンプレ
- Vercel 接続情報
```

- [ ] **Step 2: コミット**

```bash
git add README.md
git commit -m "docs: add pre-interview survey feature to README"
```

---

## 完了

全 21 タスク完了。実装結果：

- Bridge 本地：履歷→人物像→質問生成→編集→公開→回答取込のフルフロー
- Vercel：候補者向け公開アンケートサービス（モバイル対応、localStorage 自動保存、SETNX 単回提出、TTL 7 日失効）
- 設定ページ：HR が自由にメール文面・アンケート表示文を編集可能
- 5 分ポーリング + 期限自動失効
