import test from "node:test";
import assert from "node:assert/strict";
import { renderMemo, type MemoInput } from "./render.ts";

const input: MemoInput = {
  candidate: {
    domain: "acme.com",
    name: "Acme",
    website: "https://acme.com",
    oneLiner: "Rockets for roadrunners.",
    sources: [{ source: "hackernews", url: "https://news.ycombinator.com/item?id=1", discoveredAt: "2026-08-22T00:00:00.000Z" }],
    freshness: [{ kind: "hn_traction", value: "312 points", url: "https://news.ycombinator.com/item?id=1", at: "2026-08-22T00:00:00.000Z", magnitude: 312 }],
  },
  results: [
    { dimension: "team", findings: "Strong founders.", claims: [{ text: "Prior exit to BigCo", sourceUrl: "https://acme.com/about", confidence: "high" }], features: {} },
    { dimension: "market", findings: "Large market.", claims: [], features: {} },
  ],
  score: {
    total: 78,
    subscores: { team: 80, product: 75, market: 70, risk: 80, freshness: 90 },
    weightsVersion: "v1",
    explanation: "team 80×0.3 → 78/100 (weights v1)",
  },
  recommendation: {
    verdict: "Meeting",
    rationale: "Strong team, real traction.",
    counterPoints: ["Market may be crowded", "Revenue unproven", "Single founder risk"],
  },
};

test("memo includes verdict, score, name, and rationale", () => {
  const md = renderMemo(input);
  assert.match(md, /# Acme/);
  assert.match(md, /## Verdict: Meeting/);
  assert.match(md, /Score: 78\/100/);
  assert.match(md, /Strong team, real traction\./);
});

test("every claim is rendered with its source link (provenance)", () => {
  const md = renderMemo(input);
  assert.match(md, /Prior exit to BigCo \(\[source\]\(https:\/\/acme\.com\/about\), high\)/);
});

test("counter-points and freshness signals appear", () => {
  const md = renderMemo(input);
  assert.match(md, /What might change your mind/);
  assert.match(md, /- Market may be crowded/);
  assert.match(md, /hn_traction.*312 points/);
});

test("dimensions render in canonical order", () => {
  const md = renderMemo(input);
  assert.ok(md.indexOf("### Team") < md.indexOf("### Market"));
});

test("a dimension with no claims still renders its findings", () => {
  const md = renderMemo(input);
  assert.match(md, /### Market\n\nLarge market\./);
});
