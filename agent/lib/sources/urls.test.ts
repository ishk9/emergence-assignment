import test from "node:test";
import assert from "node:assert/strict";
import { candidatesFromUrls } from "./urls.ts";

const NOW = "2026-08-22T00:00:00.000Z";

test("builds candidates from URLs keyed by domain", () => {
  const out = candidatesFromUrls(["https://stripe.com/pricing", "https://acme.io"], NOW);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.domain, "stripe.com");
  assert.equal(out[0]!.name, "Stripe");
  assert.equal(out[0]!.sources[0]!.source, "url");
});

test("prepends https:// to a bare domain", () => {
  const out = candidatesFromUrls(["acme.com"], NOW);
  assert.equal(out[0]!.website, "https://acme.com");
  assert.equal(out[0]!.domain, "acme.com");
});

test("dedups the same domain", () => {
  const out = candidatesFromUrls(["https://acme.com/a", "https://acme.com/b"], NOW);
  assert.equal(out.length, 1);
});

test("skips unparseable input", () => {
  const out = candidatesFromUrls(["not a url", "https://ok.com"], NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.domain, "ok.com");
});
