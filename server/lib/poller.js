// server/lib/poller.js
import fs from 'fs/promises';
import { readQuestions, writeQuestions, writeAnswers } from './questions-store.js';
import { fetchResult, closeSurvey } from './survey-client.js';
import { loadSurveyConfig } from './settings.js';

const FETCH_TIMEOUT_MS = 10000;

export function startPoller({ questionsDir, clarusDir, intervalMs = 300000 }) {
  let timer = null;
  async function tick() {
    try {
      const config = await loadSurveyConfig(clarusDir);
      if (!config) return;

      const files = await fs.readdir(questionsDir);
      for (const f of files) {
        if (!f.endsWith('.json') || f.endsWith('.answers.json')) continue;
        const id = f.replace(/\.json$/, '');
        try {
          const data = await readQuestions(questionsDir, id);
          if (data.status !== 'sent') continue;

          if (data.dispatch.expiresAt && new Date() > new Date(data.dispatch.expiresAt)) {
            await writeQuestions(questionsDir, id, {
              ...data,
              status: 'expired',
              dispatch: { ...data.dispatch, closedAt: new Date().toISOString(), closeReason: 'expired' },
            });
            continue;
          }

          const result = await fetchResult(config, data.dispatch.token, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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
            await closeSurvey(config, data.dispatch.token, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
              .catch(e => console.warn('[poller] closeSurvey failed:', e.message));
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
  tick();
  timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
