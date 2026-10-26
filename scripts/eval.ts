// A7 evaluation: runs eval-cases.json through the real HTTP endpoint (in-process),
// repeated REPEATS times after a warm-up, and saves the results to evidence/.
//   $env:GROUNDING="off"; npm run eval   -> baseline (exact A6 request)
//   $env:GROUNDING="on";  npm run eval   -> improved (with grounding context)
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { app } from "../src/app.js";
import { PROVIDER } from "../src/model.js";
import { groundingEnabled, retrieve } from "../src/grounding.js";
import { CONFIDENCE_THRESHOLD } from "../src/schema.js";

type Case = { id: string; type: string; input: string; expectedDecision: string; expectedReview: boolean | null; simulate?: string; reason: string };
const cases: Case[] = JSON.parse(readFileSync(new URL("../eval-cases.json", import.meta.url), "utf8"));
const REPEATS = Number(process.env.REPEATS ?? 5);
const WARMUP = 3;
const label = groundingEnabled() ? "grounded" : "baseline";

async function call(question: string) {
  const started = performance.now();
  const res = await app.request("/api/triage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const output: any = await res.json();
  return { status: res.status, output, latencyMs: Math.round(performance.now() - started) };
}

// What the model itself chose, read from the reason text (also when it was below the threshold).
function modelChoice(reason: string): string | null {
  return reason.match(/(?:selected|model suggested) '(\w+)'/)?.[1] ?? null;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

delete process.env.SIMULATE_FAILURE;
console.log(`Warm-up: ${WARMUP} requests (not measured)`);
for (let i = 0; i < WARMUP; i++) await call("What is a REST API?");

const runs: { repeat: number; passed: number; rows: any[] }[] = [];
for (let r = 1; r <= REPEATS; r++) {
  const rows = [];
  for (const tc of cases) {
    if (tc.simulate) process.env.SIMULATE_FAILURE = tc.simulate;
    else delete process.env.SIMULATE_FAILURE;
    const { status, output, latencyMs } = await call(tc.input);
    const pass = status === 200 && output.category === tc.expectedDecision && (tc.expectedReview === null || output.needsReview === tc.expectedReview);
    rows.push({ id: tc.id, status, latencyMs, pass, modelChoice: modelChoice(output.reason), output });
    if (r === 1) console.log(`${tc.id} ${pass ? "PASS" : "FAIL"} expected=${tc.expectedDecision} actual=${output.category} source=${output.source} conf=${output.confidence} review=${output.needsReview} ${latencyMs}ms`);
  }
  runs.push({ repeat: r, passed: rows.filter((x) => x.pass).length, rows });
  console.log(`repeat ${r}: ${runs.at(-1)!.passed}/${cases.length}`);
}
delete process.env.SIMULATE_FAILURE;

// Per-case summary over all repeats. A case is "stable" when every repeat gave the same category.
const perCase = cases.map((tc, i) => {
  const all = runs.map((run) => run.rows[i]);
  const first = all[0];
  return {
    ...tc,
    context: groundingEnabled() && !tc.simulate ? retrieve(tc.input).map((k) => k.id) : [],
    actual: first.output.category,
    source: first.output.source,
    confidence: first.output.confidence,
    needsReview: first.output.needsReview,
    modelChoice: first.modelChoice,
    modelCorrect: first.modelChoice === tc.expectedDecision,
    pass: first.pass,
    stable: all.every((x) => x.output.category === first.output.category && x.pass === first.pass),
    medianLatencyMs: percentile(all.map((x) => x.latencyMs), 50),
    reason: first.output.reason,
  };
});

const latencies = runs.flatMap((run) => run.rows.map((x) => x.latencyMs));
const modelLatencies = runs.flatMap((run) => run.rows.filter((_, i) => !cases[i].simulate).map((x) => x.latencyMs));
const passed = perCase.filter((c) => c.pass).length;
const summary = {
  label,
  provider: PROVIDER,
  grounding: groundingEnabled(),
  threshold: CONFIDENCE_THRESHOLD,
  ranAt: new Date().toISOString(),
  repeats: REPEATS,
  measurements: latencies.length,
  accuracy: `${passed}/${cases.length}`,
  accuracyPct: (passed / cases.length) * 100,
  accuracyPerRepeat: runs.map((run) => run.passed),
  modelChoiceCorrect: `${perCase.filter((c) => c.modelChoice !== null && c.modelCorrect).length}/${perCase.filter((c) => c.modelChoice !== null).length}`,
  answeredByModel: perCase.filter((c) => c.source !== "fallback").length,
  sentToReview: perCase.filter((c) => c.needsReview).length,
  latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), max: Math.max(...latencies) },
  modelPathLatencyMs: { p50: percentile(modelLatencies, 50), p95: percentile(modelLatencies, 95), max: Math.max(...modelLatencies) },
  costPerTaskUsd: 0,
  costNote: "Laya runs locally (laya-serve), so there is no per-request API charge. Electricity/CPU time is not measured.",
};

console.log(`\n${summary.label}: accuracy ${summary.accuracy} (${summary.accuracyPct}%), per repeat ${summary.accuracyPerRepeat.join(",")}`);
console.log(`model choice correct ${summary.modelChoiceCorrect}, answered by model ${summary.answeredByModel}/10, sent to review ${summary.sentToReview}/10`);
console.log(`latency over ${summary.measurements} requests: p50 ${summary.latencyMs.p50} ms, p95 ${summary.latencyMs.p95} ms, max ${summary.latencyMs.max} ms`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(new URL("../evidence/", import.meta.url), { recursive: true });
writeFileSync(new URL(`../evidence/eval-${label}-${stamp}.json`, import.meta.url), JSON.stringify({ summary, perCase, runs }, null, 2));
const md = [
  `# Eval: ${label} (${summary.ranAt})`,
  "",
  `Provider ${PROVIDER}, grounding ${summary.grounding ? "on" : "off"}, threshold ${CONFIDENCE_THRESHOLD}, ${REPEATS} repeats after ${WARMUP} warm-up requests.`,
  "",
  "| ID | Type | Expected | Actual | Source | Model choice | Confidence | needsReview | Context | Median latency (ms) | Pass/Fail | Stable |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...perCase.map((c) => `| ${c.id} | ${c.type} | ${c.expectedDecision}${c.expectedReview ? " (review)" : ""} | ${c.actual} | ${c.source} | ${c.modelChoice ?? "-"} | ${c.confidence ?? "-"} | ${c.needsReview} | ${c.context.join(", ") || "-"} | ${c.medianLatencyMs} | ${c.pass ? "Pass" : "Fail"} | ${c.stable ? "yes" : "no"} |`),
  "",
  `**Accuracy ${summary.accuracy} = ${summary.accuracyPct}%** (per repeat: ${summary.accuracyPerRepeat.join(", ")}).`,
  `Model choice correct: ${summary.modelChoiceCorrect}. Answered by the model without review: ${summary.answeredByModel}/10.`,
  `Latency over ${summary.measurements} requests: p50 ${summary.latencyMs.p50} ms, p95 ${summary.latencyMs.p95} ms, max ${summary.latencyMs.max} ms (model path only: p95 ${summary.modelPathLatencyMs.p95} ms).`,
  `Cost per task: $0 measured API cost (${summary.costNote})`,
].join("\n");
writeFileSync(new URL(`../evidence/eval-${label}-${stamp}.md`, import.meta.url), md + "\n");
