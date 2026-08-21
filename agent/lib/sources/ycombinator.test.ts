import test from "node:test";
import assert from "node:assert/strict";
import { mapCompany, type YcCompany } from "./ycombinator.ts";

const NOW = "2026-08-22T00:00:00.000Z";

const stormy: YcCompany = {
  name: "Stormy",
  slug: "stormy",
  website: "https://stormy.ai",
  one_liner: " Stormy runs the office so your crew can run the work.",
  industry: "B2B",
  tags: ["Artificial Intelligence"],
  team_size: 5,
  batch: "Summer 2025",
  status: "Active",
  launched_at: 1723238839,
  url: "https://www.ycombinator.com/companies/stormy",
};

test("mapCompany produces a valid Candidate with a launch signal", () => {
  const c = mapCompany(stormy, NOW)!;
  assert.equal(c.name, "Stormy");
  assert.equal(c.domain, "stormy.ai");
  assert.equal(c.website, "https://stormy.ai");
  assert.equal(c.oneLiner, "Stormy runs the office so your crew can run the work.");
  assert.equal(c.sources[0]!.source, "ycombinator");
  assert.equal(c.sources[0]!.url, "https://www.ycombinator.com/companies/stormy");
  assert.equal(c.freshness[0]!.kind, "launch");
  assert.equal(c.freshness[0]!.value, "YC Summer 2025 · Active");
  assert.equal(c.freshness[0]!.magnitude, 5);
});

test("mapCompany derives signal timestamp from launched_at", () => {
  const c = mapCompany(stormy, NOW)!;
  assert.equal(c.freshness[0]!.at, new Date(1723238839 * 1000).toISOString());
});

test("mapCompany falls back to nowIso when launched_at is absent", () => {
  const c = mapCompany({ ...stormy, launched_at: undefined }, NOW)!;
  assert.equal(c.freshness[0]!.at, NOW);
});

test("mapCompany tolerates a null team_size (real yc-oss data)", () => {
  const c = mapCompany({ ...stormy, team_size: null }, NOW)!;
  assert.equal(c.freshness[0]!.magnitude, undefined);
  assert.equal(c.name, "Stormy");
});

test("mapCompany returns null without a website", () => {
  assert.equal(mapCompany({ ...stormy, website: null }, NOW), null);
});

test("mapCompany builds a profile URL from slug when url is missing", () => {
  const c = mapCompany({ ...stormy, url: undefined }, NOW)!;
  assert.equal(c.sources[0]!.url, "https://www.ycombinator.com/companies/stormy");
});
