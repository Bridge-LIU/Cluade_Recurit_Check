// shared/types.ts
// Clarus 本地と survey/ 公開側が共有する契約。

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

// Clarus が取込む結果
export type FetchResult =
  | { status: 'pending' }
  | { status: 'submitted'; response: SubmitPayload & { submittedAt: string } };
