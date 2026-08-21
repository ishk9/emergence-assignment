/**
 * Enrichment orchestrator: github activity for repo-hosted candidates,
 * website one-liner backfill otherwise. Best-effort and idempotent — never
 * throws, always returns a (possibly unchanged) Candidate.
 */
import type { Candidate } from "../types.ts";
import { createLogger } from "../logger.ts";
import { enrichFromGithub, repoFromDomain } from "./github.ts";
import { enrichFromWebsite } from "./website.ts";

const log = createLogger("enrich");

export async function enrichCandidate(candidate: Candidate, nowIso: string): Promise<Candidate> {
  if (repoFromDomain(candidate.domain)) {
    return enrichFromGithub(candidate, nowIso);
  }
  return enrichFromWebsite(candidate);
}

/** Enrich a batch concurrently. */
export async function enrichAll(candidates: Candidate[], nowIso: string): Promise<Candidate[]> {
  const out = await Promise.all(candidates.map((c) => enrichCandidate(c, nowIso)));
  log.info("enriched batch", { count: out.length });
  return out;
}

export { enrichFromGithub, enrichFromWebsite };
