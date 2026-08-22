/**
 * Core data model + Adapter contract for the startup-triage pipeline.
 *
 * Zod schemas are the single source of truth; TypeScript types are inferred
 * from them. Schemas double as runtime validators — LLM analysis nodes emit
 * structured output that is parsed against these before entering the pipeline.
 *
 * Provenance is mandatory: every Claim carries a sourceUrl. See
 * plans/startup-triage-pipeline.md.
 */
import { z } from "zod";

/** Sources wired for v1. "url" = a candidate supplied directly by the user.
 *  Adding a real source = extend this + one new adapter. */
export const SourceName = z.enum(["hackernews", "ycombinator", "url"]);
export type SourceName = z.infer<typeof SourceName>;

/** A freshness/traction signal — the core triage signal. */
export const Signal = z.object({
  kind: z.enum(["launch", "funding", "hn_traction", "github_activity"]),
  /** Human-readable label, e.g. "312 points, 88 comments". */
  value: z.string(),
  /** Where the signal was observed. */
  url: z.url(),
  /** ISO-8601 timestamp of the signal. */
  at: z.iso.datetime(),
  /** Optional numeric magnitude (points, stars, $ raised) for scoring. */
  magnitude: z.number().optional(),
});
export type Signal = z.infer<typeof Signal>;

/** One source's reference to a candidate. Dedup merges these onto one domain. */
export const SourceRef = z.object({
  source: SourceName,
  url: z.url(),
  discoveredAt: z.iso.datetime(),
});
export type SourceRef = z.infer<typeof SourceRef>;

/** A sourced, deduped startup. `domain` is the canonical merge key. */
export const Candidate = z.object({
  /** Canonical key: registrable domain, lowercased (e.g. "acme.com"). */
  domain: z.string().min(1),
  name: z.string().min(1),
  website: z.url(),
  oneLiner: z.string(),
  sources: z.array(SourceRef).min(1),
  freshness: z.array(Signal),
});
export type Candidate = z.infer<typeof Candidate>;

/** Analysis dimensions. Scoring weights one subscore per dimension + freshness. */
export const Dimension = z.enum(["team", "product", "market", "risk"]);
export type Dimension = z.infer<typeof Dimension>;

/** A single cited assertion. No claim without a source. */
export const Claim = z.object({
  text: z.string().min(1),
  sourceUrl: z.url(),
  confidence: z.enum(["low", "med", "high"]),
});
export type Claim = z.infer<typeof Claim>;

/** Per-founder background, so the team memo covers every founder — not just the
 *  most-covered one (usually the CEO). Only populated on the team dimension. */
export const TeamMember = z.object({
  name: z.string().min(1),
  role: z.string(),
  /** Prior companies, education, notable projects, prior exits — in prose. */
  background: z.string(),
});
export type TeamMember = z.infer<typeof TeamMember>;

/**
 * Output of one analysis subagent. `features` are structured values the
 * (LLM-free) scorer consumes — enums-as-numbers, counts, magnitudes.
 */
export const DimensionResult = z.object({
  dimension: Dimension,
  findings: z.string(),
  claims: z.array(Claim),
  features: z.record(z.string(), z.union([z.number(), z.string()])),
  /** Per-founder bios (team dimension only). */
  members: z.array(TeamMember).optional(),
});
export type DimensionResult = z.infer<typeof DimensionResult>;

/** Deterministic, algorithmic score. Never produced by an LLM. */
export const Score = z.object({
  total: z.number().min(0).max(100),
  subscores: z.object({
    team: z.number(),
    product: z.number(),
    market: z.number(),
    risk: z.number(),
    freshness: z.number(),
  }),
  /** Which weight set produced this score (for auditability). */
  weightsVersion: z.string().min(1),
  /** Human-readable "why this score". */
  explanation: z.string(),
});
export type Score = z.infer<typeof Score>;

export const Verdict = z.enum(["Pass", "Watch", "Meeting"]);
export type Verdict = z.infer<typeof Verdict>;

/** Final call plus the counter-points that might change the partner's mind. */
export const Recommendation = z.object({
  verdict: Verdict,
  rationale: z.string().min(1),
  counterPoints: z.array(z.string().min(1)).min(3).max(4),
});
export type Recommendation = z.infer<typeof Recommendation>;

/** Query passed to a source adapter. */
export interface SourceQuery {
  /** Free-text topic, e.g. "AI devtools". Adapters may ignore if not applicable. */
  query?: string;
  /** Max candidates to return from this source. */
  limit?: number;
  /** Only return items newer than this ISO-8601 timestamp. */
  since?: string;
}

/**
 * Adapter contract (Strategy over sources). Each source is one adapter that
 * hits its own API and normalizes to Candidate[]. Adding Product Hunt /
 * Crunchbase later = one new implementation, zero pipeline change.
 */
export interface Source {
  readonly name: SourceName;
  fetch(query: SourceQuery): Promise<Candidate[]>;
}
