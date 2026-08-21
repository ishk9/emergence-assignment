/**
 * Model-facing `triage` tool: runs the deterministic triage pipeline for a
 * topic and returns a scored Pass/Watch/Meeting memo per candidate. The model
 * sees a compact ranked summary; channels/clients get the full memos.
 */
import { defineTool } from "eve/tools";
import { z } from "zod";
import { runTriage } from "../lib/pipeline/triage.ts";

export default defineTool({
  description:
    "Source and triage promising startups from Hacker News and Y Combinator's latest batches. " +
    "Returns a scored Pass/Watch/Meeting recommendation and a cited memo per candidate. " +
    "This is a slow, expensive operation that researches each candidate across four dimensions — " +
    "call it ONCE per request and wait; do not retry with different phrasings. " +
    "Omit `query` to scan the latest batch broadly; pass `query` only to filter by a topic keyword " +
    "(e.g. 'payments', 'devtools') that would appear in a company's name or description.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe("Optional topic keyword to filter by. Omit for the latest batch / a random sample."),
    limit: z.number().int().min(1).max(20).optional().describe("Max candidates to triage (default 15)"),
  }),
  async execute({ query, limit }) {
    const results = await runTriage(query ?? "", { limit });
    return {
      query,
      count: results.length,
      candidates: results.map((r) => ({
        name: r.candidate.name,
        domain: r.candidate.domain,
        website: r.candidate.website,
        verdict: r.recommendation.verdict,
        score: r.score.total,
        memo: r.memo,
      })),
    };
  },
  toModelOutput(out) {
    const lines = out.candidates
      .map((c) => `- ${c.name} (${c.domain}): ${c.verdict} — ${c.score}/100`)
      .join("\n");
    return {
      type: "text",
      value: `Triaged ${out.count} candidates for "${out.query}" (ranked):\n${lines || "(none found)"}`,
    };
  },
});
