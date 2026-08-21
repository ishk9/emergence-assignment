import test from "node:test";
import assert from "node:assert/strict";
import {
  Candidate,
  Claim,
  DimensionResult,
  Recommendation,
  Score,
} from "./types.ts";

const goodCandidate = {
  domain: "acme.com",
  name: "Acme",
  website: "https://acme.com",
  oneLiner: "Rockets for roadrunners.",
  sources: [
    { source: "hackernews", url: "https://news.ycombinator.com/item?id=1", discoveredAt: "2026-08-22T00:00:00.000Z" },
  ],
  freshness: [
    { kind: "hn_traction", value: "312 points", url: "https://news.ycombinator.com/item?id=1", at: "2026-08-22T00:00:00.000Z", magnitude: 312 },
  ],
};

test("Candidate parses a well-formed record", () => {
  const parsed = Candidate.parse(goodCandidate);
  assert.equal(parsed.domain, "acme.com");
  assert.equal(parsed.sources.length, 1);
});

test("Candidate requires at least one source", () => {
  assert.throws(() => Candidate.parse({ ...goodCandidate, sources: [] }));
});

test("Candidate rejects a non-URL website", () => {
  assert.throws(() => Candidate.parse({ ...goodCandidate, website: "acme" }));
});

test("Claim rejects a missing sourceUrl (provenance is mandatory)", () => {
  assert.throws(() => Claim.parse({ text: "Founder sold prior co", confidence: "high" }));
});

test("Claim rejects a non-URL sourceUrl", () => {
  assert.throws(() =>
    Claim.parse({ text: "x", sourceUrl: "not-a-url", confidence: "low" }),
  );
});

test("DimensionResult accepts string|number feature values", () => {
  const r = DimensionResult.parse({
    dimension: "team",
    findings: "Strong technical founders.",
    claims: [],
    features: { priorExits: 2, technicalDepth: "high" },
  });
  assert.equal(r.features.priorExits, 2);
});

test("Score rejects total above 100", () => {
  assert.throws(() =>
    Score.parse({
      total: 120,
      subscores: { team: 1, product: 1, market: 1, risk: 1, freshness: 1 },
      weightsVersion: "v1",
      explanation: "x",
    }),
  );
});

test("Recommendation requires 3-4 counter-points", () => {
  const base = { verdict: "Meeting", rationale: "Strong signal." };
  assert.throws(() => Recommendation.parse({ ...base, counterPoints: ["only one"] }));
  assert.throws(() =>
    Recommendation.parse({ ...base, counterPoints: ["a", "b", "c", "d", "e"] }),
  );
  const ok = Recommendation.parse({ ...base, counterPoints: ["a", "b", "c"] });
  assert.equal(ok.verdict, "Meeting");
});

test("Recommendation rejects an invalid verdict", () => {
  assert.throws(() =>
    Recommendation.parse({ verdict: "Maybe", rationale: "x", counterPoints: ["a", "b", "c"] }),
  );
});
