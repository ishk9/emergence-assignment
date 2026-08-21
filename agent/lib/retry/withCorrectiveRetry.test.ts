import test from "node:test";
import assert from "node:assert/strict";
import { classifyError, correctionNote, withCorrectiveRetry } from "./withCorrectiveRetry.ts";

const noSleep = async () => {};

test("classifyError buckets transient / terminal / validation", () => {
  assert.equal(classifyError(new Error("HTTP 503 overloaded")), "transient");
  assert.equal(classifyError(new Error("request timeout")), "transient");
  assert.equal(classifyError(new Error("401 Unauthorized")), "terminal");
  assert.equal(classifyError(new Error("schema mismatch")), "validation");
});

test("corrective path injects the error + prior output into the next attempt", async () => {
  const corrections: (string | null)[] = [];
  const out = await withCorrectiveRetry(
    async (correction, n) => {
      corrections.push(correction);
      return n === 1 ? { bad: true } : { bad: false };
    },
    {
      validate: (o: { bad: boolean }) => (o.bad ? { ok: false, reason: "was bad" } : { ok: true }),
      sleep: noSleep,
    },
  );
  assert.deepEqual(out, { bad: false });
  assert.equal(corrections[0], null);
  assert.match(corrections[1]!, /Reason: was bad/);
  assert.match(corrections[1]!, /"bad":true/); // prior output echoed
});

test("transient errors retry the SAME prompt (no correction) with backoff", async () => {
  const corrections: (string | null)[] = [];
  let calls = 0;
  const out = await withCorrectiveRetry(
    async (correction) => {
      corrections.push(correction);
      if (++calls < 3) throw new Error("HTTP 503");
      return "ok";
    },
    { sleep: noSleep },
  );
  assert.equal(out, "ok");
  assert.deepEqual(corrections, [null, null, null]); // never corrected
});

test("terminal errors stop immediately", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withCorrectiveRetry(
        async () => {
          calls++;
          throw new Error("403 Forbidden");
        },
        { sleep: noSleep },
      ),
    /retry exhausted/,
  );
  assert.equal(calls, 1);
});

test("exhaustion invokes onExhausted with the failure history", async () => {
  const out = await withCorrectiveRetry<{ ok: false } | { degraded: true; attempts: number }>(
    async () => ({ ok: false }),
    {
      maxAttempts: 2,
      validate: () => ({ ok: false, reason: "always bad" }),
      onExhausted: (history) => ({ degraded: true, attempts: history.length }),
      sleep: noSleep,
    },
  );
  assert.deepEqual(out, { degraded: true, attempts: 2 });
});

test("succeeds on first try without retrying", async () => {
  let calls = 0;
  const out = await withCorrectiveRetry(async () => {
    calls++;
    return 42;
  });
  assert.equal(out, 42);
  assert.equal(calls, 1);
});

test("correctionNote handles a null prior output", () => {
  const note = correctionNote("boom", 1, null);
  assert.match(note, /errored before returning output/);
});
