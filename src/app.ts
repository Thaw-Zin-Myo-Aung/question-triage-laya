import { Hono } from "hono";
import { TriageInput, TriageOutput } from "./schema.js";
import { triage } from "./triage.js";

export const app = new Hono();

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.post("/api/triage", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const input = TriageInput.safeParse(body);
  if (!input.success) {
    return c.json({ error: input.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, 400);
  }

  const started = performance.now();
  const result = await triage(input.data.question, input.data.courseId);
  // Final guard: never return something that breaks our own output contract.
  const output = TriageOutput.parse(result);
  c.header("X-Latency-Ms", String(Math.round(performance.now() - started)));
  return c.json(output);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error("[app] unexpected error:", err);
  return c.json({ error: "Internal server error" }, 500);
});
