import test from "node:test";
import assert from "node:assert/strict";
import { configuredSearch, htmlToText, mapExa, mapTavily, webSearch } from "./tools.ts";

test("htmlToText strips tags/scripts/styles and collapses whitespace", () => {
  const html = `<html><head><style>.a{color:red}</style><script>var x=1</script></head>
    <body><h1>Acme</h1>  <p>Rockets   for\nroadrunners.</p></body></html>`;
  const text = htmlToText(html);
  assert.equal(text, "Acme Rockets for roadrunners.");
});

test("htmlToText caps length", () => {
  const text = htmlToText("<p>" + "x".repeat(20000) + "</p>", 100);
  assert.equal(text.length, 101); // 100 + ellipsis
});

test("mapTavily normalizes results", () => {
  const out = mapTavily({ results: [{ title: "T", url: "https://t.com", content: "snip" }] });
  assert.deepEqual(out, [{ title: "T", url: "https://t.com", snippet: "snip" }]);
});

test("mapExa normalizes results (text field)", () => {
  const out = mapExa({ results: [{ title: "E", url: "https://e.com", text: "body" }] });
  assert.deepEqual(out, [{ title: "E", url: "https://e.com", snippet: "body" }]);
});

test("configuredSearch returns null when no key present", () => {
  assert.equal(configuredSearch({} as NodeJS.ProcessEnv), null);
});

test("configuredSearch honors explicit SEARCH_PROVIDER + key", () => {
  assert.equal(configuredSearch({ SEARCH_PROVIDER: "exa", EXA_API_KEY: "k" } as NodeJS.ProcessEnv), "exa");
  assert.equal(configuredSearch({ SEARCH_PROVIDER: "tavily" } as NodeJS.ProcessEnv), null); // no key
});

test("configuredSearch infers backend from whichever key is set", () => {
  assert.equal(configuredSearch({ TAVILY_API_KEY: "k" } as NodeJS.ProcessEnv), "tavily");
});

test("webSearch returns unavailable (never throws) with no backend", async () => {
  const out = await webSearch("anything", 3, {} as NodeJS.ProcessEnv);
  assert.equal(out.results.length, 0);
  assert.match(out.unavailable!, /no search backend/);
});
