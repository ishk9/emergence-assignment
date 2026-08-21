import test from "node:test";
import assert from "node:assert/strict";
import { mapHit, parseShowHnTitle, type AlgoliaHit } from "./hackernews.ts";

const NOW = "2026-08-22T00:00:00.000Z";

test("parseShowHnTitle splits on en-dash", () => {
  const r = parseShowHnTitle("Show HN: Zroar – Serialized Roaring Bitmaps in Zig");
  assert.equal(r.name, "Zroar");
  assert.equal(r.oneLiner, "Serialized Roaring Bitmaps in Zig");
});

test("parseShowHnTitle splits on hyphen and decodes entities", () => {
  const r = parseShowHnTitle("Show HN: secret_share - share secrets with a friend&#x27;s key");
  assert.equal(r.name, "secret_share");
  assert.equal(r.oneLiner, "share secrets with a friend's key");
});

test("parseShowHnTitle handles no separator", () => {
  const r = parseShowHnTitle("Show HN: JustAName");
  assert.equal(r.name, "JustAName");
  assert.equal(r.oneLiner, "");
});

test("mapHit produces a valid Candidate with an HN traction signal", () => {
  const hit: AlgoliaHit = {
    objectID: "49393285",
    title: "Show HN: Zroar – Serialized Roaring Bitmaps in Zig",
    url: "https://github.com/manishrjain/zroar",
    points: 42,
    num_comments: 7,
    created_at: "2026-08-21T20:18:22Z",
  };
  const c = mapHit(hit, NOW)!;
  assert.equal(c.name, "Zroar");
  assert.equal(c.domain, "github.com/manishrjain/zroar");
  assert.equal(c.website, "https://github.com/manishrjain/zroar");
  assert.equal(c.sources[0]!.source, "hackernews");
  assert.equal(c.sources[0]!.url, "https://news.ycombinator.com/item?id=49393285");
  assert.equal(c.freshness[0]!.kind, "hn_traction");
  assert.equal(c.freshness[0]!.magnitude, 42);
  assert.match(c.freshness[0]!.value, /42 points, 7 comments/);
});

test("mapHit returns null when there is no external URL", () => {
  assert.equal(mapHit({ objectID: "1", title: "Show HN: text only post" }, NOW), null);
});

test("mapHit defaults points/comments to 0 when absent", () => {
  const c = mapHit(
    { objectID: "2", title: "Show HN: Acme – rockets", url: "https://acme.com" },
    NOW,
  )!;
  assert.equal(c.freshness[0]!.magnitude, 0);
  assert.equal(c.domain, "acme.com");
});
