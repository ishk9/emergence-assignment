import test from "node:test";
import assert from "node:assert/strict";
import { WeightedScorer } from "./index.ts";
import { extractSubscores } from "./features.ts";
import { WEIGHTS_V1 } from "./weights.ts";
import type { Candidate, DimensionResult } from "../types.ts";

const NOW = Date.parse("2026-08-22T00:00:00.000Z");

function candidate(magnitude = 1000, at = "2026-08-20T00:00:00.000Z"): Candidate {
  return {
    domain: "acme.com",
    name: "Acme",
    website: "https://acme.com",
    oneLiner: "x",
    sources: [{ source: "hackernews", url: "https://news.ycombinator.com/item?id=1", discoveredAt: at }],
    freshness: [{ kind: "hn_traction", value: "traction", url: "https://news.ycombinator.com/item?id=1", at, magnitude }],
  };
}

function results(over: Partial<Record<string, Record<string, number | string>>> = {}): DimensionResult[] {
  const mk = (dimension: DimensionResult["dimension"], features: Record<string, number | string>): DimensionResult => ({
    dimension,
    findings: "f",
    claims: [],
    features,
  });
  return [
    mk("team", over.team ?? { technicalDepth: "high", founderMarketFit: "high", priorExits: 2 }),
    mk("product", over.product ?? { differentiation: "high", technicalMoat: "high", stage: "scaling" }),
    mk("market", over.market ?? { marketSize: "large", competition: "low", timing: "strong" }),
    mk("risk", over.risk ?? { overallRisk: "low" }),
  ];
}

test("weights sum to 1", () => {
  const sum = Object.values(WEIGHTS_V1.weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test("a strong startup scores high", () => {
  const s = new WeightedScorer().score(candidate(50000), results(), NOW);
  assert.ok(s.total >= 85, `expected high, got ${s.total}`);
  assert.equal(s.weightsVersion, "balanced"); // default profile name
  assert.match(s.explanation, /→ .*\/100/);
});

test("a weak startup scores low", () => {
  const weak = results({
    team: { technicalDepth: "low", founderMarketFit: "low", priorExits: 0 },
    product: { differentiation: "low", technicalMoat: "low", stage: "idea" },
    market: { marketSize: "small", competition: "high", timing: "poor" },
    risk: { overallRisk: "high" },
  });
  const s = new WeightedScorer().score(candidate(0), weak, NOW);
  assert.ok(s.total <= 15, `expected low, got ${s.total}`);
});

test("scoring is deterministic for identical inputs", () => {
  const a = new WeightedScorer().score(candidate(1234), results(), NOW);
  const b = new WeightedScorer().score(candidate(1234), results(), NOW);
  assert.deepEqual(a, b);
});

test("higher competition lowers the market subscore", () => {
  const low = extractSubscores(results({ market: { marketSize: "large", competition: "low", timing: "strong" } }), candidate(), NOW);
  const high = extractSubscores(results({ market: { marketSize: "large", competition: "high", timing: "strong" } }), candidate(), NOW);
  assert.ok(high.market < low.market);
});

test("low risk yields a higher risk subscore than high risk", () => {
  const lowRisk = extractSubscores(results({ risk: { overallRisk: "low" } }), candidate(), NOW);
  const highRisk = extractSubscores(results({ risk: { overallRisk: "high" } }), candidate(), NOW);
  assert.ok(lowRisk.risk > highRisk.risk);
});

test("missing features fall back to neutral (no throw)", () => {
  const s = new WeightedScorer().score(candidate(), [
    { dimension: "team", findings: "", claims: [], features: {} },
  ], NOW);
  assert.ok(s.total >= 0 && s.total <= 100);
});

test("recent traction scores higher freshness than stale", () => {
  const fresh = extractSubscores(results(), candidate(1000, "2026-08-21T00:00:00.000Z"), NOW);
  const stale = extractSubscores(results(), candidate(1000, "2026-01-01T00:00:00.000Z"), NOW);
  assert.ok(fresh.freshness > stale.freshness);
});
