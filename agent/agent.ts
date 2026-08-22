import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";

// Chat/orchestration model. Kept on Anthropic because eve's context-compaction
// needs a model with known Gateway context-window metadata (a raw Bedrock
// instance has none, which breaks `eve dev`). This is only the thin chat layer;
// the actual VC analysis + verdict run through the pipeline, which honors
// LLM_PROVIDER (set LLM_PROVIDER=bedrock in .env to run those on Bedrock).
export default defineAgent({
  model: anthropic("claude-sonnet-4-5"),
});
