'use client';
import { useState, useEffect } from 'react';
import type { SurveyDocument } from '@shared/types';

type Props = { token: string; doc: SurveyDocument };

const STORAGE_KEY = (token: string) => `bridge-survey-draft:${token}`;

export default function SurveyForm({ token, doc }: Props) {
  const [started, setStarted] = useState(false);
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
          const hasDraft = d.email || (Array.isArray(d.answers) && d.answers.some((a: string) => a)) || d.supplementary;
          if (hasDraft) setStarted(true);
        }
      } catch {}
    }
  }, [token, doc.questions.length, doc.q2Name.defaultValue]);

  useEffect(() => {
    if (!started) return;
    localStorage.setItem(STORAGE_KEY(token), JSON.stringify({
      email, name, answers, supplementary, questionCount: doc.questions.length,
    }));
  }, [token, email, name, answers, supplementary, doc.questions.length, started]);

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

  if (!started) {
    return (
      <main className="space-y-6 max-w-2xl mx-auto p-6">
        <h1 className="text-2xl font-bold">{doc.pageTitle}</h1>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{doc.pageDescription}</p>
        <div className="text-sm text-ink/60">
          全 {doc.questions.length + 2} 問（メールアドレス・氏名確認を含む）
        </div>
        <button
          type="button"
          onClick={() => setStarted(true)}
          className="bg-coral text-white px-6 py-3 rounded font-medium hover:bg-coral-deep"
        >
          回答を始める
        </button>
      </main>
    );
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
