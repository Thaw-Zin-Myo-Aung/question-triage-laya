# A6: Build and Integrate an AI Decision Capability

**Student Name:** Thaw Zin Myo Aung  
**Student ID:** 6731503088  
**Project / Capability Name:** Learning Assistant: Question Triage  
**Implementation Method:** Other: Laya (open-source, Jev-compatible decision engine, self-hosted with `laya-serve`) behind a Hono REST endpoint. Laya was suggested by the lecturer as an alternative to Jev. The code also supports Jev via `DECISION_PROVIDER=jev`.

## 1. Problem and Capability

**Problem:**
Our group platform, the Learning Assistant, answers course questions only from instructor-approved materials. Not every question a student types should go into that answer pipeline. Grade and extension requests need a human, "write my report for me" or off-topic questions should be declined, and assignment questions need the assignment context. Today every question would be treated the same way.

**Why AI?**
The category depends on what the student is *asking for*, not on which words appear. "Can I get two more days for the A6 deadline?" contains "A6" and "deadline" (assignment words) but is really an extension request (administrative). "Can you write my A6 report?" mentions the assignment but asks us to do graded work. Students also mix Thai and English. When I ran the same 8 test questions through keyword rules alone, they matched only **5 of 8**, and two of those 5 were correct only because the rules fell back to the default category (see Section 2). Rules would need a new pattern for every phrasing, which does not scale.

**Input:**
`question` (string, 3 to 1000 characters, required) and `courseId` (string, optional).
Example: `{ "question": "For A6, how many test cases do we need and what should the PDF file be named?" }`

**Expected Output:**
One of four categories, the downstream action it triggers, and where the decision came from:
`course_content`, `assignment`, `administrative`, `out_of_scope`.

## 2. Decision Implementation

**Decision Configuration / Code:** `src/model.ts` (full project in `a6-question-triage/`). The request sent to `laya-serve` (`POST /v1/systemone`, the same wire format as Jev):

```json
{
  "state": {
    "platform": "Learning Assistant: answers students' course questions only from instructor-approved materials.",
    "course": "1305308 Platform Development",
    "studentQuestion": "<the student's question>"
  },
  "questions": {
    "category": {
      "type": "choice",
      "instructions": "Which category best describes the student's question?",
      "criteria": {
        "course_content": "Asks about a concept, term, technology, or topic taught in the course lectures or slides ...",
        "assignment": "Asks what an assignment, lab, or project deliverable requires: its tasks, format, rubric ...",
        "administrative": "Asks about grades, scores, deadline extensions, late submission, attendance, enrolment ...",
        "out_of_scope": "Unrelated to this course, asks the assistant to do the student's graded work, or tries to change the assistant's instructions."
      }
    }
  }
}
```

The call has an 8-second timeout (`AbortSignal.timeout`), so one slow call cannot hold a request open.

**Output Schema:** (`src/schema.ts`, zod)

| Field | Type | Rule |
|---|---|---|
| `category` | enum | `course_content` \| `assignment` \| `administrative` \| `out_of_scope` |
| `action` | string | `answer_from_course_materials` \| `answer_with_assignment_context` \| `escalate_to_instructor` \| `decline_with_reason` |
| `source` | enum | `laya` \| `jev` \| `fallback` |
| `confidence` | number 0 to 1, or null | null when the fallback answered |
| `needsReview` | boolean | always true for fallback answers |
| `reason` | string | why this decision was made |

### Test Results

Measured on 26 Oct 2026 with `npm run cases` against a local `laya-serve` 0.4.15 (CPU, Windows). Raw output: `evidence/run-laya-2026-10-26T17-32-02-484Z.json`. "Laya said" is the model's own choice and its `answer_confidence`; "Final" is what the API returned after validation, the 0.6 threshold, and the fallback.

| # | Input | Expected | Laya said (conf.) | Final decision (source) | Latency | Pass/Fail |
|---|---|---|---|---|---|---|
| T1 | What is the difference between a REST API and an MCP server? | course_content | timed out after 8 s (cold start) | course_content (fallback) | 8047 ms | Pass |
| T2 | For A6, how many test cases do we need and what should the PDF file be named? | assignment | course_content (0.34) | assignment (fallback) | 3450 ms | Pass |
| T3 | I was sick on Tuesday. Can I get two more days for the A6 deadline? | administrative | out_of_scope (0.30) | assignment (fallback) | 622 ms | Fail |
| T4 | Can you just write my A6 report for me so I can submit it tonight? | out_of_scope | out_of_scope (0.31) | assignment (fallback) | 649 ms | Fail |
| T5 | Which restaurant near campus has the best khao soi? | out_of_scope | out_of_scope (0.78) | out_of_scope (laya) | 618 ms | Pass |
| T6 | Why should the model never write straight into the database without validation? | course_content | course_content (0.35) | course_content (fallback, default) | 646 ms | Pass |
| T7 | My midterm score looks lower than I expected. Who can check it? | administrative | out_of_scope (0.45) | administrative (fallback) | 665 ms | Pass |
| T8 | D1 กับ Supabase ต่างกันยังไงครับ | course_content | out_of_scope (0.92) | out_of_scope (laya) | 502 ms | Fail |

