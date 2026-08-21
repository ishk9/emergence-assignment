import test from "node:test";
import assert from "node:assert/strict";
import { mergeCandidates } from "./normalize.ts";
import type { Candidate } from "./types.ts";

const iso = "2026-08-22T00:00:00.000Z";

function cand(over: Partial<Candidate> & { domain: string }): Candidate {
  return {
    name: "X",
    website: `https://${over.domain}`,
    oneLiner: "",
    sources: [{ source: "hackernews", url: "https://news.ycombinator.com/item?id=1", discoveredAt: iso }],
    freshness: [{ kind: "hn_traction", value: "10 points", url: "https://news.ycombinator.com/item?id=1", at: iso, magnitude: 10 }],
    ...over,
  };
}

test("merges two sources on the same domain into one candidate", () => {
  const hn = cand({
    domain: "acme.com",
    name: "Acme",
    oneLiner: "short",
    sources: [{ source: "hackernews", url: "https://news.ycombinator.com/item?id=9", discoveredAt: iso }],
    freshness: [{ kind: "hn_traction", value: "200 points", url: "https://news.ycombinator.com/item?id=9", at: iso, magnitude: 200 }],
  });
  const yc = cand({
    domain: "acme.com",
    name: "Acme",
    oneLiner: "a much longer and more descriptive one-liner",
    sources: [{ source: "ycombinator", url: "https://www.ycombinator.com/companies/acme", discoveredAt: iso }],
    freshness: [{ kind: "launch", value: "YC Summer 2025", url: "https://www.ycombinator.com/companies/acme", at: iso, magnitude: 5 }],
  });

  const out = mergeCandidates([hn, yc]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.sources.length, 2);
  assert.equal(out[0]!.freshness.length, 2);
  assert.equal(out[0]!.oneLiner, "a much longer and more descriptive one-liner");
});

test("keeps distinct domains separate", () => {
  const out = mergeCandidates([cand({ domain: "a.com" }), cand({ domain: "b.com" })]);
  assert.equal(out.length, 2);
});

test("orders multi-source candidates before single-source ones", () => {
  const single = cand({ domain: "solo.com", name: "Solo" });
  const multiA = cand({ domain: "multi.com", name: "Multi", sources: [{ source: "hackernews", url: "https://h/1", discoveredAt: iso }] });
  const multiB = cand({ domain: "multi.com", name: "Multi", sources: [{ source: "ycombinator", url: "https://y/1", discoveredAt: iso }] });
  const out = mergeCandidates([single, multiA, multiB]);
  assert.equal(out[0]!.domain, "multi.com");
});

test("orders by total traction magnitude within the same source count", () => {
  const low = cand({ domain: "low.com", freshness: [{ kind: "hn_traction", value: "5", url: "https://h/1", at: iso, magnitude: 5 }] });
  const high = cand({ domain: "high.com", freshness: [{ kind: "hn_traction", value: "900", url: "https://h/2", at: iso, magnitude: 900 }] });
  const out = mergeCandidates([low, high]);
  assert.equal(out[0]!.domain, "high.com");
});

test("dedups identical source refs and signals", () => {
  const a = cand({ domain: "dup.com" });
  const b = cand({ domain: "dup.com" }); // identical source + signal urls
  const out = mergeCandidates([a, b]);
  assert.equal(out[0]!.sources.length, 1);
  assert.equal(out[0]!.freshness.length, 1);
});

test("limit caps to the strongest N", () => {
  const out = mergeCandidates(
    [cand({ domain: "a.com" }), cand({ domain: "b.com" }), cand({ domain: "c.com" })],
    { limit: 2 },
  );
  assert.equal(out.length, 2);
});
