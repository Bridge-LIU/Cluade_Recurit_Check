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

export async function loadSurveyConfig(clarusDir) {
  const p = path.join(clarusDir, 'survey-config.json');
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function saveSurveyConfig(clarusDir, config) {
  await fs.mkdir(clarusDir, { recursive: true });
  const p = path.join(clarusDir, 'survey-config.json');
  await fs.writeFile(p, JSON.stringify(config, null, 2), 'utf8');
}
