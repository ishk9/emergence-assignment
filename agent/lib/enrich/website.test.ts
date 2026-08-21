import test from "node:test";
import assert from "node:assert/strict";
import { extractOneLiner } from "./website.ts";

test("extracts meta description", () => {
  const html = `<head><meta name="description" content="Rockets for roadrunners."></head>`;
  assert.equal(extractOneLiner(html), "Rockets for roadrunners.");
});

test("extracts og:description (property attribute)", () => {
  const html = `<meta property="og:description" content="Vibe marketing agent">`;
  assert.equal(extractOneLiner(html), "Vibe marketing agent");
});

test("handles content-before-name attribute order", () => {
  const html = `<meta content="Reversed order desc" name="description">`;
  assert.equal(extractOneLiner(html), "Reversed order desc");
});

test("falls back to <title> and decodes entities", () => {
  const html = `<html><head><title>Acme &amp; Co</title></head></html>`;
  assert.equal(extractOneLiner(html), "Acme & Co");
});

test("returns undefined when nothing usable is present", () => {
  assert.equal(extractOneLiner("<html><body>no meta</body></html>"), undefined);
});
