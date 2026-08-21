/**
 * Hacker News source adapter (Adapter pattern over the free Algolia API).
 * Maps "Show HN" launches to Candidates, using points/comments as the HN
 * traction freshness signal. No API key required.
 *
 * Pure mapping (`parseShowHnTitle`, `mapHit`) is separated from IO (`fetch`)
 * so the mapping is unit-tested without touching the network.
 */
import { Candidate, type Source, type SourceQuery } from "../types.ts";
import { canonicalDomain } from "../domain.ts";
import { createLogger } from "../logger.ts";

const ALGOLIA = "https://hn.algolia.com/api/v1";

/** The subset of the Algolia hit shape we consume. */
export interface AlgoliaHit {
  objectID: string;
  title?: string;
  url?: string | null;
  points?: number;
  num_comments?: number;
  created_at?: string;
}

/** Decode the handful of HTML entities Algolia leaves in titles. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x2F;/gi, "/")
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#38;/g, "&")
    .replace(/&amp;/gi, "&")
    .replace(/&gt;/gi, ">")
    .replace(/&lt;/gi, "<");
}

/**
 * Split a "Show HN: Name – tagline" title into name + one-liner. Handles en/em
 * dash, hyphen, and colon separators; falls back to the whole string as name.
 */
export function parseShowHnTitle(title: string): { name: string; oneLiner: string } {
  const cleaned = decodeEntities(title).trim();
  const noPrefix = cleaned.replace(/^show\s+hn:?\s*/i, "").trim();
  const m = noPrefix.match(/^(.*?)(?:\s[–—-]\s|:\s)(.+)$/);
  if (m && m[1]!.trim()) {
    return { name: m[1]!.trim(), oneLiner: m[2]!.trim() };
  }
  return { name: noPrefix, oneLiner: "" };
}

/**
 * Map one Algolia hit to a validated Candidate, or null if it can't be a
 * candidate (no external URL, unparseable domain, or empty name).
 * `nowIso` is injectable so mapping is deterministic under test.
 */
export function mapHit(hit: AlgoliaHit, nowIso: string): Candidate | null {
  if (!hit.url) return null;
  const domain = canonicalDomain(hit.url);
  if (!domain) return null;

  const { name, oneLiner } = parseShowHnTitle(hit.title ?? "");
  if (!name) return null;

  const itemUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  const points = hit.points ?? 0;
  const comments = hit.num_comments ?? 0;
  const at = hit.created_at ?? nowIso;

  return Candidate.parse({
    domain,
    name,
    website: hit.url,
    oneLiner,
    sources: [{ source: "hackernews", url: itemUrl, discoveredAt: nowIso }],
    freshness: [
      {
        kind: "hn_traction",
        value: `${points} points, ${comments} comments`,
        url: itemUrl,
        at,
        magnitude: points,
      },
    ],
  });
}

export class HackerNewsSource implements Source {
  readonly name = "hackernews" as const;
  private readonly log = createLogger("source:hn");

  async fetch(query: SourceQuery): Promise<Candidate[]> {
    const params = new URLSearchParams({
      tags: "show_hn",
      hitsPerPage: String(query.limit ?? 20),
    });
    if (query.query) params.set("query", query.query);
    if (query.since) {
      const epoch = Math.floor(Date.parse(query.since) / 1000);
      if (!Number.isNaN(epoch)) params.set("numericFilters", `created_at_i>${epoch}`);
    }

    const url = `${ALGOLIA}/search?${params.toString()}`;
    this.log.info("fetching", { url });

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HN Algolia responded ${res.status}`);
    const body = (await res.json()) as { hits?: AlgoliaHit[] };
    const hits = body.hits ?? [];

    const nowIso = new Date().toISOString();
    const mapped: Candidate[] = [];
    for (const hit of hits) {
      try {
        const c = mapHit(hit, nowIso);
        if (c) mapped.push(c);
      } catch (err) {
        this.log.warn("skipped malformed hit", { objectID: hit.objectID, err: String(err) });
      }
    }

    // Dedup within this source by domain, keeping the highest-traction hit.
    const byDomain = new Map<string, Candidate>();
    for (const c of mapped) {
      const existing = byDomain.get(c.domain);
      const mag = c.freshness[0]?.magnitude ?? 0;
      const exMag = existing?.freshness[0]?.magnitude ?? 0;
      if (!existing || mag > exMag) byDomain.set(c.domain, c);
    }

    const out = [...byDomain.values()];
    this.log.info("fetched", { raw: hits.length, candidates: out.length });
    return out;
  }
}
