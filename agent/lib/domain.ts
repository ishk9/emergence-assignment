/**
 * Canonical domain key for dedup. The same startup surfacing on multiple
 * sources must resolve to one key so normalize/merge collapses them.
 *
 * ponytail: naive host normalization — strips a leading `www.` but does NOT
 * compute the registrable eTLD+1 (no public-suffix list). Subdomains of the
 * same site therefore won't merge (app.acme.com ≠ acme.com). Upgrade to a
 * public-suffix parser if cross-subdomain dedup matters.
 */

/**
 * Hosts that serve many unrelated projects under one domain. Keying by bare
 * host would wrongly merge every github Show HN into one candidate, so we
 * include the owner/repo path segment for these.
 */
const CODE_HOSTS = new Set([
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "sourceforge.net",
  "gitea.com",
]);

/** Returns a lowercase canonical key, or null if the URL can't be parsed. */
export function canonicalDomain(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!host) return null;

  if (CODE_HOSTS.has(host)) {
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length >= 2) return `${host}/${segs[0]}/${segs[1]}`.toLowerCase();
    if (segs.length === 1) return `${host}/${segs[0]}`.toLowerCase();
  }
  return host;
}
