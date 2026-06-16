# Clarus Survey (公開アンケート側)

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
5. `NEXT_PUBLIC_BASE_URL` を本番 URL に設定（例 `https://clarus-survey-xxx.vercel.app`）
6. デプロイ
