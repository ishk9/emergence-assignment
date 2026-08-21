/**
 * Deterministic feature extraction: turn the LLM's structured `features`
 * (enums/strings/numbers) plus the candidate's freshness signals into five
 * normalized 0..1 subscores. No LLM here — this is the auditable numeric layer.
 * Missing/unknown features fall back to neutral defaults so scoring never
 * throws and stays reproducible.
 */
import type { Candidate, DimensionResult } from "../types.ts";

type Features = Record<string, number | string>;

/** low/med/high -> 0 / 0.5 / 1. */
function lmh(v: unknown, def = 0.5): number {
  if (typeof v !== "string") return def;
  const m: Record<string, number> = { low: 0, med: 0.5, high: 1 };
  return m[v.trim().toLowerCase()] ?? def;
}

function num(v: unknown, def = 0): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return def;
}

function pick(v: unknown, map: Record<string, number>, def: number): number {
  if (typeof v !== "string") return def;
  return map[v.trim().toLowerCase()] ?? def;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export interface Subscores {
  team: number;
  product: number;
  market: number;
  risk: number;
  freshness: number;
}

/** Traction from the strongest freshness magnitude, log-scaled to 0..1. */
function tractionScore(candidate: Candidate): number {
  const maxMag = candidate.freshness.reduce((m, s) => Math.max(m, s.magnitude ?? 0), 0);
  if (maxMag <= 0) return 0;
  return clamp01(Math.log10(maxMag + 1) / 5); // 100k -> ~1
}

/** Recency from the newest freshness signal, decaying over ~180 days. */
function recencyScore(candidate: Candidate, nowMs: number): number {
  const newest = candidate.freshness.reduce((m, s) => Math.max(m, Date.parse(s.at) || 0), 0);
  if (newest <= 0) return 0.3;
  const days = (nowMs - newest) / 86_400_000;
  return clamp01(1 - days / 180);
}

export function extractSubscores(
  results: DimensionResult[],
  candidate: Candidate,
  nowMs: number,
): Subscores {
  const byDim = new Map(results.map((r) => [r.dimension, r.features]));
  const team = (byDim.get("team") ?? {}) as Features;
  const product = (byDim.get("product") ?? {}) as Features;
  const market = (byDim.get("market") ?? {}) as Features;
  const risk = (byDim.get("risk") ?? {}) as Features;

  const teamScore = avg([
    lmh(team.technicalDepth),
    lmh(team.founderMarketFit),
    clamp01(num(team.priorExits) / 2),
  ]);
  const productScore = avg([
    lmh(product.differentiation),
    lmh(product.technicalMoat),
    pick(product.stage, { idea: 0, beta: 0.4, launched: 0.7, scaling: 1 }, 0.4),
  ]);
  const marketScore = avg([
    pick(market.marketSize, { small: 0.33, medium: 0.66, large: 1, unknown: 0.4 }, 0.4),
    1 - lmh(market.competition), // more competition -> lower
    pick(market.timing, { poor: 0, fair: 0.5, strong: 1 }, 0.4),
  ]);
  const riskScore = 1 - lmh(risk.overallRisk); // low risk -> high score
  const freshnessScore = 0.6 * tractionScore(candidate) + 0.4 * recencyScore(candidate, nowMs);

  return {
    team: clamp01(teamScore),
    product: clamp01(productScore),
    market: clamp01(marketScore),
    risk: clamp01(riskScore),
    freshness: clamp01(freshnessScore),
  };
}
