/**
 * Analysis node: research one dimension of a candidate with a web-research loop
 * and return a validated, cited DimensionResult. Runs the four dimensions in
 * parallel.
 *
 * The `run` step (the actual generateText call) is injectable so the
 * wrapping/validation logic is unit-tested without a model or network; the
 * default implementation resolves the pluggable provider and drives the loop.
 */
import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";
import { Claim, DimensionResult, type Candidate, type Dimension } from "../types.ts";
import { createLogger } from "../logger.ts";
import { resolveModel } from "../llm/provider.ts";
import { researchTools } from "../llm/tools.ts";
import { buildContext, systemPrompt } from "./prompts.ts";

const log = createLogger("analysis");

const ALL_DIMENSIONS: readonly Dimension[] = ["team", "product", "market", "risk"];

/** Permissive model-output schema. Claim URLs are validated (strictly) after,
 *  so a single bad citation is dropped rather than failing the whole call. */
const AnalysisOutput = z.object({
  findings: z.string(),
  claims: z.array(
    z.object({
      text: z.string(),
      sourceUrl: z.string(),
      confidence: z.enum(["low", "med", "high"]),
    }),
  ),
  features: z.record(z.string(), z.union([z.number(), z.string()])),
});
export type AnalysisOutput = z.infer<typeof AnalysisOutput>;

/** The injectable research step: system + context (+ optional corrective note
 *  from the retry layer) -> raw analysis output. */
export type RunAnalysis = (input: {
  system: string;
  context: string;
  correction?: string | null;
}) => Promise<AnalysisOutput>;

/** How many tool-calling steps the research loop may take per dimension. */
const MAX_STEPS = 8;

const defaultRun: RunAnalysis = async ({ system, context, correction }) => {
  const model = await resolveModel();
  const prompt = correction ? `${context}\n\n[CORRECTION]\n${correction}` : context;
  const { output } = await generateText({
    model,
    system,
    prompt,
    tools: researchTools,
    stopWhen: stepCountIs(MAX_STEPS),
    output: Output.object({ schema: AnalysisOutput }),
  });
  return output;
};

/** Wrap raw model output into a validated DimensionResult, dropping any claim
 *  that lacks a valid (URL-bearing) citation. Provenance enforced here. */
export function toDimensionResult(dimension: Dimension, output: AnalysisOutput): DimensionResult {
  const claims = output.claims.filter((c) => Claim.safeParse(c).success);
  const dropped = output.claims.length - claims.length;
  if (dropped > 0) log.warn("dropped uncited claims", { dimension, dropped });
  return DimensionResult.parse({
    dimension,
    findings: output.findings,
    claims,
    features: output.features,
  });
}

export async function analyzeDimension(
  candidate: Candidate,
  dimension: Dimension,
  run: RunAnalysis = defaultRun,
  correction: string | null = null,
): Promise<DimensionResult> {
  log.info("analyzing", { domain: candidate.domain, dimension });
  const output = await run({
    system: systemPrompt(dimension),
    context: buildContext(candidate),
    correction,
  });
  const result = toDimensionResult(dimension, output);
  log.info("analyzed", { domain: candidate.domain, dimension, claims: result.claims.length });
  return result;
}

/** Run all four dimensions in parallel for one candidate. */
export async function analyzeCandidate(
  candidate: Candidate,
  run: RunAnalysis = defaultRun,
): Promise<DimensionResult[]> {
  return Promise.all(ALL_DIMENSIONS.map((d) => analyzeDimension(candidate, d, run)));
}
