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
