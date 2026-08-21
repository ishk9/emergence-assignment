import test from "node:test";
import assert from "node:assert/strict";
import { runTriage } from "./triage.ts";
import type { Candidate, Source } from "../types.ts";
import type { RunAnalysis } from "../analysis/analyze.ts";
import type { RunRecommend } from "../recommend/recommend.ts";

const noSleep = async () => {};
const NOW_MS = Date.parse("2026-08-22T00:00:00.000Z");
const NOW_ISO = "2026-08-22T00:00:00.000Z";

function cand(domain: string, magnitude: number): Candidate {
  return {
    domain,
    name: domain.split(".")[0]!,
    website: `https://${domain}`,
    oneLiner: "desc",
    sources: [{ source: "hackernews", url: `https://news.ycombinator.com/item?id=${domain}`, discoveredAt: NOW_ISO }],
    freshness: [{ kind: "hn_traction", value: `${magnitude}`, url: `https://news.ycombinator.com/item?id=${domain}`, at: NOW_ISO, magnitude }],
  };
}

function fakeSource(cands: Candidate[]): Source {
  return { name: "hackernews", async fetch() { return cands; } };
}

const strongAnalysis: RunAnalysis = async () => ({
  findings: "Solid.",
  claims: [{ text: "fact", sourceUrl: "https://x.com/a", confidence: "high" }],
  features: { technicalDepth: "high", differentiation: "high", marketSize: "large", overallRisk: "low" },
});

const okRecommend: RunRecommend = async () => ({
  verdict: "Meeting",
  rationale: "Strong.",
  counterPoints: ["a", "b", "c"],
});

test("runs source -> analyze -> score -> recommend -> memo and sorts by score", async () => {
  const results = await runTriage("ai", {
    sources: [fakeSource([cand("high.com", 50000), cand("low.com", 5)])],
    analysisRun: strongAnalysis,
    recommendRun: okRecommend,
    nowMs: NOW_MS,
    nowIso: NOW_ISO,
    sleep: noSleep,
  });

  assert.equal(results.length, 2);
  assert.equal(results[0]!.candidate.domain, "high.com"); // higher freshness -> higher score
  assert.ok(results[0]!.score.total >= results[1]!.score.total);
  assert.equal(results[0]!.analysis.length, 4);
  assert.equal(results[0]!.recommendation.verdict, "Meeting");
  assert.match(results[0]!.memo, /## Verdict: Meeting/);
});

test("a failing source degrades to empty, not a crash", async () => {
  const bad: Source = { name: "ycombinator", async fetch() { throw new Error("network down"); } };
  const results = await runTriage("ai", {
    sources: [bad, fakeSource([cand("ok.com", 100)])],
    analysisRun: strongAnalysis,
    recommendRun: okRecommend,
    nowMs: NOW_MS, nowIso: NOW_ISO, sleep: noSleep,
  });
  assert.equal(results.length, 1);
  assert.equal(results[0]!.candidate.domain, "ok.com");
});

test("analysis exhaustion degrades dimensions but still produces a memo", async () => {
  const alwaysThrows: RunAnalysis = async () => { throw new Error("model exploded"); };
  const results = await runTriage("ai", {
    sources: [fakeSource([cand("acme.com", 100)])],
    analysisRun: alwaysThrows,
    recommendRun: okRecommend,
    nowMs: NOW_MS, nowIso: NOW_ISO, sleep: noSleep,
  });
  assert.equal(results.length, 1);
  assert.ok(results[0]!.analysis.every((d) => /unavailable/.test(d.findings)));
  assert.match(results[0]!.memo, /Verdict:/);
});

test("recommendation exhaustion falls back to a score-based verdict", async () => {
  const alwaysThrows: RunRecommend = async () => { throw new Error("model exploded"); };
  const results = await runTriage("ai", {
    sources: [fakeSource([cand("acme.com", 100)])],
    analysisRun: strongAnalysis,
    recommendRun: alwaysThrows,
    nowMs: NOW_MS, nowIso: NOW_ISO, sleep: noSleep,
  });
  const rec = results[0]!.recommendation;
  assert.match(rec.rationale, /Score-based fallback/);
  assert.ok(rec.counterPoints.length >= 3);
});

test("corrective retry recovers after one bad analysis attempt", async () => {
  let calls = 0;
  const flaky: RunAnalysis = async ({ correction }) => {
    calls++;
    if (calls <= 4) return { findings: "", claims: [], features: {} }; // empty -> validation fail (4 dims x attempt1)
    assert.ok(correction && /findings were empty/.test(correction));
    return { findings: "recovered", claims: [], features: {} };
  };
  const results = await runTriage("ai", {
    sources: [fakeSource([cand("acme.com", 100)])],
    analysisRun: flaky,
    recommendRun: okRecommend,
    nowMs: NOW_MS, nowIso: NOW_ISO, sleep: noSleep,
  });
  assert.ok(results[0]!.analysis.some((d) => d.findings === "recovered"));
});
