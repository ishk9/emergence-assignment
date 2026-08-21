/**
 * Merge candidates across sources by canonical domain. The same startup found
 * on both HN and YC collapses into one Candidate carrying every source
 * reference and freshness signal, ordered so the strongest triage signals
 * (multi-source, high traction) come first.
 *
 * ponytail: dedup is by domain key only. A startup whose HN post links its
 * github repo but whose YC entry links its product domain has two different
 * keys and will NOT merge — accepted for v1 (see domain.ts eTLD ceiling).
 */
import type { Candidate, Signal, SourceRef } from "./types.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("normalize");

function dedupSources(refs: SourceRef[]): SourceRef[] {
  const seen = new Map<string, SourceRef>();
  for (const r of refs) seen.set(`${r.source}|${r.url}`, r);
  return [...seen.values()];
}

function dedupSignals(signals: Signal[]): Signal[] {
  const seen = new Map<string, Signal>();
  for (const s of signals) seen.set(`${s.kind}|${s.url}`, s);
  return [...seen.values()];
}

function totalMagnitude(signals: Signal[]): number {
  return signals.reduce((sum, s) => sum + (s.magnitude ?? 0), 0);
}

/** Merge one domain group into a single Candidate. */
function mergeGroup(group: Candidate[]): Candidate {
  const first = group[0]!;
  // Richest one-liner wins (longest non-empty); fall back to first.
  const oneLiner =
    group
      .map((c) => c.oneLiner.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0] ?? first.oneLiner;
  const name = group.map((c) => c.name.trim()).find(Boolean) ?? first.name;

  return {
    domain: first.domain,
    name,
    website: first.website,
    oneLiner,
    sources: dedupSources(group.flatMap((c) => c.sources)),
    freshness: dedupSignals(group.flatMap((c) => c.freshness)),
  };
}

export interface NormalizeOptions {
  /** Cap the output to the strongest N candidates. */
  limit?: number;
}

/**
 * Group candidates by domain, merge each group, and order by signal strength:
 * more distinct sources first, then higher total traction magnitude, then name
 * (for a deterministic, reproducible order).
 */
export function mergeCandidates(
  candidates: Candidate[],
  opts: NormalizeOptions = {},
): Candidate[] {
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const g = groups.get(c.domain);
    if (g) g.push(c);
    else groups.set(c.domain, [c]);
  }

  const merged = [...groups.values()].map(mergeGroup);
  merged.sort((a, b) => {
    if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
    const magDiff = totalMagnitude(b.freshness) - totalMagnitude(a.freshness);
    if (magDiff !== 0) return magDiff;
    return a.name.localeCompare(b.name);
  });

  const out = opts.limit ? merged.slice(0, opts.limit) : merged;
  log.info("merged", { input: candidates.length, unique: merged.length, returned: out.length });
  return out;
}
