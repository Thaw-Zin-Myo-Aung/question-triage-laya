import "dotenv/config";
import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  const mode = process.env.SIMULATE_FAILURE ? ` (SIMULATE_FAILURE=${process.env.SIMULATE_FAILURE})` : "";
  console.log(`Question triage API on http://localhost:${port}/api/triage${mode}`);
});
