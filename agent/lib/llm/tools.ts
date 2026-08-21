/**
 * Web-research tools for the analysis loop: `web_fetch` (keyless, always on)
 * and `web_search` (pluggable API backend — Tavily or Exa — bring your own key).
 *
 * Graceful degradation: with no search key configured, `web_search` returns an
 * "unavailable" result instead of throwing, so the model still researches by
 * fetching the candidate's known source URLs. A search key unlocks open-web
 * discovery. Add a backend = one case in `runSearch` + its response mapper.
 */
import { tool } from "ai";
import { z } from "zod";
import { createLogger } from "../logger.ts";

const log = createLogger("llm:tools");

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchProvider = "tavily" | "exa";

/** Strip HTML to readable text and cap length for the model context. */
export function htmlToText(html: string, maxChars = 8000): string {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? text.slice(0, maxChars) + "…" : text;
}

// --- Search response mappers (pure, tested with fixtures) ---

export function mapTavily(body: unknown): SearchResult[] {
  const results = (body as { results?: unknown[] }).results ?? [];
  return results.map((r) => {
    const o = r as { title?: string; url?: string; content?: string };
    return { title: o.title ?? "", url: o.url ?? "", snippet: o.content ?? "" };
  });
}

export function mapExa(body: unknown): SearchResult[] {
  const results = (body as { results?: unknown[] }).results ?? [];
  return results.map((r) => {
    const o = r as { title?: string; url?: string; text?: string; snippet?: string };
    return { title: o.title ?? "", url: o.url ?? "", snippet: o.text ?? o.snippet ?? "" };
  });
}

async function runSearch(
  provider: SearchProvider,
  query: string,
  limit: number,
  env: NodeJS.ProcessEnv,
): Promise<SearchResult[]> {
  if (provider === "tavily") {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: env.TAVILY_API_KEY, query, max_results: limit }),
    });
    if (!res.ok) throw new Error(`Tavily responded ${res.status}`);
    return mapTavily(await res.json());
  }
  // exa
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.EXA_API_KEY ?? "" },
    body: JSON.stringify({ query, numResults: limit, contents: { text: true } }),
  });
  if (!res.ok) throw new Error(`Exa responded ${res.status}`);
  return mapExa(await res.json());
}

/** Which backend is configured, or null if no key is present. */
export function configuredSearch(env: NodeJS.ProcessEnv = process.env): SearchProvider | null {
  const explicit = env.SEARCH_PROVIDER as SearchProvider | undefined;
  if (explicit === "tavily") return env.TAVILY_API_KEY ? "tavily" : null;
  if (explicit === "exa") return env.EXA_API_KEY ? "exa" : null;
  if (env.TAVILY_API_KEY) return "tavily";
  if (env.EXA_API_KEY) return "exa";
  return null;
}

export interface SearchOutcome {
  results: SearchResult[];
  unavailable?: string;
}

/** Best-effort search: returns { unavailable } (never throws) when no backend
 *  is configured or the call fails, so the research loop can continue. */
export async function webSearch(
  query: string,
  limit = 5,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SearchOutcome> {
  const provider = configuredSearch(env);
  if (!provider) {
    return { results: [], unavailable: "no search backend configured (set TAVILY_API_KEY or EXA_API_KEY)" };
  }
  try {
    const results = await runSearch(provider, query, limit, env);
    log.info("search", { provider, query, count: results.length });
    return { results };
  } catch (err) {
    log.warn("search failed", { provider, query, err: String(err) });
    return { results: [], unavailable: String(err) };
  }
}

/** AI SDK tool: fetch a URL and return readable text. */
export const webFetchTool = tool({
  description: "Fetch a web page and return its readable text content.",
  inputSchema: z.object({ url: z.string().describe("Absolute http(s) URL to fetch") }),
  async execute({ url }) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "emergence-triage" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { url, ok: false, error: `HTTP ${res.status}`, text: "" };
      const text = htmlToText(await res.text());
      log.info("fetch", { url, chars: text.length });
      return { url, ok: true, text };
    } catch (err) {
      return { url, ok: false, error: String(err), text: "" };
    }
  },
});

/** AI SDK tool: search the web (backend pluggable, degrades gracefully). */
export const webSearchTool = tool({
  description:
    "Search the web for recent information. Returns titles, URLs, and snippets. " +
    "Cite the returned URLs when you use a result.",
  inputSchema: z.object({
    query: z.string(),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  async execute({ query, limit }) {
    return webSearch(query, limit ?? 5);
  },
});

export const researchTools = { web_fetch: webFetchTool, web_search: webSearchTool };
