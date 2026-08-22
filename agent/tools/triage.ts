/**
 * Model-facing `triage` tool. Two ways to drive it:
 *  - `query` (or nothing): source startups from HN + YC's latest batches.
 *  - `urls`: triage the specific companies at those URLs (skip sourcing).
 * Returns a scored Pass/Watch/Meeting recommendation + cited memo per candidate.
 */
import { defineTool } from "eve/tools";
import { z } from "zod";
import { runTriage } from "../lib/pipeline/triage.ts";
import { candidatesFromUrls } from "../lib/sources/urls.ts";

export default defineTool({
  description:
    "Source and triage promising startups from Hacker News and Y Combinator, OR triage specific " +
    "companies you pass as URLs. Returns a scored Pass/Watch/Meeting recommendation and a cited " +
    "memo per candidate. This is a slow, expensive operation — call it ONCE per request and wait; " +
    "do not retry with different phrasings. Omit `query` to scan the latest batch broadly; pass " +
    "`query` to filter by a topic keyword; pass `urls` to analyze specific companies directly.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe("Optional topic keyword to filter sourced startups. Omit for the latest batch."),
    urls: z
      .array(z.string())
      .optional()
      .describe("Optional list of company URLs to triage directly instead of sourcing."),
    limit: z.number().int().min(1).max(20).optional().describe("Max candidates to triage (default 15)"),
  }),
  async execute({ query, urls, limit }) {
    const results =
      urls && urls.length > 0
        ? await runTriage("", {
            candidates: candidatesFromUrls(urls, new Date().toISOString()),
            limit: limit ?? urls.length,
          })
        : await runTriage(query ?? "", { limit });

    return {
      query: query ?? (urls?.length ? `${urls.length} url(s)` : "latest batch"),
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
    if (out.count === 0) {
      return { type: "text", value: `No candidates found for "${out.query}".` };
    }
    const ranked = out.candidates
      .map((c) => `- ${c.name} (${c.domain}): ${c.verdict} — ${c.score}/100`)
      .join("\n");
    // Include the full memos verbatim so the model presents THEM (cited,
    // structured) instead of improvising prose from its own knowledge.
    const memos = out.candidates.map((c) => c.memo).join("\n\n---\n\n");
    return {
      type: "text",
      value: `Triaged ${out.count} candidates for "${out.query}" (ranked):\n${ranked}\n\n# Memos\n\n${memos}`,
    };
  },
});
