# 面接前 WEB アンケート機能 設計書

> Clarus（Claude_Resume_Check）の「質問生成」ページに、面接前に候補者へ送る WEB アンケートを実用化する機能を追加する。
> 方針：**Vercel + Upstash Redis を用いた自前アンケート基盤**。本地 Clarus がコンテンツを生成・配信制御、公開アンケートと回答保管は Vercel 上の軽量サービスが担う。

- 作成日：2026-06-16
- 対象範囲：
  - 本地：Clarus 内 `public/index.html` の「質問生成」ページ＋ `server.js` の関連 API
  - 公開側：同一リポジトリの `survey/` サブディレクトリ（Next.js App Router）を Vercel にデプロイ
  - 共有：`shared/types.ts` に契約（DispatchPayload / SurveyResponse 等）を集約
- 前提：既存の TASK=summary / TASK=questions パイプラインは無改造で再利用

---

## 1. 背景と目的

### 1.1 現状

- Clarus は履歷から人物像を要約、要件＋人物像から面接質問を生成できる
- 既存「質問生成」ページは閲覧・コピーのみ
- 候補者への配信、回答収集の仕組みは存在しない

### 1.2 業務フロー

```
①履歷をアップロード（既存）
   ↓
②人物像要約（既存）
   ↓
③「質問を生成」ボタン → AI 出題（既存）
   ↓
④【新規】HR が質問を編集（追加 / 削除 / 文言調整）
   ↓
⑤【新規】「アンケートを公開」ボタン
   → Clarus が Vercel デプロイの公開 API に POST：候補者専用 URL を発行
   → 7 日後に自動失効、単回提出
   ↓
⑥【新規】モーダルに URL + メール文面 → HR が mailto: または LINE 等で送信
   ↓
⑦候補者が URL を開く → 自前アンケートページで回答
   → 提出 → Vercel KV に保存
   ↓
⑧【新規】Clarus「回答取得」ボタン or 5 分自動ポーリング
   → 本地 answers.json
   ↓
（後工程：TASK=evaluate で評価に使う）
```

### 1.3 なぜ Google Forms を使わないか

- 業務上「Google ログインさせたくない」「UI を Clarus 系統と一致させたい」「単回提出 / 7 日失効を完全制御したい」「将来 BridgeVC ブランドでカスタマイズしたい」
- Google Forms API 全自動でもこれらの要求を満たすには複雑な工夫が必要（候補者ごと別 Form を都度作成 / Apps Script トリガ / OAuth 保守等）
- 自前なら正面突破。コードベース管理下に置ける。年間 30 名以下の自用なら Vercel 無料層 + Upstash 無料層で十分

### 1.4 商用 ToS と将来移行

- Vercel Hobby は厳密には個人用途。社内ツール用途は灰色。負荷小（年 30 名 = 1 日数件）でほぼ問題化しないが、念のため：
  - 将来 Pro（$20/月）に上げる選択肢を保持
  - もしくは Cloudflare Pages + D1 に移行する選択肢を保持
  - 公開側コードは Next.js + 標準的なライブラリで書き、ベンダロックを最小化

---

## 2. スコープ

### 2.1 含む

- 公開側：Next.js（App Router）アプリ、Vercel デプロイ。**初期は Vercel 既定ドメイン**（例 `clarus-survey-xxx.vercel.app`）を使用。将来カスタムドメインに切替可能
- データ層：Upstash Redis（Vercel Marketplace 経由）
- 本地：質問編集 UI、配信ボタン、ステータス管理、回答取得 UI（手動 + 自動ポーリング）
- 認証：Clarus ⇔ Vercel 間は共有秘密キー（API Key）。候補者は無認証、URL トークンのみ
- 単回提出：サーバ側原子チェック（Redis SETNX）
- 7 日失効：Redis TTL（`EX 604800`）

### 2.2 含まない

- 候補者ログイン
- メール自動送信（HR が自分のメーラーで送る）
- リアルタイム提出通知（Webhook 等を本地に push しない）
- 多テナント対応 / 被投企業展開

---

## 3. アーキテクチャ

### 3.1 全体構成

