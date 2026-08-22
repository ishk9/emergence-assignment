import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, normalize, recommend, type RunRecommend } from "./recommend.ts";
import { loadProfile } from "../scoring/profiles.ts";
import type { Candidate, DimensionResult, Score } from "../types.ts";

const candidate: Candidate = {
  domain: "acme.com",
  name: "Acme",
  website: "https://acme.com",
  oneLiner: "Rockets for roadrunners.",
  sources: [{ source: "hackernews", url: "https://news.ycombinator.com/item?id=1", discoveredAt: "2026-08-22T00:00:00.000Z" }],
  freshness: [],
};

const results: DimensionResult[] = [
  { dimension: "team", findings: "Strong founders.", claims: [{ text: "Prior exit", sourceUrl: "https://acme.com/about", confidence: "high" }], features: {} },
  { dimension: "product", findings: "Launched product.", claims: [], features: {} },
];

const score: Score = {
  total: 78,
  subscores: { team: 80, product: 75, market: 70, risk: 80, freshness: 90 },
  weightsVersion: "v1",
  explanation: "team 80×0.3, ... → 78/100 (weights v1)",
};

test("buildPrompt includes score, breakdown, and cited findings", () => {
  const p = buildPrompt(candidate, results, score);
  assert.match(p, /78\/100/);
  assert.match(p, /Strong founders/);
  assert.match(p, /acme\.com\/about/);
});

test("normalize clamps to at most 4 counter-points", () => {
  const rec = normalize({ verdict: "Watch", rationale: "r", counterPoints: ["a", "b", "c", "d", "e"] });
  assert.equal(rec.counterPoints.length, 4);
});

test("normalize rejects fewer than 3 counter-points", () => {
  assert.throws(() => normalize({ verdict: "Pass", rationale: "r", counterPoints: ["only one"] }));
});

test("recommend returns a validated Recommendation via injected run", async () => {
  const run: RunRecommend = async ({ system, prompt }) => {
    assert.match(system, /venture-capital partner/);
    assert.match(prompt, /Acme/);
    return { verdict: "Meeting", rationale: "Strong team and traction.", counterPoints: ["a", "b", "c"] };
  };
  const rec = await recommend(candidate, results, score, loadProfile("balanced"), run);
  assert.equal(rec.verdict, "Meeting");
  assert.equal(rec.counterPoints.length, 3);
});

test("the profile's thesis + risk appetite reach the verdict prompt", () => {
  const p = buildPrompt(candidate, results, score, loadProfile("conservative"));
  assert.match(p, /PARTNER THESIS \(conservative\)/);
  assert.match(p, /RISK APPETITE: low/);
});
