// Offline tests: no API key needed. They cover validation and every fallback path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";

async function post(body: unknown, raw = false) {
  const res = await app.request("/api/triage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

test("malformed JSON -> 400 JSON error", async () => {
  const r = await post("{not json", true);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /valid JSON/);
});

test("missing / too short / extra fields -> 400", async () => {
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ question: "hi" })).status, 400);
  assert.equal((await post({ question: "What is REST?", admin: true })).status, 400);
  assert.equal((await post({ question: 42 })).status, 400);
});

test("model outage -> 200 with fallback result", async () => {
  process.env.SIMULATE_FAILURE = "error";
  const r = await post({ question: "Can I get an extension for the A6 deadline?" });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.source, r.json.category, r.json.needsReview], ["fallback", "administrative", true]);
});

test("invalid model label -> fallback", async () => {
  process.env.SIMULATE_FAILURE = "invalid";
  const r = await post({ question: "What does the A6 rubric require?" });
  assert.deepEqual([r.json.source, r.json.category], ["fallback", "assignment"]);
  assert.match(r.json.reason, /schema validation/);
});

test("low confidence -> fallback", async () => {
  process.env.SIMULATE_FAILURE = "lowconf";
  const r = await post({ question: "Explain the difference between REST and MCP" });
  assert.deepEqual([r.json.source, r.json.category], ["fallback", "course_content"]);
  assert.match(r.json.reason, /below 0.6/);
});

test("unknown route -> 404 JSON", async () => {
  const res = await app.request("/api/nope");
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "Not found" });
});

// A stand-in for laya-serve so the HTTP path can be tested without the model.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

async function withFakeLaya(status: number, body: unknown, fn: () => Promise<void>) {
  const server = createServer((_req, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  process.env.LAYA_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/systemone`;
  try {
    await fn();
  } finally {
    server.close();
  }
}

test("laya answer above threshold -> source laya", async () => {
  delete process.env.SIMULATE_FAILURE;
  const answer = { type: "choice", choice: "assignment", confidence: 0.45, answer_confidence: 0.82, probabilities: { course_content: 0.1, assignment: 0.82, administrative: 0.05, out_of_scope: 0.03 } };
  await withFakeLaya(200, { model: "laya", answers: { category: answer } }, async () => {
    const r = await post({ question: "What does the A6 rubric require?" });
    assert.deepEqual([r.json.source, r.json.category, r.json.confidence, r.json.needsReview], ["laya", "assignment", 0.82, false]);
  });
});

test("laya HTTP 500 -> fallback", async () => {
  delete process.env.SIMULATE_FAILURE;
  await withFakeLaya(500, { detail: "inference failed" }, async () => {
    const r = await post({ question: "Can I get an extension for the A6 deadline?" });
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.source, r.json.category], ["fallback", "administrative"]);
    assert.match(r.json.reason, /HTTP 500/);
  });
});

test("laya not running -> fallback", async () => {
  delete process.env.SIMULATE_FAILURE;
  process.env.LAYA_URL = "http://127.0.0.1:9/v1/systemone";
  const r = await post({ question: "What is the difference between REST and MCP?" });
  assert.deepEqual([r.json.source, r.json.category], ["fallback", "course_content"]);
});
