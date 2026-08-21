import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";

// Anthropic direct via ANTHROPIC_API_KEY (matches the pipeline's default
// provider). Swap for a gateway string or another provider model if desired.
export default defineAgent({
  model: anthropic("claude-sonnet-4-6"),
});
