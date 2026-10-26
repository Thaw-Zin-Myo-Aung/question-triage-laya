import { classifyWithModel, PROVIDER } from "./model.js";
import { fallbackTriage } from "./fallback.js";
import { CONFIDENCE_THRESHOLD, DOWNSTREAM_ACTION, ModelAnswer, type TriageOutput } from "./schema.js";

export async function triage(question: string, courseId?: string): Promise<TriageOutput> {
  let raw: unknown;
  try {
    raw = await classifyWithModel(question, courseId);
  } catch (err) {
    console.warn(`[triage] ${PROVIDER} call failed:`, (err as Error).name, (err as Error).message);
    return fallbackTriage(question, `${PROVIDER} unavailable (${(err as Error).name}: ${(err as Error).message})`);
  }

  const parsed = ModelAnswer.safeParse(raw);
  if (!parsed.success) {
    console.warn(`[triage] ${PROVIDER} output failed validation:`, JSON.stringify(raw));
    return fallbackTriage(question, `${PROVIDER} output failed schema validation`);
  }

  const answer = parsed.data;
  const score = answer.answer_confidence ?? answer.confidence;
  if (score < CONFIDENCE_THRESHOLD) {
    return fallbackTriage(question, `${PROVIDER} confidence ${score.toFixed(2)} below ${CONFIDENCE_THRESHOLD} (model suggested '${answer.choice}')`);
  }

  return {
    category: answer.choice,
    action: DOWNSTREAM_ACTION[answer.choice],
    source: PROVIDER,
    confidence: Number(score.toFixed(3)),
    needsReview: false,
    reason: `${PROVIDER} selected '${answer.choice}' with confidence ${score.toFixed(2)}`,
  };
}
