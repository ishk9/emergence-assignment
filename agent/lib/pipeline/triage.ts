/**
 * The triage pipeline (deterministic DAG). Wires the nodes:
 *   source(HN+YC) OR direct URL candidates -> normalize/dedup -> enrich ->
 *   [analyze (one research pass -> 4 dimensions) -> score -> recommend -> memo]
 *   per candidate -> sorted results.
 *
 * LLM steps degrade on failure so one bad candidate never sinks the run. All
 * external steps are injectable for deterministic testing.
 */
import type { Candidate, DimensionResult, Recommendation, Score, Source } from "../types.ts";
import { createLogger } from "../logger.ts";
import { HackerNewsSource } from "../sources/hackernews.ts";
import { YCombinatorSource } from "../sources/ycombinator.ts";
import { mergeCandidates } from "../normalize.ts";
import { enrichAll } from "../enrich/index.ts";
import { analyzeCandidate } from "../analysis/analyze.ts";
import { recommend, type RunRecommend } from "../recommend/recommend.ts";
import { WeightedScorer, type Scorer } from "../scoring/index.ts";
import { BALANCED, type ThesisProfile } from "../scoring/profiles.ts";
import { renderMemo } from "../memo/render.ts";
import { withCorrectiveRetry } from "../retry/withCorrectiveRetry.ts";

const log = createLogger("pipeline");

export interface TriageResult {
  candidate: Candidate;
  analysis: DimensionResult[];
  score: Score;
  recommendation: Recommendation;
  memo: string;
}

export interface TriageDeps {
  sources?: Source[];
  /** Analyze override for tests (defaults to the real analyzeCandidate). */
  analyze?: (candidate: Candidate) => Promise<DimensionResult[]>;
  recommendRun?: RunRecommend;
  scorer?: Scorer;
  /** Per-partner thesis profile driving the score weights + verdict framing. */
  profile?: ThesisProfile;
  /** Skip sourcing and triage these candidates directly (e.g. pasted URLs). */
  candidates?: Candidate[];
  /** Candidates after dedup (target 10-20). */
  limit?: number;
  /** Per-source fetch cap. */
  perSourceLimit?: number;
  /** Candidates analyzed concurrently. */
  concurrency?: number;
  nowMs?: number;
  nowIso?: string;
  /** Injectable delay for retry backoff (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
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

async function recommendWithRetry(
  candidate: Candidate,
  analysis: DimensionResult[],
  score: Score,
  profile: ThesisProfile,
  run: RunRecommend | undefined,
  sleep?: (ms: number) => Promise<void>,
): Promise<Recommendation> {
  return withCorrectiveRetry<Recommendation>(
    (correction) => recommend(candidate, analysis, score, profile, run, correction),
    {
      label: `recommend:${candidate.domain}`,
      maxAttempts: 2,
      validate: (r) =>
        r.counterPoints.length >= 3 ? { ok: true } : { ok: false, reason: "need 3-4 counter-points" },
      onExhausted: () => fallbackRecommendation(score),
      sleep,
    },
  );
}

const DIMENSIONS: DimensionResult["dimension"][] = ["team", "product", "market", "risk"];

/** Neutral 4-dimension analysis when analysis throws outright. */
function degradedAnalysis(): DimensionResult[] {
  return DIMENSIONS.map((dimension) => ({
    dimension,
    findings: "Analysis unavailable.",
    claims: [],
    features: {},
  }));
}

/** Analyze -> score -> recommend -> memo for one candidate. */
async function triageOne(candidate: Candidate, deps: TriageDeps): Promise<TriageResult> {
  const nowMs = deps.nowMs ?? Date.now();
  const profile = deps.profile ?? BALANCED;
  const scorer = deps.scorer ?? new WeightedScorer(profile);
  const analyze = deps.analyze ?? ((c: Candidate) => analyzeCandidate(c, { sleep: deps.sleep }));

  let analysis: DimensionResult[];
  try {
    analysis = await analyze(candidate);
  } catch (err) {
    log.warn("analysis failed", { domain: candidate.domain, err: String(err) });
    analysis = degradedAnalysis();
  }
  const score = scorer.score(candidate, analysis, nowMs);
  const recommendation = await recommendWithRetry(candidate, analysis, score, profile, deps.recommendRun, deps.sleep);
  const memo = renderMemo({ candidate, results: analysis, score, recommendation });
  return { candidate, analysis, score, recommendation, memo };
}

/**
 * Run the full triage pipeline. Provide a `query` to source from HN+YC, or pass
 * `deps.candidates` (e.g. from pasted URLs) to triage those directly.
 */
export async function runTriage(query: string, deps: TriageDeps = {}): Promise<TriageResult[]> {
  const limit = deps.limit ?? 15;
  const concurrency = deps.concurrency ?? 4;
  const nowIso = deps.nowIso ?? new Date().toISOString();

  let base: Candidate[];
  if (deps.candidates) {
    base = deps.candidates.slice(0, limit);
    log.info("triage start (direct candidates)", { count: base.length, limit });
  } else {
    const sources = deps.sources ?? [new HackerNewsSource(), new YCombinatorSource()];
    const perSourceLimit = deps.perSourceLimit ?? 15;
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
    base = mergeCandidates(fetched.flat(), { limit });
  }

  const enriched = await enrichAll(base, nowIso);
  const results = await mapLimit(enriched, concurrency, (c) => triageOne(c, deps));
  results.sort((a, b) => b.score.total - a.score.total);

  log.info("triage done", { query, candidates: results.length });
  return results;
}
