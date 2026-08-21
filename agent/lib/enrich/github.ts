/**
 * GitHub enrichment. For candidates whose canonical domain is a github repo,
 * fetch deterministic activity (stars, last push, language) and attach it as a
 * github_activity freshness signal the algorithmic scorer can trust — unlike an
 * LLM-guessed star count. Also backfills an empty one-liner from the repo
 * description.
 *
 * Pure `repoFromDomain`/`parseRepo`/`applyRepo` are split from the IO fetch.
 */
import type { Candidate, Signal } from "../types.ts";
import { createLogger } from "../logger.ts";

const log = createLogger("enrich:github");

/** Raw subset of the GitHub repos API response. */
export interface RepoRaw {
  stargazers_count?: number;
  pushed_at?: string;
  language?: string | null;
  description?: string | null;
  html_url?: string;
}

export interface RepoInfo {
  stars: number;
  pushedAt?: string;
  language?: string;
  description?: string;
  url?: string;
}

/** Extract {owner, repo} from a "github.com/owner/repo" canonical domain. */
export function repoFromDomain(domain: string): { owner: string; repo: string } | null {
  const m = domain.match(/^github\.com\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]! };
}

export function parseRepo(raw: RepoRaw): RepoInfo {
  return {
    stars: raw.stargazers_count ?? 0,
    pushedAt: raw.pushed_at,
    language: raw.language ?? undefined,
    description: raw.description ?? undefined,
    url: raw.html_url,
  };
}

/** Attach a github_activity signal and backfill one-liner. Pure. */
export function applyRepo(candidate: Candidate, info: RepoInfo, nowIso: string): Candidate {
  const url = info.url ?? candidate.website;
  const signal: Signal = {
    kind: "github_activity",
    value: `${info.stars} stars${info.language ? `, ${info.language}` : ""}`,
    url,
    at: info.pushedAt ?? nowIso,
    magnitude: info.stars,
  };
  const freshness = candidate.freshness.some((s) => s.kind === signal.kind && s.url === signal.url)
    ? candidate.freshness
    : [...candidate.freshness, signal];
  const oneLiner = candidate.oneLiner.trim() || (info.description ?? "").trim();
  return { ...candidate, oneLiner, freshness };
}

async function fetchRepo(owner: string, repo: string): Promise<RepoRaw> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "emergence-triage",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);
  return (await res.json()) as RepoRaw;
}

/** Best-effort: returns the enriched candidate, or the original on failure. */
export async function enrichFromGithub(candidate: Candidate, nowIso: string): Promise<Candidate> {
  const parsed = repoFromDomain(candidate.domain);
  if (!parsed) return candidate;
  try {
    const info = parseRepo(await fetchRepo(parsed.owner, parsed.repo));
    log.info("enriched", { domain: candidate.domain, stars: info.stars });
    return applyRepo(candidate, info, nowIso);
  } catch (err) {
    log.warn("github enrichment failed", { domain: candidate.domain, err: String(err) });
    return candidate;
  }
}