```
┌─────────────────────────────────────────────────┐
│ 本地 Clarus（localhost:3939）                    │
│                                                  │
│ UI：「質問生成」ページ                          │
│   ・編集モード                                  │
│   ・「アンケートを公開」ボタン                  │
│   ・ステータスバッジ                            │
│   ・「回答取得」セクション                      │
│                                                  │
│ API：                                            │
│   PUT  /api/questions/:id          編集保存     │
│   POST /api/questions/:id/dispatch 公開要求      │
│   POST /api/questions/:id/fetch    回答取得      │
│   POST /api/questions/:id/close    手動終了      │
│   GET  /api/questions/:id/answers  本地回答     │
│                                                  │
│ モジュール：                                     │
│   server/survey-client.js  Vercel API 呼出       │
│   server/poller.js         5 分自動ポーリング    │
│                                                  │
│ ファイル：                                       │
│   questions/{id}.json         質問本体 + status  │
│   questions/{id}.answers.json 取込済回答         │
│   .clarus/survey-config.json  Vercel エンドポ + API KEY │
└──────────────────────┬──────────────────────────┘
                       │ HTTPS + API Key
                       ↓
┌─────────────────────────────────────────────────┐
│ Vercel：同一リポの survey/（Next.js）            │
│                                                  │
│ ページ：                                         │
│   /q/[token]      候補者アンケートページ        │
│   /q/[token]/done 提出完了ページ                │
│   /q/[token]/expired 期限切れページ             │
│                                                  │
│ API：                                            │
│   POST /api/surveys              問巻発行（保護）│
│   GET  /api/surveys/[token]      問巻取得（公開）│
│   POST /api/surveys/[token]/submit 提出（公開）  │
│   GET  /api/surveys/[token]/result 回答取得（保護）│
│   POST /api/surveys/[token]/close 終了（保護）   │
│                                                  │
│ ストレージ：Upstash Redis（Vercel Marketplace）  │
│   q:{token}        問巻 JSON（TTL 7d）          │
│   q:{token}:lock   提出ロック（SETNX）          │
│   q:{token}:resp   提出回答 JSON                │
│   pending:hr       未取得回答 token のセット    │
└─────────────────────────────────────────────────┘
                       ↑
                       │ 候補者ブラウザ
                       │
                  https://{your-app}.vercel.app/q/abc123
```

### 3.2 認証

#### Clarus → Vercel
- 共有秘密キー `SURVEY_API_KEY`（32 字 random hex）を `.clarus/survey-config.json` に保存
- Vercel 側は `process.env.SURVEY_API_KEY` で受ける
- 保護対象エンドポイント：`POST /api/surveys`、`GET /api/surveys/[token]/result`、`POST /api/surveys/[token]/close`
- リクエストヘッダ：`Authorization: Bearer <SURVEY_API_KEY>`

#### 候補者 → Vercel
- 無認証、トークン URL のみ
- トークン：crypto.randomBytes(9).toString("base64url") = **12 文字**（72 bit 強度、URL safe）

### 3.3 データモデル

#### `questions/{candidateId}.json`（本地、拡張）

```jsonc
{
  // 既存
  "candidateId": "a1b2c3d4",
  "candidateName": "山田太郎",
  "position": "ネットワークエンジニア（運用）",
  "generatedAt": "2026-06-16T10:00:00Z",
  "groups": [
    { "title": "...", "items": [{ "text": "...", "aim": "..." }] }
  ],

  // 新規
  "status": "draft",  // draft | sent | submitted | expired | closed
  "editedAt": "2026-06-16T10:05:00Z",
  "dispatch": {
    "token": "abc123XYZ_67",
    "surveyUrl": "https://{your-app}.vercel.app/q/abc123XYZ_67",
    "createdAt": "2026-06-16T10:10:00Z",
    "sentAt": "2026-06-16T10:11:00Z",
    "expiresAt": "2026-06-23T10:10:00Z",
    "lastPolledAt": "2026-06-16T10:15:00Z",
    "closedAt": null,
    "closeReason": null  // "submitted" | "expired" | "manual"
  }
}
```

#### `questions/{candidateId}.answers.json`（本地、新規）

