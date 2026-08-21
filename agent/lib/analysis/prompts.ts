/**
 * Per-dimension analyst prompts. Each dimension is researched independently by
 * a web-research loop. Prompts enforce the provenance rule (cite only fetched/
 * searched URLs; omit or low-confidence anything uncitable — never invent
 * numbers) and ask for the structured `features` the algorithmic scorer reads.
 */
import type { Candidate, Dimension } from "../types.ts";

const PROVENANCE = `
Rules:
- Use web_search and web_fetch to research. Start by fetching the known source URLs.
- Every claim MUST include a sourceUrl you actually fetched or that web_search returned. If you cannot find and cite a fact, omit it or mark it low confidence. NEVER invent numbers (market size, funding, headcount) — cite them or leave them out.
- Keep findings concise and specific to this startup.`.trim();

const DIMENSION_GUIDE: Record<Dimension, string> = {
  team: `Assess the TEAM: founder backgrounds, prior exits, technical depth, founder-market fit, who does what and each member's strengths/weaknesses.
Fill features with: priorExits (number), technicalDepth ("low"|"med"|"high"), founderMarketFit ("low"|"med"|"high").`,
  product: `Assess the PRODUCT: what it actually does, how it works, the technology used, differentiation, any technical moat, and maturity stage.
Fill features with: differentiation ("low"|"med"|"high"), technicalMoat ("low"|"med"|"high"), stage ("idea"|"beta"|"launched"|"scaling").`,
  market: `Assess the MARKET: market size (cite sources or say unknown), existing players and their share, product-market fit signals, and timing.
Fill features with: marketSize ("small"|"medium"|"large"|"unknown"), competition ("low"|"med"|"high"), timing ("poor"|"fair"|"strong").`,
  risk: `Assess the RISKS: competition, what is hurting the product now, funding/economic/geopolitical exposure, execution and defensibility risks.
Fill features with: overallRisk ("low"|"med"|"high"), mainRisk (short string).`,
};

export function systemPrompt(dimension: Dimension): string {
  return `You are a venture-capital analyst producing the ${dimension.toUpperCase()} section of a triage memo.
${DIMENSION_GUIDE[dimension]}

${PROVENANCE}`;
}

/** The seed grounding + URLs the analyst should fetch first. */
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
