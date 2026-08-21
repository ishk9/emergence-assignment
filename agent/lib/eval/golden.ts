/**
 * SCAFFOLD — triage quality eval. `precisionAtK` is a working metric (used to
 * answer "is my top-K actually the top K?"); the golden set is a placeholder to
 * be populated from partner feedback. Not run in the pipeline this round.
 * See plans/startup-triage-pipeline.md "Deferred".
 */

/** A domain the partner considers a genuine top candidate for a query. */
export interface GoldenLabel {
  query: string;
  domain: string;
}

/**
 * Precision@K: of the top-K ranked domains, what fraction are in the relevant
 * (golden) set. Pure and deterministic.
 */
export function precisionAtK(rankedDomains: string[], relevant: Set<string>, k: number): number {
  const topK = rankedDomains.slice(0, k);
  if (topK.length === 0) return 0;
  const hits = topK.filter((d) => relevant.has(d)).length;
  return hits / topK.length;
}

/** Build the relevant-domain set for a query from golden labels. */
export function relevantFor(query: string, golden: GoldenLabel[]): Set<string> {
  return new Set(golden.filter((g) => g.query === query).map((g) => g.domain));
}

/** SCAFFOLD: populate from partner feedback (see feedback/schema.ts). */
export const GOLDEN: GoldenLabel[] = [];
