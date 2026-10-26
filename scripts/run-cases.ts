// Runs every case in cases.json through the real HTTP endpoint (in-process)
// and saves the observed results to evidence/.
//   npm run cases                          -> normal model run (Laya by default)
//   SIMULATE_FAILURE=error npm run cases   -> fallback demo (model "down")
//   npm run cases -- --rules-only          -> keyword rules alone, for comparison
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { app } from "../src/app.js";
import { fallbackTriage } from "../src/fallback.js";
import { PROVIDER } from "../src/model.js";

type Case = { id: string; question: string; expected: string; note: string };
const cases: Case[] = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));
const rulesOnly = process.argv.includes("--rules-only");
const mode = rulesOnly ? "rules-only" : process.env.SIMULATE_FAILURE ? `simulate-${process.env.SIMULATE_FAILURE}` : PROVIDER;

const rows = [];
for (const tc of cases) {
  const started = performance.now();
  let status = 200;
  let output: any;
  if (rulesOnly) {
    output = fallbackTriage(tc.question, "rules-only run");
  } else {
    const res = await app.request("/api/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: tc.question }),
    });
    status = res.status;
    output = await res.json();
  }
  const latencyMs = Math.round(performance.now() - started);
  const pass = output.category === tc.expected;
  rows.push({ ...tc, status, latencyMs, pass, output });
  console.log(`${tc.id} ${pass ? "PASS" : "FAIL"} expected=${tc.expected} actual=${output.category} source=${output.source} conf=${output.confidence} ${latencyMs}ms`);
}

const passed = rows.filter((r) => r.pass).length;
console.log(`\n${passed}/${rows.length} matched expected (${mode})`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(new URL("../evidence/", import.meta.url), { recursive: true });
writeFileSync(new URL(`../evidence/run-${mode}-${stamp}.json`, import.meta.url), JSON.stringify({ mode, ranAt: new Date().toISOString(), passed, total: rows.length, rows }, null, 2));
const md = [
  `# Run: ${mode} (${new Date().toISOString()})`,
  "",
  "| # | Input | Expected | Actual | Source | Confidence | needsReview | Latency (ms) | Pass/Fail |",
  "|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.id} | ${r.question} | ${r.expected} | ${r.output.category} | ${r.output.source} | ${r.output.confidence ?? "-"} | ${r.output.needsReview} | ${r.latencyMs} | ${r.pass ? "Pass" : "Fail"} |`),
  "",
  `**${passed}/${rows.length} matched expected.**`,
].join("\n");
writeFileSync(new URL(`../evidence/run-${mode}-${stamp}.md`, import.meta.url), md + "\n");