```jsonc
{
  "candidateId": "a1b2c3d4",
  "token": "abc123XYZ_67",
  "fetchedAt": "2026-06-22T20:35:00Z",
  "respondent": {
    "email": "yamada@example.com",
    "nameConfirmed": "山田 太郎",
    "submittedAt": "2026-06-22T20:30:00Z"
  },
  "answers": [
    {
      "groupTitle": "直近案件の技術スキル深掘り",
      "questionText": "...",
      "aim": "...",
      "answerText": "..."
    }
  ],
  "supplementary": "..."
}
```

#### Redis スキーマ（Vercel 側）

```
q:{token}              JSON {
                         candidateName, position, createdAt, expiresAt,
                         q1Email: { label, required, format: "email" },
                         q2Name:  { label, required, default: "山田太郎" },
                         questions: [
                           { groupTitle, text, aim, required }
                         ],
                         supplementary: { label, required: false },
                         companyName, hrName, hrEmail
                       }
                       TTL: 604800 秒（7 日）

q:{token}:lock         "1"（SETNX、提出時に獲得）
                       TTL: 604800 秒

q:{token}:resp         JSON {
                         email, nameConfirmed,
                         answers: [{ groupTitle, questionText, aim, answerText }],
                         supplementary,
                         submittedAt, ua, ip (truncated)
                       }
                       TTL: 604800 秒

pending:hr             Set of token strings（未取得な回答のトークン）
                       提出時に SADD、Clarus 取得時に SREM
```

---

## 4. UI 設計

### 4.1 「質問生成」ページ — 3 モード

#### モード A：閲覧（既存）
- 候補者選択 → 質問を見るだけ
- 上部ボタン：「編集」「再生成」「アンケートを公開」（status=draft のみ活性）

#### モード B：編集
- 各質問が編集可能テキストエリアに
- 各質問の右に「✕ 削除」「↑」「↓」
- グループタイトル直下に「+ 質問を追加」
- 最下部に「+ 新しいグループを追加」
- 保存：明示的に「変更を保存」
- キャンセル：「破棄して閲覧モードへ」

#### モード C：発送モーダル

「アンケートを公開」を押すとモーダルが開く。Clarus → Vercel API でトークン発行。

```
┌─────────────────────────────────────────────────┐
│ アンケート公開中…                              │
│ ⠋ Vercel に問巻データを送信しています           │
└─────────────────────────────────────────────────┘
   ↓（成功）
┌─────────────────────────────────────────────────┐
│ ✓ アンケートを公開しました                      │
├─────────────────────────────────────────────────┤
│ ▼ 候補者用 URL                                  │
│ https://{your-app}.vercel.app/q/abc123XYZ_67  [コピー]│
│                                                 │
│ ▼ 期限：2026-06-23 10:10（7 日後）             │
│                                                 │
│ ▼ 候補者に送るメール文面                        │
│ ┌──────────────────────────────────────┐       │
│ │ 件名：【○○社】面接前アンケート…      │       │
│ │ 山田太郎 様                           │       │
│ │ この度は…（フル本文 + URL）           │       │
│ └──────────────────────────────────────┘       │
│                                       [コピー]  │
│                                                 │
│ ▼ 送信先（任意、メーラー起動用）                │
│ [____________________________________]          │
│                                                 │
│ [リンクをコピー]  [メールで送る]  [閉じる]      │
└─────────────────────────────────────────────────┘
```

「メールで送る」→ `mailto:{送信先}?subject=...&body=...`
「閉じる」だけでも `dispatch.sentAt = now`（既に公開済のため）

### 4.2 候補者リストのステータス

| 状態 | バッジ | 色 |
|---|---|---|
| `draft` | 編集中 | グレー |
| `sent` | 公開中 ／ 残 N 日 | オレンジ |
| `submitted` | 提出済 | 緑 |
| `expired` | 期限切れ | 赤 |
| `closed` | 手動終了 | グレー |

### 4.2.1 状態遷移

```
[なし] --生成→ draft --「公開」→ sent
                                   ├─提出→ submitted（公開側で自動 lock）
                                   ├─7日経過→ expired（TTL 切れ or 期限ジョブ）
                                   └─手動「終了」→ closed
```

### 4.3 回答取込パネル

`status >= sent` で表示：

