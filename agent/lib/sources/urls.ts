/**
 * Build candidates directly from user-supplied URLs, so a partner can paste
 * links ("triage these") instead of naming a topic. Each URL becomes a
 * Candidate keyed by its canonical domain; enrichment later fills the name/
 * one-liner from the page. No freshness signal (unknown at this point).
 */
import { Candidate } from "../types.ts";
import { canonicalDomain } from "../domain.ts";
import { createLogger } from "../logger.ts";

const log = createLogger("source:url");

/** Prepend https:// when the user pastes a bare domain. */
function normalizeUrl(raw: string): string {
  const t = raw.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** A readable placeholder name from the domain; enrichment refines it. */
function nameFromDomain(domain: string): string {
  const label = domain.split("/").pop()!.split(".")[0]!;
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : domain;
}

export function candidatesFromUrls(urls: string[], nowIso: string): Candidate[] {
  const byDomain = new Map<string, Candidate>();
  for (const raw of urls) {
    const url = normalizeUrl(raw);
    const domain = canonicalDomain(url);
    if (!domain) {
      log.warn("skipped unparseable url", { raw });
      continue;
    }
    if (byDomain.has(domain)) continue;
    try {
      byDomain.set(
        domain,
        Candidate.parse({
          domain,
          name: nameFromDomain(domain),
          website: url,
          oneLiner: "",
          sources: [{ source: "url", url, discoveredAt: nowIso }],
          freshness: [],
        }),
      );
    } catch (err) {
      log.warn("skipped invalid url candidate", { raw, err: String(err) });
    }
  }
  const out = [...byDomain.values()];
  log.info("built candidates from urls", { input: urls.length, candidates: out.length });
  return out;
}
