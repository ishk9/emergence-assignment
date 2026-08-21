import test from "node:test";
import assert from "node:assert/strict";
import { precisionAtK, relevantFor, type GoldenLabel } from "./golden.ts";

test("precisionAtK counts hits within the top K", () => {
  const ranked = ["a.com", "b.com", "c.com", "d.com"];
  const relevant = new Set(["a.com", "c.com"]);
  assert.equal(precisionAtK(ranked, relevant, 2), 0.5); // a hit, b miss
  assert.equal(precisionAtK(ranked, relevant, 4), 0.5); // 2 of 4
  assert.equal(precisionAtK(ranked, relevant, 1), 1); // a hit
});

test("precisionAtK is 0 for an empty ranking", () => {
  assert.equal(precisionAtK([], new Set(["a.com"]), 5), 0);
});

test("relevantFor filters golden labels by query", () => {
  const golden: GoldenLabel[] = [
    { query: "ai", domain: "a.com" },
    { query: "ai", domain: "b.com" },
    { query: "fintech", domain: "c.com" },
  ];
  const rel = relevantFor("ai", golden);
  assert.deepEqual([...rel].sort(), ["a.com", "b.com"]);
});