```
┌────────────────────────────────────────────┐
│ 回答状況                                    │
│ 自動取得：5 分ごとに確認（最終 5 分前）    │
│ [今すぐ取得]                                │
│                                            │
│ ▼ 取込済の回答                              │
│   提出日時：2026-06-22 20:30                │
│   メアド：yamada@example.com                │
│   氏名確認：山田 太郎                       │
│   Q3：[回答本文…]   〔狙い：…〕            │
│   Q4：…                                    │
└────────────────────────────────────────────┘
```

### 4.4 設定ページの追加

設定ページに **3 つのセクション**を追加：

#### 4.4.1 Vercel アンケート連携

```
─ Vercel アンケート連携 ─
状態：✓ 接続中（{your-app}.vercel.app / 最終 ping 1 分前）
                                          [接続テスト]
API エンドポイント：[https://{your-app}.vercel.app__________]
                    ※将来カスタムドメインに切替時はここを変更
API Key：           [••••••••••••••••__________]  [表示]
```

#### 4.4.2 送信元情報

```
─ 送信元情報 ─
会社名（メール文面用）：[BridgeVC___________________]
HR 担当者名：           [山田 太郎_________________]
HR メアド：             [hr@bridge.vc______________]
```

#### 4.4.3 メール文面テンプレ（編集可）

```
─ 候補者に送るメール文面 ─

件名テンプレ：
[【{会社名}】面接前アンケートご記入のお願い（{候補者名} 様）_____]

本文テンプレ：
┌──────────────────────────────────────────┐
│ {候補者名} 様                              │
│                                            │
│ この度は弊社 {ポジション} ポジションに    │
│ ご応募いただき、誠にありがとうございます。│
│                                            │
│ 面接前に、{締切日} までに下記アンケート…  │
│                                            │
│ ▼アンケート URL                            │
│ {Survey URL}                               │
│                                            │
│ なお、当アンケートは 1 回のみ…            │
│ ご不明な点がございましたら…               │
│                                            │
│ 何卒よろしくお願いいたします。            │
│ {HR 名}                                    │
└──────────────────────────────────────────┘
              [初期テンプレに戻す]

▼ 使えるプレースホルダ：
  {候補者名}  {ポジション}  {会社名}  {HR 名}
  {Survey URL}  {締切日}
```

- テキストエリアで自由編集
- 「初期テンプレに戻す」ボタンで §7.2 の既定値に戻る
- プレースホルダの一覧をその場で表示（HR が何を使えるか分かる）

#### 4.4.4 アンケートページ説明文（編集可）

候補者がアンケートを開いた時にトップに表示される文：

```
─ アンケートページ説明文 ─

タイトル：[面接前事前アンケート___________________]

説明文テンプレ：
┌──────────────────────────────────────────┐
│ {ポジション} のご応募ありがとうございます。│
│ 面接をより有意義なお時間とするため、…    │
│ 所要時間は 10〜15 分程度です。{締切日}…  │
│                                            │
│ 【個人情報の取り扱いについて】            │
│ ご回答内容は採用選考の目的のみに使用し… │
└──────────────────────────────────────────┘
              [初期テンプレに戻す]

▼ 使えるプレースホルダ：
  {候補者名}  {ポジション}  {会社名}  {締切日}
```

dispatch 時に Vercel に渡す JSON に含めて送る（Vercel 側はそれを表示するだけ）。

#### 4.4.5 保存方式

- 全項目は `presets/settings.json` に保存
- 構造：
  ```json
  {
    "companyName": "BridgeVC",
    "hrName": "山田 太郎",
    "hrEmail": "hr@bridge.vc",
    "surveyEndpoint": "https://{your-app}.vercel.app",
    "surveyApiKey": "<本ファイルではなく .clarus/survey-config.json に分離>",
    "emailTemplate": {
      "subject": "...",
      "body": "..."
    },
    "surveyPageTemplate": {
      "title": "面接前事前アンケート",
      "description": "..."
    }
  }
  ```
- **API Key は別ファイル**（`.clarus/survey-config.json`、`.gitignore` 対象）に分離。`presets/settings.json` は誤って Git に入っても秘密漏洩しない

---

## 5. 公開側設計（Vercel `clarus-survey`）

### 5.1 技術スタック