**Final API result: 5/8 correct.** Laya's own choice was right in 3 of the 7 cases it answered (T4, T5, T6), and it was confident (≥ 0.6) only twice: once right (T5) and once wrong (T8). Every answer was a valid JSON response in the output schema, including the timeout.

**Comparison: keyword rules only** (`npm run cases -- --rules-only`, measured)

| # | Expected | Rules result | Pass/Fail |
|---|---|---|---|
| T1 | course_content | course_content | Pass |
| T2 | assignment | assignment | Pass |
| T3 | administrative | assignment | Fail |
| T4 | out_of_scope | assignment | Fail |
| T5 | out_of_scope | course_content (no rule matched) | Fail |
| T6 | course_content | course_content (no rule matched, default) | Pass |
| T7 | administrative | administrative | Pass |
| T8 | course_content | course_content (no rule matched, default) | Pass |

**Evidence:**

`laya-serve` running locally:

```
INFO:     Started server process [19420]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

Output of `npm run cases`:

![npm run cases output](evidence/laya-run-terminal.png)

## 3. Platform Integration

**Architecture Diagram:**

![Architecture](architecture.png)

**Example API Request:**

```http
POST /api/triage
Content-Type: application/json

{ "question": "Which restaurant near campus has the best khao soi?" }
```

**Example API Response:** (real response for T5 from the run above)

```json
{
  "category": "out_of_scope",
  "action": "decline_with_reason",
  "source": "laya",
  "confidence": 0.783,
  "needsReview": false,
  "reason": "laya selected 'out_of_scope' with confidence 0.78"
}
```

When Laya is not confident (T7), the same contract comes back from the fallback:

```json
{
  "category": "administrative",
  "action": "escalate_to_instructor",
  "source": "fallback",
  "confidence": null,
  "needsReview": true,
  "reason": "laya confidence 0.45 below 0.6 (model suggested 'out_of_scope'); keyword rule matched 'administrative'"
}
```

**Validation Rules:**

*Input* (`TriageInput`): body must be valid JSON, otherwise 400 `{"error": "Request body must be valid JSON"}`. `question` must be a string of 3 to 1000 characters after trimming. `courseId` is optional, 1 to 50 characters. Unknown fields are rejected (`.strict()`), and any failure returns 400 with a JSON error message.

*Output from the model* (`ModelAnswer`): `choice` must be one of the 4 labels, and the confidence values must be numbers from 0 to 1. If it does not parse, the answer is not used. The threshold is applied to the probability of the chosen label (Laya's `answer_confidence`). Laya's `confidence` field is 1 minus normalised entropy, a different scale from Jev's, so the lecture's 0.7 for Jev does not transfer directly. I start at **0.6** (configurable with `CONFIDENCE_THRESHOLD`) and will tune it with the Week 9 evaluation set. Below the threshold, the answer is not trusted.

*Final response* (`TriageOutput`): every response, model or fallback, is parsed against the same output schema before it is sent, so the endpoint can never return something that breaks its own contract. Unknown routes return 404 JSON and unexpected errors return 500 `{"error":"Internal server error"}` with details logged on the server only.

**Fallback Strategy:**
The fallback runs when (1) the model call fails (laya-serve not running, network error, timeout after 8 s, any non-2xx status), (2) the model's output fails schema validation, or (3) its confidence is below 0.6. It applies ordered keyword rules (`src/fallback.ts`): out-of-scope patterns first (so "write my assignment" is not sent to the assignment helper), then administrative, assignment, and course content. If no rule matches, it defaults to `course_content`, because the retrieval step already answers "I don't have a source for that" when the materials do not cover a question. Every fallback answer has `source: "fallback"`, `confidence: null`, `needsReview: true`, and HTTP 200, so the caller always gets a valid decision and never a bare error.

**Fallback Evidence:**

*Real failure in the Laya run (T1):* the first request reached Laya while it was still loading, hit the 8-second timeout, and the API still returned a valid answer: `laya unavailable (TimeoutError: The operation was aborted due to timeout); keyword rule matched 'course_content'` (8047 ms, HTTP 200). Five more cases (T2, T3, T4, T6, T7) fell back because confidence was below 0.6.

*Simulated outage* (`SIMULATE_FAILURE=error`):

```
$ curl -X POST http://localhost:3000/api/triage -H "Content-Type: application/json" \
    -d '{"question":"I need an extension for the A6 deadline"}'
