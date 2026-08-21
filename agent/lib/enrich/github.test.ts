import test from "node:test";
import assert from "node:assert/strict";
import { applyRepo, parseRepo, repoFromDomain, type RepoInfo } from "./github.ts";
import type { Candidate } from "../types.ts";

const NOW = "2026-08-22T00:00:00.000Z";

function baseCandidate(over: Partial<Candidate> = {}): Candidate {
  return {
    domain: "github.com/vercel/next.js",
    name: "next.js",
    website: "https://github.com/vercel/next.js",
    oneLiner: "",
    sources: [{ source: "hackernews", url: "https://news.ycombinator.com/item?id=1", discoveredAt: NOW }],
    freshness: [{ kind: "hn_traction", value: "10 points", url: "https://news.ycombinator.com/item?id=1", at: NOW, magnitude: 10 }],
    ...over,
  };
}

test("repoFromDomain extracts owner/repo", () => {
  assert.deepEqual(repoFromDomain("github.com/vercel/next.js"), { owner: "vercel", repo: "next.js" });
});

test("repoFromDomain rejects non-repo domains", () => {
  assert.equal(repoFromDomain("github.com/vercel"), null);
  assert.equal(repoFromDomain("acme.com"), null);
});

test("parseRepo normalizes nulls to defaults", () => {
  const info = parseRepo({ stargazers_count: 5, language: null, description: null });
  assert.equal(info.stars, 5);
  assert.equal(info.language, undefined);
  assert.equal(info.description, undefined);
});

test("applyRepo appends a github_activity signal with stars as magnitude", () => {
  const info: RepoInfo = { stars: 141880, pushedAt: "2026-08-21T20:36:04Z", language: "JavaScript", url: "https://github.com/vercel/next.js" };
  const out = applyRepo(baseCandidate(), info, NOW);
  const gh = out.freshness.find((s) => s.kind === "github_activity")!;
  assert.equal(gh.magnitude, 141880);
  assert.match(gh.value, /141880 stars, JavaScript/);
  assert.equal(gh.at, "2026-08-21T20:36:04Z");
  assert.equal(out.freshness.length, 2); // original hn_traction + github_activity
});

test("applyRepo backfills an empty one-liner from description", () => {
  const info: RepoInfo = { stars: 1, description: "The React Framework" };
  const out = applyRepo(baseCandidate({ oneLiner: "" }), info, NOW);
  assert.equal(out.oneLiner, "The React Framework");
});

test("applyRepo keeps an existing one-liner", () => {
  const info: RepoInfo = { stars: 1, description: "The React Framework" };
  const out = applyRepo(baseCandidate({ oneLiner: "existing" }), info, NOW);
  assert.equal(out.oneLiner, "existing");
});

test("applyRepo does not duplicate an already-present github_activity signal", () => {
  const info: RepoInfo = { stars: 5, url: "https://github.com/vercel/next.js" };
  const once = applyRepo(baseCandidate(), info, NOW);
  const twice = applyRepo(once, info, NOW);
  assert.equal(twice.freshness.filter((s) => s.kind === "github_activity").length, 1);
});
