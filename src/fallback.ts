import { type Category, DOWNSTREAM_ACTION, type TriageOutput } from "./schema.js";

// Deterministic keyword rules. Order matters: the first matching rule wins.
// Out-of-scope is checked first so "do my assignment for me" is not routed
// to the assignment helper.
const RULES: { category: Category; pattern: RegExp }[] = [
  {
    category: "out_of_scope",
    pattern: /\b(do|write|solve|finish|complete) (my|the) (assignment|homework|report|lab|code)\b|\b(weather|movie|football|recipe|bitcoin|crypto)\b|ignore (all|previous|your) instructions/i,
  },
  {
    category: "administrative",
    pattern: /\b(grade|grades|score|marks?|extension|late submission|deadline extension|absent|absence|attendance|enrol+|enrol+ment|register|registration|drop the course|withdraw|exam room|office hours?|appeal)\b/i,
  },
  {
    category: "assignment",
    pattern: /\b(assignment|a\d{1,2}|homework|lab|deliverable|rubric|submission|submit|due|report format|template|pdf)\b/i,
  },
  {
    category: "course_content",
    pattern: /\b(what is|what are|explain|difference between|how does|why does|define|example of|lecture|slide|week \d+)\b/i,
  },
];

export function fallbackTriage(question: string, why: string): TriageOutput {
  const hit = RULES.find((rule) => rule.pattern.test(question));
  // No rule matched: send it to retrieval, which says "no source found"
  // itself if the materials do not cover it, and flag it for a human.
  const category: Category = hit?.category ?? "course_content";
  return {
    category,
    action: DOWNSTREAM_ACTION[category],
    source: "fallback",
    confidence: null,
    needsReview: true,
    reason: `${why}; ${hit ? `keyword rule matched '${category}'` : "no keyword rule matched, defaulted to course_content"}`,
  };
}
