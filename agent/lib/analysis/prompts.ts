/**
 * Prompts for the two-stage analysis: ONE web-research pass per company, then a
 * cheap structured extraction into all four dimensions. Splitting research
 * (expensive, tool-driven) from extraction (a plain generateObject) is what
 * keeps cost down and eliminates the "could not parse" failures that came from
 * forcing structured output inside the tool loop.
 */
import type { Candidate } from "../types.ts";

/** System prompt for the single research pass. */
export function researchSystem(): string {
  return `You are a venture-capital analyst researching one startup for a triage memo.
Use web_search and web_fetch to gather facts about the company across four areas:
- TEAM: founders, backgrounds, prior exits, technical depth, founder-market fit.
- PRODUCT: what it does, how it works, technology, differentiation, maturity.
- MARKET: size, competitors, product-market fit, timing.
- RISK: competition, execution, funding/economic exposure, defensibility.

Be efficient: a few targeted searches are enough — do NOT exhaustively search.
Write concise notes with the concrete facts you found and, inline, the URL each
fact came from. Never invent numbers (funding, market size, headcount) — only
report what you actually found and can attribute to a source.`;
}

/** System prompt for the structured extraction (no tools). */
export function extractionSystem(): string {
  return `You convert research notes into a structured triage analysis. For each
of team, product, market, and risk: write concise findings, list the cited
claims (each with the sourceUrl it came from), and fill the required feature
fields. Cite ONLY URLs that appear in the research notes or the provided source
list. If a fact was not found, choose the most conservative feature value and
omit the claim — never fabricate a citation or a number.`;
}

/** The seed grounding + known source URLs for the research pass. */
export function buildContext(candidate: Candidate): string {
  const sources = candidate.sources.map((s) => `- ${s.source}: ${s.url}`).join("\n");
  const signals = candidate.freshness.map((f) => `- ${f.kind}: ${f.value} (${f.url})`).join("\n");
  return `Startup: ${candidate.name}
Website: ${candidate.website}
One-liner: ${candidate.oneLiner || "(none)"}

Known sources (fetch these first):
${sources || "(none)"}

Freshness / traction signals:
${signals || "(none)"}`;
}

/** Prompt for the extraction step: research notes + the URLs that may be cited. */
export function extractionPrompt(candidate: Candidate, notes: string, sources: string[]): string {
  const cite = sources.length ? sources.map((u) => `- ${u}`).join("\n") : "(only URLs appearing in the notes)";
  return `Startup: ${candidate.name} (${candidate.website})

Research notes:
${notes || "(research produced no notes — use only the known source URLs, keep confidence low)"}

Citable source URLs:
${cite}`;
}