- Next.js 14+（App Router）
- TypeScript
- Tailwind CSS（Clarus 視覚言語を踏襲）
- `@upstash/redis` クライアント
- `zod` でスキーマ検証

### 5.2 ページ

#### `/q/[token]`（候補者アンケート）

1. SSR でサーバ側に `q:{token}` を問合せ
2. 存在しない、または TTL 切れ → 「期限切れ」ページにリダイレクト
3. `q:{token}:lock` 存在 → 「回答済」ページにリダイレクト
4. それ以外 → アンケート HTML を返す

HTML 構造：

```html
<h1>面接前事前アンケート</h1>
<p>{position} のご応募ありがとうございます。期限：{expiresAt}</p>
<p>個人情報の取り扱いについて...</p>

<form>
  <label>Q1. メールアドレス（必須）<input type="email" required></label>
  <label>Q2. お名前のご確認（必須、既定：{candidateName}）<input type="text" value="{candidateName}" required></label>

  <h2>セクション：直近案件の技術スキル深掘り</h2>
  <label>Q3. 直近の◯◯案件で…（必須）<textarea required></textarea></label>
  <label>Q4. …</label>

  <h2>セクション：障害・運用…</h2>
  <label>Q5. …</label>
  ...

  <label>ご質問・補足（任意）<textarea></textarea></label>

  <button>送信する</button>
</form>
```

- モバイル ファースト、ダーク モード対応
- 1 ページに全質問（10〜20 問なら問題なし。長い場合はスクロール）
- 入力途中の localStorage 自動保存（誤って閉じても復元）

#### `/q/[token]/done`（提出完了）
```
ご回答ありがとうございました。
面接のご連絡は別途お送りいたします。
```

#### `/q/[token]/expired`（期限切れ）
```
このアンケートは公開期限を過ぎております。
お手数ですが {hrEmail} までご連絡ください。
```

### 5.3 API

#### `POST /api/surveys`（保護）
Clarus からの問巻発行。

**Headers**: `Authorization: Bearer <SURVEY_API_KEY>`

**Request**:
```json
{
  "candidateId": "a1b2c3d4",
  "candidateName": "山田太郎",
  "position": "ネットワークエンジニア（運用）",
  "groups": [{ "title": "...", "items": [...] }],
  "companyName": "BridgeVC",
  "hrEmail": "hr@bridge.vc",
  "ttlSeconds": 604800
}
```

**Behavior**:
- token = `crypto.randomBytes(9).toString("base64url")`
- `q:{token}` に JSON を `SET ... EX 604800`
- 既定の固定 Q1/Q2/末尾欄を内部で組み立て
- Response: `{ token, surveyUrl, expiresAt }`

#### `GET /api/surveys/[token]`（公開）
SSR 用、問巻データを取得（質問本文のみ、`aim` は返さない）。

#### `POST /api/surveys/[token]/submit`（公開）
提出。

**Request**:
```json
{
  "email": "...",
  "nameConfirmed": "...",
  "answers": [{ "questionText": "...", "answerText": "..." }],
  "supplementary": "..."
}
```

**Behavior**:
1. `SETNX q:{token}:lock 1 EX 604800` — 失敗（既に提出済）→ 409
2. メアド形式バリデーション
3. `SET q:{token}:resp <json>` 
4. `SADD pending:hr {token}`
5. 200 を返す

#### `GET /api/surveys/[token]/result`（保護）
Clarus がポーリング・取得。

**Behavior**:
- `q:{token}:resp` を取得
- なし → `{ status: "pending" }`
- あり → `{ status: "submitted", response: {...} }`
- 任意で `?ack=1` 付ければ取得後に `SREM pending:hr {token}`

#### `POST /api/surveys/[token]/close`（保護）
HR 手動終了 or 提出済になった後の明示的閉鎖。

**Behavior**:
- `SET q:{token}:lock 1`（既にあれば変えない）
- Response: `{ ok: true }`

---

## 6. 本地サーバ API 設計（Clarus 側）

### 6.1 編集系

#### `PUT /api/questions/:id`
- `status != "draft"` → 409
- 楽観的ロック：`editedAt` を送ってサーバの値と比較

### 6.2 配信系

#### `POST /api/questions/:id/dispatch`
Clarus → Vercel POST `/api/surveys`、結果を `questions/{id}.json` に記録、`status = "sent"`。

