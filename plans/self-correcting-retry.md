# Self-Correcting Retry — Plan

## Context

In the triage pipeline (`plans/startup-triage-pipeline.md`), LLM subagent nodes (team/product/market/
risk analysis, recommendation) can fail two ways: **crash** (API error, timeout, rate limit) or
**bad output** (invalid schema, missing citations, invalid verdict). Requirement: when a subagent
fails, capture the error message, spin the subagent up again with that error + its prior output fed
back in, so the retry corrects the specific mistake — rather than blindly repeating or hard-failing.

Eve Workflows already retry a node on crash, but a plain retry re-sends the *same* prompt and re-hits
the *same* mistake. The value here is the **corrective** loop: the error becomes part of the next
prompt. This is a reflexion / self-correction pattern, kept to one bounded wrapper.

## Core: `withCorrectiveRetry`

One wrapper around any subagent call. No new pattern — a higher-order function.

```
withCorrectiveRetry(fn, {
  maxAttempts = 3,
  validate,          // (output) => { ok: true } | { ok: false, reason: string }
  onExhausted,       // (history) => fallback value  (default: return { degraded: true })
})
```

### Loop

```
attempts = []
for n in 1..maxAttempts:
  try:
    output = await fn(prompt)                 // prompt is corrective from attempt 2+
    v = validate(output)
    if v.ok: return output                    // success
    failure = { kind: 'validation', msg: v.reason, output }
  catch err:
    failure = { kind: classify(err), msg: err.message, output: null }

  attempts.push(failure)

  if failure.kind == 'terminal': break        // don't waste attempts on unrecoverable
  if failure.kind == 'transient':
    await backoff(n)                           // exp backoff + jitter, same prompt
    continue
  // validation OR usable error → correct the prompt for next attempt
  prompt = correctivePrompt(originalPrompt, failure, n)

return onExhausted(attempts)                   // mark node degraded, pipeline continues
```

### Failure classification (`classify`)

- **transient** — HTTP 429/5xx, network timeout, gateway error → backoff, retry **same** prompt.
- **validation** — output failed `validate` (schema, citations, verdict) → **corrective** prompt.
- **terminal** — 401/403 auth, malformed request, quota exhausted → stop immediately, don't burn attempts.
- Any thrown error with a usable message but unknown class → treat as validation (corrective retry).

### Corrective prompt (`correctivePrompt`)

Original prompt + appended block:

```
Your previous attempt (#{n}) failed.
Reason: {failure.msg}
Your previous output was:
{failure.output ?? "(none — the call errored before returning)"}
Correct exactly these issues and return valid output. Do not repeat the same mistake.
```

Keep prior output truncated to a sane cap (e.g. 4k chars) so the retry prompt doesn't blow context.

## Validators per node (the `validate` fns)

- **Analysis dimension**: output parses to `DimensionResult`; every `Claim` has a non-empty `sourceUrl`;
  `features` has the required keys for that dimension.
- **Recommendation**: `verdict ∈ {Pass, Watch, Meeting}`; `counterPoints.length` between 3 and 4;
  `rationale` non-empty.

Validators are the same rules the pipeline needs anyway — reuse them, don't write retry-only checks.

## Bounds & degradation

- `maxAttempts = 3` default (1 initial + 2 corrective). Configurable per node.
- On exhaustion: node returns `{ degraded: true, attempts }`. **Pipeline continues** — a degraded
  market analysis still yields a memo (memo marks that section low-confidence). One bad dimension
  never kills the run.
- Every attempt's `{kind, msg}` is recorded on the node result for observability + future eval.

## Interaction with Eve

- Wrap the subagent call *inside* the Workflow node, so Eve's checkpoint still sees the node as one
  unit — retries never redo upstream nodes.
- If a node exhausts and returns degraded, that's a **successful node completion** (not a crash) — the
  Workflow proceeds. Reserve Eve's own node-level retry for infra crashes of the wrapper itself.
- Analysis/recommendation are pure reads → retries are side-effect free. (If a future node writes,
  make it idempotent by domain key before wrapping.)

## Files

```
retry/
  index.ts        withCorrectiveRetry, classify, correctivePrompt, backoff
  validators.ts   per-node validate fns (reuse pipeline schema rules)
retry/index.test.ts  see verification below
```

Then wrap each subagent call site in `workflows/triage.ts` with `withCorrectiveRetry(..., { validate })`.

## Verification

1. **Corrective path**: stub a subagent that returns a claim with empty `sourceUrl` on attempt 1, valid
   on attempt 2. Assert: attempt 2's prompt contains the error text + prior output; final output valid;
   2 attempts recorded.
2. **Transient path**: stub throws 503 twice then succeeds. Assert: same prompt each time (no corrective
   block), backoff called, succeeds on attempt 3.
3. **Terminal path**: stub throws 401. Assert: stops after 1 attempt, no retry, returns degraded.
4. **Exhaustion**: stub always returns invalid. Assert: exactly `maxAttempts` attempts, returns
   `{ degraded: true }`, pipeline continues to produce a memo with that section flagged low-confidence.
5. **Context cap**: oversized prior output is truncated in the corrective prompt.
