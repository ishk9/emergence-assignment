/**
 * Website enrichment. Only used to backfill a missing one-liner from a page's
 * meta description / title — the LLM analysis subagents read site content
 * themselves, so we deliberately do no tech-detection or deep scraping here.
 *
 * Pure `extractOneLiner` is split from the IO fetch.
 */
import type { Candidate } from "../types.ts";
import { createLogger } from "../logger.ts";

const log = createLogger("enrich:website");

function decodeEntities(s: string): string {
  return s
    .replace(/&#x2F;/gi, "/")
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&gt;/gi, ">")
    .replace(/&lt;/gi, "<");
}

/** Pull a one-liner from meta description / og:description, else <title>. */
export function extractOneLiner(html: string): string | undefined {
  const metaPatterns = [
    /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property)=["'](?:description|og:description)["']/i,
  ];
  for (const re of metaPatterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]).trim();
  }
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return title?.[1] ? decodeEntities(title[1]).trim() : undefined;
}

/** Best-effort: backfill one-liner only when the candidate lacks one. */
export async function enrichFromWebsite(candidate: Candidate): Promise<Candidate> {
  if (candidate.oneLiner.trim()) return candidate;
  try {
    const res = await fetch(candidate.website, {
      headers: { "User-Agent": "emergence-triage" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`site responded ${res.status}`);
    const html = await res.text();
    const oneLiner = extractOneLiner(html);
    if (oneLiner) {
      log.info("backfilled one-liner", { domain: candidate.domain });
      return { ...candidate, oneLiner };
    }
    return candidate;
  } catch (err) {
    log.warn("website enrichment failed", { domain: candidate.domain, err: String(err) });
    return candidate;
  }
}