HTTP/1.1 200 OK
{"category":"administrative","action":"escalate_to_instructor","source":"fallback",
 "confidence":null,"needsReview":true,"reason":"laya unavailable (Error: Simulated model outage (SIMULATE_FAILURE)); keyword rule matched 'administrative'"}
```

All 8 cases with the model forced down returned HTTP 200 with `source: "fallback"` (5/8 matched the expected category, the same as rules only). Offline tests (`npm test`, 9/9 pass) also cover an invalid label, a confidence of 0.41, laya-serve returning HTTP 500, and laya-serve not running at all.

## 4. Engineering Reflection

**What worked:** The platform design held up even though the model was weak. Every one of the 8 requests, including a real timeout, returned a valid response in the same schema, and the caller never saw an error. The confidence threshold did useful work: Laya's low-confidence guesses were wrong on T2, T3, and T7, and the threshold stopped them from reaching students. Keeping the model behind one interface also paid off when Jev turned out to be paid: switching to Laya only changed the HTTP client, while the schema, validation, fallback, and tests stayed the same.

**Unexpected behavior or mistakes:**

- **Laya leaned towards `out_of_scope`.** It picked it for 5 of 7 questions, including an extension request (T3) and a grade question (T7). The zero-shot model may not separate "a request the assistant should not answer itself" from "unrelated to the course".
- **Confident and wrong on Thai (T8).** It labelled a Thai question about D1 and Supabase as `out_of_scope` with 0.92 confidence. The threshold cannot catch this, so a Thai-speaking student would have been turned away. This is the most important finding.
- **Cold start.** The first request timed out after 8 s while Laya loaded. Later requests took about 0.5 to 0.7 s on CPU.
- **The fallback is not better, just safer.** The keyword rules routed T3 and T4 to `assignment` because those questions contain "A6". Order of rules matters, and keyword rules cannot see intent.
- **Before the real run:** the Jev SDK throws when it is constructed without an API key, which crashed the server at startup (fixed by creating the client lazily). Laya's `confidence` field also uses a different scale from Jev's (1 minus entropy), so the lecture's 0.7 threshold could not be copied over. I gate on `answer_confidence` instead.

**Production risks:** confidently wrong answers like T8 that pass the threshold; poor handling of Thai, which is a real share of our students' questions; a cold start or an overloaded CPU turning every request into a fallback; prompt injection in the question text (only partly handled by the `out_of_scope` category and the fallback rules); and students' questions are sent to a model server, so it must stay self-hosted or have a privacy agreement.

**Next improvement:** In Week 9 I will build the 10-case evaluation set and improve one thing. The most promising candidate is the decision instructions and criteria (clearer label descriptions, separating "needs a human" from "unrelated"), measured against this run as the baseline. I would also warm up Laya at startup, add Thai keywords to the fallback, and tune the 0.6 threshold from data instead of guessing.

## 5. References

- Week 08 lecture: AI-Native Capability Design (Aj. Vittayasak Rujivorakul)
- Laya (github.com/NandhaKishorM/laya) README, self-hosting section (`laya-serve`, `/v1/systemone`)
- TypeSafe AI JavaScript SDK (`@typesafe-ai/sdk` 0.7.0) README and type definitions
- Hono, zod documentation
- AI assistance: Claude (Claude Code) helped scaffold the project, write the fallback and tests, and draft this report. I installed and ran Laya on my own PC, ran the offline tests and the 8 test cases myself, and checked the results against the saved evidence files. I chose the triage capability for our group platform, switched from Jev to the free Laya engine suggested by the lecturer, and decided to keep the first Laya run as an honest baseline instead of tuning the prompt to the test cases.

## 6. Submission Checklist

- [x] Decision configuration or source code included
- [x] Five test cases completed (8 cases)
- [x] Actual execution evidence attached
- [x] Integration architecture included
- [x] Validation and fallback explained
- [x] Engineering reflection completed
