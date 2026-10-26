import { readFileSync } from "node:fs";

// Week 9 improvement: grounding context. A few short records from a local
// knowledge base are picked by keyword match and sent to the model with the
// question. Turn it off with GROUNDING=off to get the exact A6 request back.
export type KnowledgeRecord = { id: string; category: string; title: string; text: string; keywords: string[] };

export const KNOWLEDGE: KnowledgeRecord[] = JSON.parse(
  readFileSync(new URL("../knowledge/course-kb.json", import.meta.url), "utf8"),
);

const TOP_K = 2;

export function groundingEnabled(): boolean {
  return process.env.GROUNDING !== "off";
}

// Latin keywords must match as whole words ("ai" must not match "explain").
// Thai has no spaces between words, so Thai keywords match as substrings.
function matches(question: string, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  if (!/[a-z0-9]/.test(kw)) return question.includes(kw);
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(question);
}

// Score = number of distinct keywords found in the question. Keep the best
// TOP_K records with a score above 0; ties keep the knowledge base order.
// No match means no context, so the request is the same as without grounding.
export function retrieve(question: string, k = TOP_K): KnowledgeRecord[] {
  const q = question.toLowerCase();
  return KNOWLEDGE.map((record, index) => ({ record, index, score: record.keywords.filter((kw) => matches(q, kw)).length }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, k)
    .map((r) => r.record);
}
