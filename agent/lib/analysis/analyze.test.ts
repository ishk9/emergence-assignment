import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCandidate, analyzeDimension, toDimensionResult, type AnalysisOutput, type RunAnalysis } from "./analyze.ts";
import { buildContext, systemPrompt } from "./prompts.ts";
import type { Candidate } from "../types.ts";

const NOW = "2026-08-22T00:00:00.000Z";
const candidate: Candidate = {
  domain: "acme.com",
  name: "Acme",
  website: "https://acme.com",
  oneLiner: "Rockets for roadrunners.",
  sources: [{ source: "hackernews", url: "https://news.ycombinator.com/item?id=1", discoveredAt: NOW }],
  freshness: [{ kind: "hn_traction", value: "312 points", url: "https://news.ycombinator.com/item?id=1", at: NOW, magnitude: 312 }],
};

test("buildContext includes name, website, and source URLs", () => {
  const ctx = buildContext(candidate);
  assert.match(ctx, /Acme/);
  assert.match(ctx, /https:\/\/acme\.com/);
  assert.match(ctx, /news\.ycombinator\.com\/item\?id=1/);
});

test("systemPrompt is dimension-specific and enforces provenance", () => {
  const p = systemPrompt("team");
  assert.match(p, /TEAM/);
  assert.match(p, /NEVER invent numbers/);
});

test("toDimensionResult drops claims without a valid citation", () => {
  const output: AnalysisOutput = {
    findings: "Strong founders.",
    claims: [
      { text: "Founder sold a prior company", sourceUrl: "https://acme.com/about", confidence: "high" },
      { text: "Uncited guess", sourceUrl: "not-a-url", confidence: "low" },
    ],
    features: { priorExits: 1, technicalDepth: "high" },
  };
  const r = toDimensionResult("team", output);
  assert.equal(r.dimension, "team");
  assert.equal(r.claims.length, 1);
  assert.equal(r.claims[0]!.sourceUrl, "https://acme.com/about");
  assert.equal(r.features.priorExits, 1);
});

test("analyzeDimension uses the injected run and returns a DimensionResult", async () => {
  const fakeRun: RunAnalysis = async ({ system }) => {
    assert.match(system, /PRODUCT/);
    return { findings: "It does X.", claims: [], features: { stage: "launched" } };
  };
  const r = await analyzeDimension(candidate, "product", fakeRun);
  assert.equal(r.dimension, "product");
  assert.equal(r.features.stage, "launched");
});

test("analyzeCandidate runs all four dimensions", async () => {
  const fakeRun: RunAnalysis = async () => ({ findings: "f", claims: [], features: {} });
  const results = await analyzeCandidate(candidate, fakeRun);
  assert.deepEqual(
    results.map((r) => r.dimension).sort(),
    ["market", "product", "risk", "team"],
  );
});
