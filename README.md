# A6/A7: Learning Assistant Question Triage

One small AI decision capability for our group platform (Learning Assistant, Team 08).
Before a student's question goes into the answer pipeline, a decision model decides **what kind of question it is**,
so the platform can pick the right next step.

| Category | Downstream action |
|---|---|
| `course_content` | Answer from approved course materials (retrieval + citations) |
| `assignment` | Answer using the assignment context (`assignment.published`) |
| `administrative` | Escalate to instructor / TA (grades, extensions, enrolment) |
| `out_of_scope` | Decline with a reason (off-topic, "do my homework", prompt injection) |

Stack: TypeScript, Hono, zod. Decision model: **Laya** (free, open source, self-hosted, speaks the same
`/v1/systemone` protocol as TypeSafe Jev). Jev still works with `DECISION_PROVIDER=jev` and an API key.

## 1. Start Laya (separate terminal, keep it open)

Needs Python 3.10+. The first start downloads the model checkpoints from Hugging Face (roughly 1 to 2 GB).

```powershell
py -m venv laya-env
.\laya-env\Scripts\Activate.ps1
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install "laya[serve]"
$env:LAYA_MODELS="english,multilingual"; $env:PYTHONUTF8="1"; laya-serve
```

Wait until it says it is listening on port 8000.

## 2. Run the API (Windows PowerShell)

Requires Node.js 22+. If `npm` is blocked by the execution policy, use `npm.cmd`.

```powershell
npm install
copy .env.example .env
npm test                     # 14 offline tests: validation + every fallback path (Laya not needed)
npm run dev                  # API on http://localhost:3000/api/triage
```

Send a request (Git Bash / curl):

```bash
curl -X POST http://localhost:3000/api/triage \
  -H "Content-Type: application/json" \
  -d '{"question":"For A6, what should the PDF file be named?"}'
```

## Evidence runs

```powershell
npm run cases                         # real model run of scripts/cases.json -> evidence/run-laya-*.md/json
npm run cases -- --rules-only         # keyword rules alone, for comparison
$env:SIMULATE_FAILURE="error";  npm run cases   # model "down" -> every answer must come from the fallback
$env:SIMULATE_FAILURE="invalid"; npm run cases  # model returns a label outside the schema
$env:SIMULATE_FAILURE="lowconf"; npm run cases  # model confidence 0.41 < 0.6
Remove-Item Env:SIMULATE_FAILURE
```

Real outage demo: stop `laya-serve` (Ctrl+C) and send the curl request again. The API still answers 200 with `"source": "fallback"`.

## A7 (Week 9): evaluation and one improvement

The A6 submission is tagged `a6-submission`. Week 9 work is on the `week09` branch.

The single improvement is **grounding context**: `src/grounding.ts` picks up to 2 records from
`knowledge/course-kb.json` (8 records) by keyword match and sends them to the model as `state.courseContext`.
Nothing else changed (same criteria, same threshold 0.6, same fallback). `GROUNDING=off` sends exactly the A6 request.

```powershell
# laya-serve must be running (see step 1)
$env:GROUNDING="off"; npm run eval    # baseline  -> evidence/eval-baseline-*.md/json
$env:GROUNDING="on";  npm run eval    # improved  -> evidence/eval-grounded-*.md/json
```

`eval-cases.json` holds the 10 cases (3 normal, 3 edge, 2 fallback, 2 difficult) with expected results.
Each run sends 3 warm-up requests first (not measured), then runs all 10 cases 5 times (`REPEATS`),
and reports accuracy, p50/p95 latency over the 50 requests, and cost.

## Files

| Path | What it is |
|---|---|
| `src/schema.ts` | Input/output contracts (zod), categories, confidence threshold |
| `src/model.ts` | Decision configuration (`choice` question + criteria), Laya and Jev clients |
| `src/triage.ts` | model -> validate -> threshold -> fallback |
| `src/fallback.ts` | Deterministic keyword rules |
| `src/app.ts` / `src/server.ts` | Hono REST endpoint |
| `scripts/cases.json` | 8 A6 test inputs with expected decisions |
| `eval-cases.json` / `scripts/eval.ts` | A7 evaluation set and runner |
| `knowledge/course-kb.json` / `src/grounding.ts` | A7 knowledge records and keyword retrieval |
| `test/triage.test.ts` | Offline tests (uses a fake laya-serve) |
| `evidence/` | Saved outputs of every run |
