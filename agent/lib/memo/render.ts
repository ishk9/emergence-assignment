/**
 * Render a triage memo as markdown. Every claim is printed with its source
 * link, so a partner can verify each assertion — no uncited claims reach the
 * memo (the DimensionResult schema guarantees a sourceUrl per claim).
 */
import type { Candidate, DimensionResult, Recommendation, Score } from "../types.ts";

export interface MemoInput {
  candidate: Candidate;
  results: DimensionResult[];
  score: Score;
  recommendation: Recommendation;
}

const DIMENSION_ORDER: DimensionResult["dimension"][] = ["team", "product", "market", "risk"];

function renderDimension(r: DimensionResult): string {
  const claims = r.claims
    .map((c) => `- ${c.text} ([source](${c.sourceUrl}), ${c.confidence})`)
    .join("\n");
  const title = r.dimension.charAt(0).toUpperCase() + r.dimension.slice(1);
  return `### ${title}\n\n${r.findings || "_No findings._"}${claims ? `\n\n${claims}` : ""}`;
}

export function renderMemo(input: MemoInput): string {
  const { candidate, results, score, recommendation } = input;
  const s = score.subscores;

  const byDim = new Map(results.map((r) => [r.dimension, r]));
  const analysis = DIMENSION_ORDER.filter((d) => byDim.has(d))
    .map((d) => renderDimension(byDim.get(d)!))
    .join("\n\n");

  const counterPoints = recommendation.counterPoints.map((p) => `- ${p}`).join("\n");
  const signals = candidate.freshness.length
    ? candidate.freshness.map((f) => `- **${f.kind}**: ${f.value} ([link](${f.url}))`).join("\n")
    : "_None._";
  const sources = candidate.sources.map((sr) => `- **${sr.source}**: ${sr.url}`).join("\n");

  return `# ${candidate.name}

${candidate.oneLiner || "_No description._"}

${candidate.website}

## Verdict: ${recommendation.verdict}

${recommendation.rationale}

### What might change your mind

${counterPoints}

## Score: ${score.total}/100

Team ${s.team} · Product ${s.product} · Market ${s.market} · Risk ${s.risk} · Freshness ${s.freshness}

_${score.explanation}_

## Analysis

${analysis}

## Freshness signals

${signals}

## Sources

${sources}
`;
}
