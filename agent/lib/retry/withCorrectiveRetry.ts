/**
 * Self-correcting retry. Wraps a fallible attempt (typically an LLM call). On
 * failure it classifies the cause and reacts:
 *   - transient (429/5xx/timeout): back off and retry the SAME prompt.
 *   - validation / usable error: retry with a corrective note carrying the
 *     error + the previous output, so the next attempt fixes the exact mistake.
 *   - terminal (401/403): stop immediately, don't burn attempts.
 * Bounded by maxAttempts; on exhaustion `onExhausted` produces a fallback (e.g.
 * a degraded result) so one failing node never kills the whole pipeline.
 *
 * See plans/self-correcting-retry.md.
 */
import { createLogger } from "../logger.ts";

const log = createLogger("retry");

export type FailureKind = "transient" | "terminal" | "validation";

export interface RetryAttemptRecord {
  kind: FailureKind;
  msg: string;
}

export type Validation = { ok: true } | { ok: false; reason: string };

export interface CorrectiveRetryOptions<T> {
  /** Total attempts (1 initial + N corrective). Default 3. */
  maxAttempts?: number;
  /** Validate a successful return; a failure triggers a corrective retry. */
  validate?: (out: T) => Validation;
  /** Classify a thrown error. Defaults to message-based heuristics. */
  classify?: (err: unknown) => FailureKind;
  /** Produce a fallback after exhaustion. Default: throw. */
  onExhausted?: (history: RetryAttemptRecord[]) => T | Promise<T>;
  /** Injectable delay (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  label?: string;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function classifyError(err: unknown): FailureKind {
  const m = String((err as { message?: string })?.message ?? err).toLowerCase();
  if (/\b(429|500|502|503|504)\b|timeout|etimedout|econnreset|overloaded|rate.?limit/.test(m)) {
    return "transient";
  }
  if (/\b(401|403)\b|unauthorized|forbidden|invalid api key/.test(m)) return "terminal";
  return "validation";
}

function truncate(s: string, max = 4000): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export function correctionNote(reason: string, attemptNo: number, prevOutput: unknown): string {
  const prev =
    prevOutput === undefined || prevOutput === null
      ? "(the call errored before returning output)"
      : truncate(JSON.stringify(prevOutput));
  return `Your previous attempt (#${attemptNo}) failed.
Reason: ${reason}
Your previous output was:
${prev}
Correct exactly these issues and return valid output. Do not repeat the same mistake.`;
}

export async function withCorrectiveRetry<T>(
  attempt: (correction: string | null, attemptNo: number) => Promise<T>,
  opts: CorrectiveRetryOptions<T> = {},
): Promise<T> {
  const max = opts.maxAttempts ?? 3;
  const classify = opts.classify ?? classifyError;
  const sleep = opts.sleep ?? realSleep;
  const label = opts.label ?? "attempt";
  const history: RetryAttemptRecord[] = [];
  let correction: string | null = null;

  for (let n = 1; n <= max; n++) {
    try {
      const out = await attempt(correction, n);
      const v = opts.validate ? opts.validate(out) : { ok: true as const };
      if (v.ok) return out;

      history.push({ kind: "validation", msg: v.reason });
      log.warn("validation failed", { label, attempt: n, reason: v.reason });
      if (n < max) correction = correctionNote(v.reason, n, out);
    } catch (err) {
      const kind = classify(err);
      const msg = String((err as { message?: string })?.message ?? err);
      history.push({ kind, msg });
      log.warn("attempt threw", { label, attempt: n, kind, msg });

      if (kind === "terminal") break;
      if (n >= max) break;
      if (kind === "transient") {
        await sleep(2 ** (n - 1) * 200);
        continue; // same prompt
      }
      correction = correctionNote(msg, n, null);
    }
  }

  if (opts.onExhausted) {
    log.warn("exhausted, using fallback", { label, attempts: history.length });
    return opts.onExhausted(history);
  }
  throw new Error(`${label}: retry exhausted after ${history.length} attempts (${history.map((h) => h.kind).join(", ")})`);
}
