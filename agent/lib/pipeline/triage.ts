/**
 * The triage pipeline (deterministic DAG). Wires the nodes:
 *   source(HN+YC) -> normalize/dedup -> enrich -> [analyze x4 -> score ->
 *   recommend -> memo] per candidate -> sorted results.
 *
 * LLM nodes (analysis, recommendation) run under self-correcting retry and
 * degrade on exhaustion, so one failing candidate/dimension never kills the
 * run. All external steps are injectable for deterministic testing without a
 * model or network.
 */
import type { Candidate, DimensionResult, Dimension, Recommendation, Score, Source } from "../types.ts";
import { createLogger } from "../logger.ts";
import { HackerNewsSource } from "../sources/hackernews.ts";
import { YCombinatorSource } from "../sources/ycombinator.ts";
import { mergeCandidates } from "../normalize.ts";
import { enrichAll } from "../enrich/index.ts";
import { analyzeDimension, type RunAnalysis } from "../analysis/analyze.ts";
import { recommend, type RunRecommend } from "../recommend/recommend.ts";
import { defaultScorer, type Scorer } from "../scoring/index.ts";
import { renderMemo } from "../memo/render.ts";
import { withCorrectiveRetry } from "../retry/withCorrectiveRetry.ts";

const log = createLogger("pipeline");

const DIMENSIONS: readonly Dimension[] = ["team", "product", "market", "risk"];

export interface TriageResult {
  candidate: Candidate;
  analysis: DimensionResult[];
  score: Score;
  recommendation: Recommendation;
  memo: string;
}

export interface TriageDeps {
  sources?: Source[];
  analysisRun?: RunAnalysis;
  recommendRun?: RunRecommend;
  scorer?: Scorer;
  /** Candidates after dedup (target 10-20). */
  limit?: number;
  /** Per-source fetch cap. */
  perSourceLimit?: number;
  /** Candidates analyzed concurrently (each fans out 4 dimension calls). */
  concurrency?: number;
  nowMs?: number;
  nowIso?: string;
  /** Injectable delay for retry backoff (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

function degradedDimension(dimension: Dimension): DimensionResult {
  return { dimension, findings: "Analysis unavailable (retries exhausted).", claims: [], features: {} };
}

function fallbackRecommendation(score: Score): Recommendation {
  const verdict = score.total >= 70 ? "Meeting" : score.total >= 45 ? "Watch" : "Pass";
  return {
    verdict,
    rationale: "Score-based fallback: the LLM recommendation step failed after retries.",
    counterPoints: [
      "This verdict is a score-only fallback, not a grounded synthesis.",
      "Re-run once the model backend is reachable for a real rationale.",
      "Treat this recommendation with low confidence.",
    ],
  };
}

/** Bounded-concurrency map. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function analyzeWithRetry(
  candidate: Candidate,
  dimension: Dimension,
  run: RunAnalysis | undefined,
  sleep?: (ms: number) => Promise<void>,
): Promise<DimensionResult> {
  return withCorrectiveRetry<DimensionResult>(
    (correction) => analyzeDimension(candidate, dimension, run, correction),
    {
      label: `analyze:${candidate.domain}:${dimension}`,
      validate: (r) => (r.findings.trim() ? { ok: true } : { ok: false, reason: "findings were empty" }),
      onExhausted: () => degradedDimension(dimension),
      sleep,
    },
  );
}

async function recommendWithRetry(
  candidate: Candidate,
  analysis: DimensionResult[],
  score: Score,
  run: RunRecommend | undefined,
  sleep?: (ms: number) => Promise<void>,
): Promise<Recommendation> {
  return withCorrectiveRetry<Recommendation>(
    (correction) => recommend(candidate, analysis, score, run, correction),
    {
      label: `recommend:${candidate.domain}`,
      validate: (r) =>
        r.counterPoints.length >= 3 ? { ok: true } : { ok: false, reason: "need 3-4 counter-points" },
      onExhausted: () => fallbackRecommendation(score),
      sleep,
    },
  );
}

/** Analyze -> score -> recommend -> memo for one candidate. */
async function triageOne(candidate: Candidate, deps: TriageDeps): Promise<TriageResult> {
  const nowMs = deps.nowMs ?? Date.now();
  const scorer = deps.scorer ?? defaultScorer;

  const analysis = await Promise.all(
    DIMENSIONS.map((d) => analyzeWithRetry(candidate, d, deps.analysisRun, deps.sleep)),
  );
  const score = scorer.score(candidate, analysis, nowMs);
  const recommendation = await recommendWithRetry(candidate, analysis, score, deps.recommendRun, deps.sleep);
  const memo = renderMemo({ candidate, results: analysis, score, recommendation });
  return { candidate, analysis, score, recommendation, memo };
}

/** Run the full triage pipeline for a query. */
export async function runTriage(query: string, deps: TriageDeps = {}): Promise<TriageResult[]> {
  const sources = deps.sources ?? [new HackerNewsSource(), new YCombinatorSource()];
  const perSourceLimit = deps.perSourceLimit ?? 15;
  const limit = deps.limit ?? 15;
  const concurrency = deps.concurrency ?? 4;
  const nowIso = deps.nowIso ?? new Date().toISOString();

  log.info("triage start", { query, sources: sources.map((s) => s.name), limit });

  // Source (parallel) -> a failing source doesn't sink the run.
  const fetched = await Promise.all(
    sources.map((s) =>
      s.fetch({ query, limit: perSourceLimit }).catch((err) => {
        log.warn("source failed", { source: s.name, err: String(err) });
        return [] as Candidate[];
      }),
    ),
  );

  const merged = mergeCandidates(fetched.flat(), { limit });
  const enriched = await enrichAll(merged, nowIso);

  const results = await mapLimit(enriched, concurrency, (c) => triageOne(c, deps));
  results.sort((a, b) => b.score.total - a.score.total);

  log.info("triage done", { query, candidates: results.length });
  return results;
}
