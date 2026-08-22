import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCandidate,
  toDimensionResult,
  type Extraction,
  type ExtractFn,
  type ResearchFn,
} from "./analyze.ts";
import { buildContext } from "./prompts.ts";
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

function fullExtraction(over: Partial<Extraction> = {}): Extraction {
  return {
    team: { findings: "Strong founders.", claims: [{ text: "Prior exit", sourceUrl: "https://acme.com/about", confidence: "high" }], members: [{ name: "Ada Lovelace", role: "CEO", background: "Ex-Analytical Engine." }, { name: "Alan Turing", role: "CTO", background: "Ex-Bletchley." }], features: { priorExits: 1, technicalDepth: "high", founderMarketFit: "high" } },
    product: { findings: "Launched.", claims: [], features: { differentiation: "high", technicalMoat: "med", stage: "launched" } },
    market: { findings: "Large.", claims: [], features: { marketSize: "large", competition: "low", timing: "strong" } },
    risk: { findings: "Low.", claims: [], features: { overallRisk: "low", mainRisk: "competition" } },
    ...over,
  };
}

test("buildContext includes name, website, and source URLs", () => {
  const ctx = buildContext(candidate);
  assert.match(ctx, /Acme/);
  assert.match(ctx, /news\.ycombinator\.com\/item\?id=1/);
});

test("toDimensionResult drops claims without a valid citation and keeps features", () => {
  const block: Extraction["team"] = {
    findings: "f",
    claims: [
      { text: "cited", sourceUrl: "https://acme.com/about", confidence: "high" },
      { text: "uncited", sourceUrl: "not-a-url", confidence: "low" },
    ],
    members: [{ name: "Ada Lovelace", role: "CEO", background: "Ex-Analytical Engine." }],
    features: { priorExits: 2, technicalDepth: "high", founderMarketFit: "med" },
  };
  const r = toDimensionResult("team", block);
  assert.equal(r.dimension, "team");
  assert.equal(r.claims.length, 1);
  assert.equal(r.features.priorExits, 2);
  assert.equal(r.features.technicalDepth, "high");
  assert.equal(r.members?.length, 1); // per-founder bios carried through
});

test("toDimensionResult carries every founder's bio through", () => {
  const results = toDimensionResult("team", fullExtraction().team);
  assert.deepEqual(
    results.members?.map((m) => m.name),
    ["Ada Lovelace", "Alan Turing"], // not just the CEO
  );
});

test("analyzeCandidate researches once then returns four dimensions with features", async () => {
  let researchCalls = 0;
  const research: ResearchFn = async () => {
    researchCalls++;
    return { notes: "notes", sources: ["https://acme.com"] };
  };
  const extract: ExtractFn = async ({ notes }) => {
    assert.equal(notes, "notes");
    return fullExtraction();
  };
  const results = await analyzeCandidate(candidate, { research, extract });
  assert.equal(researchCalls, 1); // ONE research pass, not four
  assert.deepEqual(results.map((r) => r.dimension).sort(), ["market", "product", "risk", "team"]);
  const team = results.find((r) => r.dimension === "team")!;
  assert.equal(team.features.technicalDepth, "high");
});

test("analyzeCandidate still extracts when research throws", async () => {
  const research: ResearchFn = async () => {
    throw new Error("web down");
  };
  const extract: ExtractFn = async () => fullExtraction();
  const results = await analyzeCandidate(candidate, { research, extract });
  assert.equal(results.length, 4);
});

test("analyzeCandidate degrades when extraction keeps failing", async () => {
  const research: ResearchFn = async () => ({ notes: "", sources: [] });
  const extract: ExtractFn = async () => fullExtraction({ team: { findings: "", claims: [], members: [], features: { priorExits: 0, technicalDepth: "low", founderMarketFit: "low" } } });
  const results = await analyzeCandidate(candidate, { research, extract, sleep: async () => {} });
  const team = results.find((r) => r.dimension === "team")!;
  assert.match(team.findings, /unavailable/);
});
