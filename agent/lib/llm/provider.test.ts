import test from "node:test";
import assert from "node:assert/strict";
import { loadLlmConfig, resolveModel } from "./provider.ts";

test("loadLlmConfig defaults to gateway + claude-sonnet-5", () => {
  const cfg = loadLlmConfig({} as NodeJS.ProcessEnv);
  assert.equal(cfg.provider, "gateway");
  assert.equal(cfg.model, "anthropic/claude-sonnet-5");
});

test("loadLlmConfig reads LLM_PROVIDER + LLM_MODEL from env", () => {
  const cfg = loadLlmConfig({ LLM_PROVIDER: "bedrock", LLM_MODEL: "anthropic.claude-3-sonnet" } as NodeJS.ProcessEnv);
  assert.equal(cfg.provider, "bedrock");
  assert.equal(cfg.model, "anthropic.claude-3-sonnet");
});

test("loadLlmConfig rejects an invalid provider", () => {
  assert.throws(
    () => loadLlmConfig({ LLM_PROVIDER: "cohere" } as NodeJS.ProcessEnv),
    /Invalid LLM_PROVIDER/,
  );
});

test("resolveModel returns the model string for gateway (no key needed)", async () => {
  const model = await resolveModel({ provider: "gateway", model: "openai/gpt-5.4" });
  assert.equal(model, "openai/gpt-5.4");
});

test("resolveModel gives an actionable error for a missing provider package", async () => {
  // @ai-sdk/anthropic is not installed in this project.
  await assert.rejects(
    () => resolveModel({ provider: "anthropic", model: "claude-opus-4-8" }),
    /is not installed. Run: npm install @ai-sdk\/anthropic/,
  );
});
