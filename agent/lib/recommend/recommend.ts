/**
 * Recommendation node: synthesize a Pass/Watch/Meeting verdict, a rationale,
 * and 3-4 counter-points that might change the partner's mind, grounded in the
 * dimension analyses and the algorithmic score. Pure synthesis — no web tools.
 *
 * The generateText call is injectable so prompt-building and validation are
 * unit-tested without a model; the live path is typecheck-guarded.
 */
import { generateText, Output } from "ai";
import { z } from "zod";
import { Recommendation, type Candidate, type DimensionResult, type Score } from "../types.ts";
import { createLogger } from "../logger.ts";
import { resolveModel } from "../llm/provider.ts";
import { BALANCED, type ThesisProfile } from "../scoring/profiles.ts";

const log = createLogger("recommend");

const SYSTEM = `You are a venture-capital partner making a triage decision for a
SPECIFIC investment thesis, provided in the prompt. Judge the startup THROUGH
that thesis and the stated risk appetite:
- low appetite  -> demand more de-risking; when in doubt, hold back (Pass/Watch).
- high appetite -> advance promising bets despite unknowns (lean Watch/Meeting).
Output:
- verdict: one of "Pass", "Watch", "Meeting".
- rationale: 2-4 sentences grounded in the analysis, the score, and the thesis.
- counterPoints: 3 to 4 points that might CHANGE your mind (steelman the opposite of your verdict — what would make you wrong).
Use the score as a signal, not a rule: ~>=70 leans "Meeting", 45-69 "Watch", <45 "Pass" — but shift these bands to match the thesis fit and risk appetite, and state your reason when you do.
Ground every claim in the provided analysis; do not invent facts.`;

/** Loose generation schema; counter-point count is clamped after. */
const GenSchema = z.object({
  verdict: z.enum(["Pass", "Watch", "Meeting"]),
  rationale: z.string(),
  counterPoints: z.array(z.string()),
});
type GenOutput = z.infer<typeof GenSchema>;

export type RunRecommend = (input: {
  system: string;
  prompt: string;
  correction?: string | null;
}) => Promise<GenOutput>;

export function buildPrompt(
  candidate: Candidate,
  results: DimensionResult[],
  score: Score,
  profile: ThesisProfile = BALANCED,
): string {
  const dims = results
    .map((r) => {
      const claims = r.claims.slice(0, 3).map((c) => `    • ${c.text} [${c.sourceUrl}]`).join("\n");
      return `${r.dimension.toUpperCase()}: ${r.findings}${claims ? `\n${claims}` : ""}`;
    })
    .join("\n\n");

  return `PARTNER THESIS (${profile.name}): ${profile.description || "(none stated)"}
RISK APPETITE: ${profile.riskAppetite}

Startup: ${candidate.name} (${candidate.website})
One-liner: ${candidate.oneLiner || "(none)"}

SCORE (weighted by this thesis): ${score.total}/100
Breakdown: ${score.explanation}

ANALYSIS:
${dims}`;
}

/** Clamp to 3-4 counter-points, then validate as a Recommendation. */
export function normalize(raw: GenOutput): Recommendation {
  return Recommendation.parse({
    verdict: raw.verdict,
    rationale: raw.rationale,
    counterPoints: raw.counterPoints.slice(0, 4),
  });
}

const defaultRun: RunRecommend = async ({ system, prompt, correction }) => {
  const model = await resolveModel();
  const finalPrompt = correction ? `${prompt}\n\n[CORRECTION]\n${correction}` : prompt;
  const { output } = await generateText({
    model,
    system,
    prompt: finalPrompt,
    output: Output.object({ schema: GenSchema }),
  });
  return output;
};

export async function recommend(
  candidate: Candidate,
  results: DimensionResult[],
  score: Score,
  profile: ThesisProfile = BALANCED,
  run: RunRecommend = defaultRun,
  correction: string | null = null,
): Promise<Recommendation> {
  log.info("recommending", { domain: candidate.domain, score: score.total, profile: profile.name });
  const raw = await run({ system: SYSTEM, prompt: buildPrompt(candidate, results, score, profile), correction });
  const rec = normalize(raw);
  log.info("recommended", { domain: candidate.domain, verdict: rec.verdict });
  return rec;
}