### 6.3 取込系

#### `POST /api/questions/:id/fetch`
Vercel GET `/api/surveys/[token]/result?ack=1`。回答あれば `answers.json` 保存、`status = "submitted"`、Vercel に `close` を呼ぶ。

#### `POST /api/questions/:id/close`
Vercel `close` 呼出、`status = "closed"`、`closeReason = "manual"`。

### 6.4 ポーリングジョブ

サーバ起動時開始。5 分ごと：

1. `status == "sent"` を走査
2. `now > expiresAt` → `status = "expired"`（Vercel 側は TTL で自然消滅）
3. それ以外 → `/api/questions/:id/fetch` を内部発火

API quota：Upstash 無料層 = 10,000 コマンド/日。1 候補者 1 回ポーリング ≈ 2 コマンド（GET + 場合により SREM）。10 名アクティブ × 5 分間隔 = 1 時間 120 コマンド → 1 日 2,880 コマンド。余裕。

---

## 7. プロンプト変更

### 7.1 TASK=questions 出力は無変更

固定項目（Q1 メアド / Q2 氏名 / 末尾補足）は**サーバ側**で組み立てる。

### 7.2 メール本文テンプレ（初期値）

設定ページで HR が編集可能。下記は初期値（「初期テンプレに戻す」で復元される文）：

**件名**：
```
【{会社名}】面接前アンケートご記入のお願い（{候補者名} 様）
```

**本文**：
```
{候補者名} 様

この度は弊社 {ポジション} ポジションにご応募いただき、誠にありがとうございます。

面接前に、{締切日} までに下記アンケートへのご記入をお願いいたします。
（所要時間：10〜15 分程度）

▼アンケート URL
{Survey URL}

なお、当アンケートは 1 回のみご回答いただけます。
回答後は自動的に受付終了となります。
ご不明な点がございましたら、本メールにご返信ください。

何卒よろしくお願いいたします。
{HR 名}
```

#### プレースホルダ仕様

| プレースホルダ | 値の出所 |
|---|---|
| `{候補者名}` | `questions/{id}.json` の `candidateName`、未設定時は「候補者」 |
| `{ポジション}` | 同上 `position`、未設定時は「ご応募ポジション」 |
| `{会社名}` | `presets/settings.json` の `companyName`、未設定時は「弊社」 |
| `{HR 名}` | 同 `hrName`、未設定時は「採用担当」 |
| `{Survey URL}` | dispatch 時に Vercel が返す URL |
| `{締切日}` | dispatch 時刻 + 7 日（`YYYY-MM-DD` 形式） |

dispatch モーダルに表示する時点で、テンプレ + プレースホルダを展開済みの状態で表示する（HR がそのまま「メールで送る」を押せば mailto: に展開済み本文が入る）。

### 7.3 アンケートページ表示テンプレ（初期値）

設定ページで HR が編集可能（タイトル + 説明文）。下記は初期値：

```
面接前事前アンケート — {候補者名} 様

{ポジション} のご応募ありがとうございます。
面接をより有意義なお時間とするため、事前にいくつかご質問させていただきます。
所要時間は 10〜15 分程度です。{締切日} までにご回答ください。

【個人情報の取り扱いについて】
ご回答内容は採用選考の目的のみに使用し、不採用の場合は 6 ヶ月以内に破棄いたします。

Q1. メールアドレス（必須）
    ご連絡用のメールアドレスをご記入ください。
    [____________________]

Q2. お名前のご確認（必須）
    お名前にお間違いがあれば修正してください。
    [山田太郎_________]

【セクション】直近案件の技術スキル深掘り
Q3. 直近の◯◯案件で…（必須）
    [テキストエリア]
Q4. …

【セクション】障害・運用…
Q5. …

...

ご質問・補足（任意）
アンケート全般についてのご質問や、面接で特に話したい内容があればご記入ください。
[テキストエリア]

[送信する]
```

---

## 8. 失敗モード

