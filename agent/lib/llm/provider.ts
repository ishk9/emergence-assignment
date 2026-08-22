/**
 * Pluggable LLM provider resolution (Strategy over model providers).
 *
 * The pipeline never hard-codes a provider. `resolveModel` returns an AI SDK
 * model for whichever backend is configured — Vercel AI Gateway (default,
 * routes any `creator/model` string), or a direct provider (OpenAI, Anthropic,
 * Amazon Bedrock) using your own keys. Add a case + install the provider
 * package to support another backend; the rest of the pipeline is unchanged.
 *
 * Only the core `ai` package is a hard dependency. Direct providers are
 * lazy-imported so an unused one need not be installed.
 */
import type { LanguageModel } from "ai";
import { createLogger } from "../logger.ts";

const log = createLogger("llm:provider");

export type LlmProvider = "gateway" | "openai" | "anthropic" | "bedrock";

export interface LlmConfig {
  provider: LlmProvider;
  /** Model id in the provider's native format (or `creator/model` for gateway). */
  model: string;
}

const DEFAULT_CONFIG: LlmConfig = {
  // Anthropic direct (uses ANTHROPIC_API_KEY). Sonnet keeps the fan-out
  // affordable; set LLM_MODEL=claude-opus-4-8 for maximum quality, or
  // LLM_PROVIDER=gateway/openai/bedrock to route elsewhere.
  provider: "anthropic",
  model: "claude-sonnet-4-5",
};

const PROVIDERS: readonly LlmProvider[] = ["gateway", "openai", "anthropic", "bedrock"];

/** Read provider + model from env, falling back to gateway defaults. */
export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const provider = env.LLM_PROVIDER as LlmProvider | undefined;
  if (provider && !PROVIDERS.includes(provider)) {
    throw new Error(
      `Invalid LLM_PROVIDER "${provider}". Expected one of: ${PROVIDERS.join(", ")}.`,
    );
  }
  return {
    provider: provider ?? DEFAULT_CONFIG.provider,
    model: env.LLM_MODEL ?? DEFAULT_CONFIG.model,
  };
}

/** Dynamic import via a variable specifier so a missing optional provider
 *  package fails at runtime with a helpful message, not at compile time. */
async function importProvider(pkg: string): Promise<Record<string, unknown>> {
  try {
    return (await import(/* @vite-ignore */ pkg)) as Record<string, unknown>;
  } catch {
    throw new Error(
      `LLM provider package "${pkg}" is not installed. Run: npm install ${pkg}`,
    );
  }
}

/**
 * Resolve the configured provider + model to an AI SDK LanguageModel.
 * For the gateway a plain string is returned (routed by the AI SDK's global
 * gateway provider); direct providers return a constructed model instance.
 */
export async function resolveModel(config: LlmConfig = loadLlmConfig()): Promise<LanguageModel> {
  log.info("resolving model", { provider: config.provider, model: config.model });
  switch (config.provider) {
    case "gateway":
      // A `creator/model` string is handled by the AI SDK's global AI Gateway
      // provider (auth via AI_GATEWAY_API_KEY or Vercel OIDC).
      return config.model;
    case "openai": {
      const mod = await importProvider("@ai-sdk/openai");
      return (mod.openai as (id: string) => LanguageModel)(config.model);
    }
    case "anthropic": {
      const mod = await importProvider("@ai-sdk/anthropic");
      return (mod.anthropic as (id: string) => LanguageModel)(config.model);
    }
    case "bedrock": {
      const mod = await importProvider("@ai-sdk/amazon-bedrock");
      return (mod.amazonBedrock as (id: string) => LanguageModel)(config.model);
    }
    default: {
      const exhaustive: never = config.provider;
      throw new Error(`Unknown LLM provider: ${String(exhaustive)}`);
    }
  }
}
