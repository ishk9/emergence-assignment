/**
 * Sample run: source 2 companies from YC's recent batches and run the full
 * triage pipeline, dumping every subagent output (the 4 dimension analyses),
 * the algorithmic score, the recommendation, and the rendered memo to
 * ./sample-run.json at the repo root so each stage is inspectable.
 *
 * Run: node --env-file=.env scripts/sample-run.ts
 */
import { writeFileSync } from "node:fs";
import { YCombinatorSource } from "../agent/lib/sources/ycombinator.ts";
import { runTriage } from "../agent/lib/pipeline/triage.ts";

const LIMIT = 2;

const results = await runTriage("", {
  sources: [new YCombinatorSource()],
  perSourceLimit: 40, // pull a chunk of recent-batch companies...
  limit: LIMIT, //         ...then keep the top LIMIT after dedup/ranking
});

const dump = results.map((r) => ({
  candidate: r.candidate,
  score: r.score,
  recommendation: r.recommendation,
  analysis: r.analysis, // one entry per dimension subagent (team/product/market/risk)
  memo: r.memo,
}));

writeFileSync("sample-run.json", JSON.stringify(dump, null, 2));
console.log(
  `wrote sample-run.json — ${dump.length} companies: ` +
    dump.map((d) => `${d.candidate.name} (${d.recommendation.verdict} ${d.score.total})`).join(", "),
);