| シナリオ | 検出 | 対応 |
|---|---|---|
| API Key 不一致 | Vercel 側 401 | UI で「Vercel 接続失敗、API Key を確認」 |
| Vercel 側ダウン / ネット断 | fetch error | dispatch 時：UI でエラー表示・状態は draft のまま。fetch 時：警告ログのみ、次回ポーリングで復帰 |
| Upstash quota 超過 | API 429 | Vercel 側でエラーレスポンス、UI で「KV quota exhausted」表示 |
| 候補者が二重提出（タブ複数開き等） | `SETNX q:{token}:lock` の 2 回目失敗 | 409 を返す、UI で「既に回答済です」 |
| 候補者の途中保存が壊れた | localStorage の異常 | 復元失敗時は空フォームで開始（警告なし） |
| HR が間違って別候補者の dispatch をした | candidateId と token の対応が `questions/{id}.json` 一意 | 編集ロック（楽観的）で防ぐ |
| メアド形式 NG | 公開側 zod validation | フィールド赤枠 + メッセージ「メールアドレスの形式が正しくありません」 |
| 履歷から氏名抽出失敗（候補者名「(匿名)」） | dispatch 前検出 | UI で警告「候補者氏名未設定、Q2 の既定値を埋められません。続行しますか？」 |
| 候補者が URL を期限切れ後にアクセス | TTL 切れで `q:{token}` 不在 | `/q/[token]/expired` にリダイレクト |
| 候補者が同じ URL を提出後再訪 | `q:{token}:lock` 存在 | `/q/[token]/done` に表示 |
| 候補者の localStorage 復元時に質問が変わった（HR が closed→再生成等） | 質問構造ハッシュを localStorage にも保存 | ハッシュ不一致なら localStorage 破棄して空で開始 |

---

## 9. テスト方針

### 9.1 単体テスト

- トークン生成の一意性 / URL safety
- TTL 計算 / 期限ジョブの境界
- Redis スキーマのシリアライズ / デシリアライズ
- メアド zod スキーマ
- SETNX による単回提出の race（疑似並列）

### 9.2 統合テスト

- Clarus → Vercel フロー：dispatch → fetch → close（モック Vercel API）
- Vercel 側：survey POST → submit → result（モック Redis）

### 9.3 手動 E2E

1. 履歷アップロード → 質問生成 → 編集 → 「公開」
2. 表示 URL を別ブラウザで開いて回答提出
3. 5 分以内の自動ポーリングで取込確認、status = submitted
4. 提出済 URL を再度開く → 「回答済」ページ
5. もう 1 件で公開だけして放置 → expiresAt を手動短縮 → expired 自動遷移、URL アクセスで「期限切れ」ページ
6. もう 1 件で手動「終了」ボタン → closed、URL アクセスで「期限切れ」ページ

---

## 10. デプロイと運用

### 10.1 モノレポ構成

既存リポジトリ `Claude_Resume_Check/` 配下にサブディレクトリを追加：

```
Claude_Resume_Check/                    ← 既存リポ（変更なし）
├── server.js                           Clarus 本体（既存）
├── public/                             Clarus UI（既存）
├── presets/ requirements/ reports/ questions/ processed/ templates/
├── package.json                        Clarus 専用依存（既存）
│
├── survey/                             ← 【新規】Vercel 公開側
│   ├── app/
│   │   ├── q/[token]/page.tsx          候補者アンケート SSR
│   │   ├── q/[token]/done/page.tsx
│   │   ├── q/[token]/expired/page.tsx
│   │   └── api/
│   │       └── surveys/
│   │           ├── route.ts            POST /api/surveys
│   │           └── [token]/
│   │               ├── route.ts        GET /api/surveys/[token]
│   │               ├── submit/route.ts
│   │               ├── result/route.ts
│   │               └── close/route.ts
│   ├── lib/
│   │   ├── redis.ts                    Upstash クライアント
│   │   ├── auth.ts                     API Key 検証
│   │   └── schema.ts                   zod スキーマ
│   ├── components/SurveyForm.tsx
│   ├── styles/globals.css
│   ├── package.json                    survey 専用依存（Next.js, @upstash/redis, zod）
│   ├── tsconfig.json
│   └── next.config.js
│
├── shared/                             ← 【新規】契約
│   └── types.ts                        DispatchPayload, SurveyResponse 等
│
├── docs/superpowers/specs/             本ドキュメント
└── .gitignore                          .clarus/ を追加
```

