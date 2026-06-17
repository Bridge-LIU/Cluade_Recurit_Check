'use client';
import { useState, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { SurveyDocument } from '@shared/types';

type Props = { token: string; doc: SurveyDocument };

const STORAGE_KEY = (token: string) => `bridge-survey-draft:${token}`;

function buildSchema(questionCount: number) {
  return z.object({
    email: z
      .string()
      .min(1, 'メールアドレスを入力してください')
      .email('メールアドレスの形式が正しくありません')
      .refine((s) => /\.[a-zA-Z]{2,}$/.test(s), {
        message: 'メールアドレスの末尾を確認してください（例：.com / .jp）',
      }),
    nameConfirmed: z.string().min(1, 'お名前を入力してください'),
    answers: z
      .array(z.string().min(1, 'ご回答ください'))
      .length(questionCount, '質問数が一致しません'),
    supplementary: z.string(),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

export default function SurveyForm({ token, doc }: Props) {
  const [started, setStarted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const schema = buildSchema(doc.questions.length);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      email: '',
      nameConfirmed: doc.q2Name.defaultValue,
      answers: doc.questions.map(() => ''),
      supplementary: '',
    },
  });

  // 草稿復元（localStorage）
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY(token));
    if (!saved) return;
    try {
      const d = JSON.parse(saved);
      if (d.questionCount !== doc.questions.length) return;
      reset({
        email: d.email ?? '',
        nameConfirmed: d.name ?? doc.q2Name.defaultValue,
        answers: d.answers ?? doc.questions.map(() => ''),
        supplementary: d.supplementary ?? '',
      });
      const hasDraft =
        d.email ||
        (Array.isArray(d.answers) && d.answers.some((a: string) => a)) ||
        d.supplementary;
      if (hasDraft) setStarted(true);
    } catch {}
  }, [token, doc.questions.length, doc.q2Name.defaultValue, reset]);

  // 草稿保存（form 値の watch を localStorage に流す）
  const watched = useWatch({ control });
  useEffect(() => {
    if (!started) return;
    localStorage.setItem(
      STORAGE_KEY(token),
      JSON.stringify({
        email: watched.email ?? '',
        name: watched.nameConfirmed ?? '',
        answers: watched.answers ?? [],
        supplementary: watched.supplementary ?? '',
        questionCount: doc.questions.length,
      })
    );
  }, [token, started, watched, doc.questions.length]);

  async function onValid(values: FormValues) {
    setSubmitError(null);
    const payload = {
      email: values.email,
      nameConfirmed: values.nameConfirmed,
      answers: doc.questions.map((q, i) => ({
        questionText: q.text,
        answerText: values.answers[i],
      })),
      supplementary: values.supplementary,
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
      setSubmitError('このアンケートは既に回答済です。');
    } else {
      const j = await res.json().catch(() => ({}));
      setSubmitError(j.error ?? '送信に失敗しました。');
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
    <form onSubmit={handleSubmit(onValid)} className="space-y-6 max-w-2xl mx-auto p-6" noValidate>
      <h1 className="text-2xl font-bold">{doc.pageTitle}</h1>
      <p className="whitespace-pre-wrap text-sm">{doc.pageDescription}</p>

      <section className="space-y-4">
        <Field
          label={`Q1. ${doc.q1Email.label}`}
          required
          error={errors.email?.message}
        >
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            aria-invalid={!!errors.email}
            className={inputClass(!!errors.email)}
            {...register('email')}
          />
        </Field>

        <Field
          label={`Q2. ${doc.q2Name.label}`}
          required
          error={errors.nameConfirmed?.message}
        >
          <input
            type="text"
            autoComplete="name"
            aria-invalid={!!errors.nameConfirmed}
            className={inputClass(!!errors.nameConfirmed)}
            {...register('nameConfirmed')}
          />
        </Field>
      </section>

      {doc.questions.map((q, i) => {
        const showHeader = q.groupTitle !== groupTitle;
        groupTitle = q.groupTitle;
        const err = errors.answers?.[i]?.message;
        return (
          <div key={i}>
            {showHeader && (
              <h2 className="text-lg font-bold mt-6 mb-2 border-l-4 border-coral pl-3">
                {q.groupTitle}
              </h2>
            )}
            <Field label={`Q${i + 3}. ${q.text}`} required error={err}>
              <textarea
                rows={4}
                aria-invalid={!!err}
                className={inputClass(!!err)}
                {...register(`answers.${i}` as const)}
              />
            </Field>
          </div>
        );
      })}

      <Field label={doc.supplementary.label}>
        <textarea
          rows={3}
          className={inputClass(false)}
          {...register('supplementary')}
        />
      </Field>

      {submitError && (
        <div role="alert" className="text-coral-deep text-sm">
          {submitError}
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-coral text-white px-6 py-2 rounded disabled:opacity-50 font-medium hover:bg-coral-deep"
      >
        {isSubmitting ? '送信中…' : '送信する'}
      </button>
    </form>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-medium block mb-1">
        {label}
        {required && <span className="text-coral-deep ml-1">*</span>}
      </span>
      {children}
      {error && (
        <span role="alert" className="text-coral-deep text-xs mt-1 block">
          {error}
        </span>
      )}
    </label>
  );
}

function inputClass(hasError: boolean) {
  const base = 'block w-full mt-1 border rounded px-3 py-2 focus:outline-none focus:ring-2';
  return hasError
    ? `${base} border-coral-deep focus:ring-coral-deep/30`
    : `${base} border-gray-300 focus:ring-coral/30 focus:border-coral`;
}
