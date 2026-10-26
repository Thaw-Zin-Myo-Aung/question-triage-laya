import { z } from "zod";

// The four triage outcomes. Each one maps to a different downstream action
// in the Learning Assistant (see DOWNSTREAM_ACTION).
export const CATEGORIES = ["course_content", "assignment", "administrative", "out_of_scope"] as const;
export type Category = (typeof CATEGORIES)[number];

export const DOWNSTREAM_ACTION: Record<Category, string> = {
  course_content: "answer_from_course_materials",
  assignment: "answer_with_assignment_context",
  administrative: "escalate_to_instructor",
  out_of_scope: "decline_with_reason",
};

// Answers below this confidence are not trusted and go to the fallback.
// We gate on the probability of the chosen label (Laya's `answer_confidence`;
// for Jev, `confidence`). Laya's `confidence` is 1 - normalised entropy, a
// different scale, so the lecture's 0.7 for Jev does not carry over.
// 0.6 is a starting point to tune with the Week 9 evaluation set.
export const CONFIDENCE_THRESHOLD = Number(process.env.CONFIDENCE_THRESHOLD ?? 0.6);

// Input contract: what a client must send to POST /api/triage.
export const TriageInput = z
  .object({
    question: z.string().trim().min(3, "question must be at least 3 characters").max(1000, "question must be at most 1000 characters"),
    courseId: z.string().trim().min(1).max(50).optional(),
  })
  .strict();
export type TriageInput = z.infer<typeof TriageInput>;

// What we require from the model's answer before we trust it.
export const ModelAnswer = z.object({
  choice: z.enum(CATEGORIES),
  confidence: z.number().min(0).max(1),
  answer_confidence: z.number().min(0).max(1).optional(),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});
export type ModelAnswer = z.infer<typeof ModelAnswer>;

// Output contract: identical shape for the model path and the fallback path,
// so callers cannot tell (and do not need to know) which one answered.
export const TriageOutput = z.object({
  category: z.enum(CATEGORIES),
  action: z.string(),
  source: z.enum(["laya", "jev", "fallback"]),
  confidence: z.number().min(0).max(1).nullable(),
  needsReview: z.boolean(),
  reason: z.string(),
});
export type TriageOutput = z.infer<typeof TriageOutput>;
