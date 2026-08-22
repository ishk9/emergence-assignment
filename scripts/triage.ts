/**
 * Triage CLI — the "one command, memos out the other end" entrypoint.
 * Runs the full pipeline and writes one markdown memo per candidate to
 * ./memos/, plus an index.md ranking. Commit these so a reviewer reads the
 * outputs without re-running.
 *
 * Usage:
 *   node --env-file=.env scripts/triage.ts                 # latest HN+YC batch
 *   node --env-file=.env scripts/triage.ts "devtools"      # filter by topic
 *   node --env-file=.env scripts/triage.ts --urls https://linear.app https://vercel.com
 *   node --env-file=.env scripts/triage.ts --limit 5 "AI agents"
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { runTriage } from "../agent/lib/pipeline/triage.ts";
import { candidatesFromUrls } from "../agent/lib/sources/urls.ts";

const argv = process.argv.slice(2);
const urls: string[] = [];
let limit: number | undefined;
const words: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--urls") while (argv[i + 1] && !argv[i + 1].startsWith("--")) urls.push(argv[++i]);
  else if (argv[i] === "--limit") limit = Number(argv[++i]);
  else words.push(argv[i]);
}
const query = words.join(" ");

const results =
  urls.length > 0
    ? await runTriage("", { candidates: candidatesFromUrls(urls, new Date().toISOString()), limit: limit ?? urls.length })
    : await runTriage(query, { limit });

mkdirSync("memos", { recursive: true });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
for (const r of results) writeFileSync(`memos/${slug(r.candidate.domain)}.md`, r.memo);

const index =
  `# Triage — ${query || (urls.length ? `${urls.length} url(s)` : "latest batch")}\n\n` +
  results
    .map((r) => `- **${r.candidate.name}** — ${r.recommendation.verdict} · ${r.score.total}/100 — [memo](./${slug(r.candidate.domain)}.md)`)
    .join("\n") +
  "\n";
writeFileSync("memos/index.md", index);

console.log(`wrote ${results.length} memo(s) + index to ./memos/`);
for (const r of results) console.log(`  ${r.candidate.name}: ${r.recommendation.verdict} ${r.score.total} → memos/${slug(r.candidate.domain)}.md`);
