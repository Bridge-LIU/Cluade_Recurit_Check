// server/lib/survey-client.js
async function callJson(url, init, config) {
  const hasBody = init?.body != null;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
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

export async function fetchResult(config, token, { signal } = {}) {
  return callJson(`${config.endpoint}/api/surveys/${encodeURIComponent(token)}/result?ack=1`, {
    method: 'GET',
    signal,
  }, config);
}

export async function closeSurvey(config, token, { signal } = {}) {
  return callJson(`${config.endpoint}/api/surveys/${encodeURIComponent(token)}/close`, {
    method: 'POST',
    signal,
  }, config);
}