- ルートにある既存 `package.json` は触らない（Clarus 用）
- `survey/package.json` は独立。`survey/` 配下で `npm install` / `npm run dev`
- `shared/types.ts` は両側から相対 import：
  - Clarus 側：`import type { DispatchPayload } from '../../shared/types.js'`
  - survey 側：`import type { DispatchPayload } from '@/shared/types'`（tsconfig paths）

### 10.2 環境変数（Vercel ダッシュボード）

- `SURVEY_API_KEY` — Clarus と共有する秘密
- `KV_REST_API_URL` — Upstash（自動注入）
- `KV_REST_API_TOKEN` — 同上（自動注入）

### 10.3 デプロイ手順（初回）

1. ローカルで `survey/` 配下を実装、`npm run dev` で動作確認
2. リポを GitHub にプッシュ（既存リポの新しいコミットとして）
3. Vercel で「Add New Project」→ 既存リポを import
4. **Vercel プロジェクト設定で「Root Directory」を `survey` に指定**
5. Framework Preset: Next.js（自動検出）
6. Marketplace から Upstash Redis を追加（`KV_*` 自動注入）
7. `SURVEY_API_KEY` を環境変数に追加（32 字 random hex）
8. デプロイ → Vercel が割り当てた URL（例 `clarus-survey-xxx.vercel.app`）をコピー
9. Clarus 設定ページの「Vercel アンケート連携」に URL と API Key を登録

以降は `git push` だけで Vercel が `survey/` の変更のみを自動再ビルド・再デプロイ（他のサブディレクトリ変更時は再ビルドされない、Vercel の「Ignored Build Step」or デフォルト挙動で）。

### 10.4 将来カスタムドメインに切替

- Vercel ダッシュボード → Domains → 追加（例 `survey.bridge.vc`）
- DNS で CNAME → `cname.vercel-dns.com`
- Clarus 設定ページの API エンドポイントを新ドメインに更新

### 10.5 Clarus 側設定ファイル

- `.clarus/survey-config.json`：
  ```json
  {
    "endpoint": "https://{your-app}.vercel.app",
    "apiKey": "...",
    "pollIntervalMs": 300000
  }
  ```
- `.gitignore` に `.clarus/` を追加（API Key を含むため）

---

## 11. 将来の拡張余地（今回はやらない）

- Pro 移行 or Cloudflare 移行
- 提出時の HR への自動メール通知（Vercel から Resend API 呼出）
- 候補者への自動リマインド
- 複数面接官への配信分割
- 多テナント対応（被投企業ごとに別 token namespace）
- 回答 PDF エクスポート

---

## 12. 実装順序（writing-plans 用ヒント）

### Phase A：公開側骨格（Vercel）
1. `survey/` サブディレクトリ作成、Next.js 雛形（`npx create-next-app survey --typescript`）
2. `shared/types.ts` で契約を定義（DispatchPayload / SurveyResponse / SurveyDocument 等）
3. Upstash 接続、`survey/lib/redis.ts`、`auth.ts`、`schema.ts`
4. `POST /api/surveys` 実装 + ローカルテスト
5. `/q/[token]` SSR 実装
6. `POST /api/surveys/[token]/submit` 実装
7. `/q/[token]/done`、`/expired` 実装
8. `GET /result`、`POST /close` 実装
9. Vercel にデプロイ（Root Directory = survey/）、Vercel 既定ドメインを取得

### Phase B：本地統合（Clarus）
10. データモデル拡張（`questions/{id}.json` に `status` / `dispatch`）
11. `server/survey-client.js`：Vercel API 呼出ラッパ（`shared/types.ts` を import）
12. `PUT /api/questions/:id` + 編集モード UI
13. `POST /dispatch` + モーダル UI
14. `POST /fetch` + 取込 UI
15. ポーリングジョブ + 状態遷移
16. `POST /close` + 手動終了 UI
17. 設定ページの Vercel 接続セクション + `survey-config.json`

### Phase C：仕上げ
18. 失敗モード対応 / 楽観的ロック / バリデーション網羅
19. localStorage 自動保存（候補者側）
20. 手動 E2E 1 周
21. README 更新（ルート README に survey/ 説明を追記）
