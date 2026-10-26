// Offline tests for the A7 grounding step (retrieval + what is sent to the model).
import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOWLEDGE, retrieve } from "../src/grounding.js";
import { buildState } from "../src/model.js";

test("knowledge base has at least 5 records with keywords", () => {
  assert.ok(KNOWLEDGE.length >= 5);
  for (const r of KNOWLEDGE) assert.ok(r.id && r.text && r.keywords.length > 0);
});

test("retrieval picks the matching records, best first", () => {
  assert.deepEqual(retrieve("I was sick. Can I get two more days for the A7 deadline?").map((r) => r.id), ["KB06", "KB05"]);
  assert.equal(retrieve("D1 กับ Supabase ต่างกันยังไงครับ")[0].id, "KB02");
});

test("latin keywords match whole words only", () => {
  // "ai" must not match inside "explain", "data" not inside "database"
  assert.deepEqual(retrieve("please explain it again").map((r) => r.id), []);
});

test("GROUNDING=off sends exactly the A6 state", () => {
  process.env.GROUNDING = "off";
  assert.deepEqual(Object.keys(buildState("What is REST?")), ["platform", "course", "studentQuestion"]);
  process.env.GROUNDING = "on";
  const state = buildState("What is a REST API?") as any;
  assert.equal(state.courseContext.length, 1);
  assert.match(state.courseContext[0], /REST API design/);
  delete process.env.GROUNDING;
});

test("no matching record -> no context added", () => {
  assert.equal("courseContext" in buildState("help it still doesnt work"), false);
});
