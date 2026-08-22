# LLM providers

The pipeline is provider-pluggable (see `agent/lib/llm/provider.ts`). Pick a
backend with two env vars; everything else is unchanged.

| `LLM_PROVIDER` | `LLM_MODEL` example | Auth |
|---|---|---|
| `anthropic` (default) | `claude-sonnet-4-5` | `ANTHROPIC_API_KEY` |
| `bedrock` | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | AWS credential chain |
| `gateway` | `anthropic/claude-sonnet-4-5` | `AI_GATEWAY_API_KEY` |
| `openai` | `gpt-5.4` | `OPENAI_API_KEY` |

## Web search is independent of the LLM provider

The web-research pass and the analysis LLM are decoupled (`agent/lib/analysis/analyze.ts`):

- If `ANTHROPIC_API_KEY` is set, research always uses **Anthropic's native
  server-side web search** — regardless of `LLM_PROVIDER`. So Bedrock/OpenAI/
  gateway analysis still gets full open-web grounding (founder history, funding,
  competitors). Override the research model with `LLM_RESEARCH_MODEL`.
- Otherwise research falls back to the configured provider + pluggable search
  (`TAVILY_API_KEY` / `EXA_API_KEY`); with no key at all it degrades to keyless
  `web_fetch` of each candidate's own site.

## Amazon Bedrock

```sh
export LLM_PROVIDER=bedrock
export LLM_MODEL="us.anthropic.claude-sonnet-4-5-20250929-v1:0"  # cross-region inference profile
export AWS_PROFILE=egenome          # any named profile / SSO / instance role
export AWS_REGION=us-east-1
node --env-file=.env scripts/triage.ts --urls https://linear.app
```

Notes:
- Credentials resolve via the **full AWS credential chain** (`fromNodeProviderChain`):
  env vars, `AWS_PROFILE`, SSO, or an instance role — no keys in `.env` needed.
- Bedrock requires a **cross-region inference profile** id (the `us.` prefix).
  A bare `anthropic.claude-…` id returns *"on-demand throughput isn't supported"*.
- **Web search:** Anthropic's native server-side `web_search` runs only on the
  `anthropic` provider. On Bedrock the analysis still runs (it fetches each
  candidate's known URLs via keyless `web_fetch`), but open-web discovery needs
  a `TAVILY_API_KEY` or `EXA_API_KEY`. Without one, memos have fewer cited claims
  and lower scores — verified: Linear scored 67.9 on Anthropic-native vs 56.2 on
  Bedrock with fetch-only research.
