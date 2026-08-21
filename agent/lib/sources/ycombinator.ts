/**
 * Y Combinator source adapter (Adapter pattern). Uses the public, community-
 * maintained yc-oss/api JSON (no key, stable schema) instead of YC's own
 * Algolia-gated directory. Pulls the most recent batches so the freshness
 * signal (batch + status) reflects newly-funded companies.
 *
 * Pure `mapCompany` is separated from IO (`fetch`) for network-free testing.
 */
import { Candidate, type Source, type SourceQuery } from "../types.ts";
import { canonicalDomain } from "../domain.ts";
import { createLogger } from "../logger.ts";

const META_URL = "https://yc-oss.github.io/api/meta.json";
/** How many trailing batches count as "recent" for sourcing. */
const RECENT_BATCHES = 3;

/** The subset of the yc-oss company shape we consume. */
export interface YcCompany {
  name?: string;
  slug?: string;
  website?: string | null;
  one_liner?: string;
  industry?: string;
  tags?: string[];
  team_size?: number | null;
  batch?: string;
  status?: string;
  /** Epoch seconds. */
  launched_at?: number;
  /** YC profile URL. */
  url?: string;
}

/** Lowercased text blob for client-side query filtering. */
function haystack(co: YcCompany): string {
  return [co.name, co.one_liner, co.industry, ...(co.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Map one YC company to a validated Candidate, or null if it can't be a
 * candidate (no website, unparseable domain, or missing name). `nowIso` is
 * injectable so mapping is deterministic under test.
 */
export function mapCompany(co: YcCompany, nowIso: string): Candidate | null {
  if (!co.website) return null;
  const domain = canonicalDomain(co.website);
  if (!domain) return null;

  const name = (co.name ?? "").trim();
  if (!name) return null;

  const profile = co.url ?? `https://www.ycombinator.com/companies/${co.slug ?? ""}`;
  const at =
    typeof co.launched_at === "number" && co.launched_at > 0
      ? new Date(co.launched_at * 1000).toISOString()
      : nowIso;
  const batchLabel = co.batch ?? "YC";
  const statusPart = co.status ? ` · ${co.status}` : "";
  // yc-oss sends null (not absent) team_size for some companies; z.number()
  // .optional() rejects null, so normalize it to undefined.
  const teamSize = typeof co.team_size === "number" ? co.team_size : undefined;

  return Candidate.parse({
    domain,
    name,
    website: co.website,
    oneLiner: (co.one_liner ?? "").trim(),
    sources: [{ source: "ycombinator", url: profile, discoveredAt: nowIso }],
    freshness: [
      {
        kind: "launch",
        value: `YC ${batchLabel}${statusPart}`,
        url: profile,
        at,
        magnitude: teamSize,
      },
    ],
  });
}

export class YCombinatorSource implements Source {
  readonly name = "ycombinator" as const;
  private readonly log = createLogger("source:yc");

  async fetch(query: SourceQuery): Promise<Candidate[]> {
    const metaRes = await fetch(META_URL);
    if (!metaRes.ok) throw new Error(`yc-oss meta responded ${metaRes.status}`);
    const meta = (await metaRes.json()) as { batches?: Record<string, { api?: string }> };

    const slugs = Object.keys(meta.batches ?? {}).filter((s) => s !== "unspecified");
    const chosen = slugs.slice(-RECENT_BATCHES);
    this.log.info("selected batches", { batches: chosen });

    const lists = await Promise.all(
      chosen.map(async (slug) => {
        const api = meta.batches?.[slug]?.api ?? `https://yc-oss.github.io/api/batches/${slug}.json`;
        const res = await fetch(api);
        if (!res.ok) {
          this.log.warn("batch fetch failed", { slug, status: res.status });
          return [] as YcCompany[];
        }
        return (await res.json()) as YcCompany[];
      }),
    );

    let companies = lists.flat();
    if (query.query) {
      const q = query.query.toLowerCase();
      companies = companies.filter((c) => haystack(c).includes(q));
    }
    if (query.since) {
      const epoch = Math.floor(Date.parse(query.since) / 1000);
      if (!Number.isNaN(epoch)) {
        companies = companies.filter((c) => (c.launched_at ?? 0) >= epoch);
      }
    }

    const nowIso = new Date().toISOString();
    const mapped: Candidate[] = [];
    for (const co of companies) {
      try {
        const cand = mapCompany(co, nowIso);
        if (cand) mapped.push(cand);
      } catch (err) {
        this.log.warn("skipped malformed company", { slug: co.slug, err: String(err) });
      }
    }

    const byDomain = new Map<string, Candidate>();
    for (const c of mapped) if (!byDomain.has(c.domain)) byDomain.set(c.domain, c);

    const out = [...byDomain.values()].slice(0, query.limit ?? 20);
    this.log.info("fetched", { companies: companies.length, candidates: out.length });
    return out;
  }
}
