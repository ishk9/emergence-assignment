import test from "node:test";
import assert from "node:assert/strict";
import { canonicalDomain } from "./domain.ts";

test("strips leading www and lowercases", () => {
  assert.equal(canonicalDomain("https://WWW.Acme.com/pricing"), "acme.com");
});

test("keeps subdomains (naive, no eTLD+1)", () => {
  assert.equal(canonicalDomain("https://app.acme.com"), "app.acme.com");
});

test("code hosts key by owner/repo, not bare host", () => {
  assert.equal(
    canonicalDomain("https://github.com/manishrjain/zroar"),
    "github.com/manishrjain/zroar",
  );
  assert.notEqual(
    canonicalDomain("https://github.com/a/b"),
    canonicalDomain("https://github.com/c/d"),
  );
});

test("code host with a single path segment keys by owner", () => {
  assert.equal(canonicalDomain("https://github.com/vercel"), "github.com/vercel");
});

test("returns null for an unparseable URL", () => {
  assert.equal(canonicalDomain("not a url"), null);
});
