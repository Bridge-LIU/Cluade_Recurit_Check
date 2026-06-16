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
