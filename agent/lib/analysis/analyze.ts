/**
 * Analysis: ONE web-research pass per company, then a single structured
 * extraction into all four dimensions. This replaces the old four-loops-per-
 * company design that made each query ~4x more expensive and threw "could not
 * parse" errors (structured output forced inside the tool loop). Now the
 * expensive research runs once; the cheap generateObject extraction is what the
 * self-correcting retry wraps, so a retry costs pennies, not another web crawl.
 *
 * `research` and `extract` are injectable so the logic is unit-tested without a
 * model or network.
 */
import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";
import { Claim, DimensionResult, type Candidate, type Dimension } from "../types.ts";
import { createLogger } from "../logger.ts";
import { loadLlmConfig, resolveModel } from "../llm/provider.ts";
import { researchToolsFor } from "../llm/tools.ts";
import { withCorrectiveRetry } from "../retry/withCorrectiveRetry.ts";
import { buildContext, extractionPrompt, extractionSystem, researchSystem } from "./prompts.ts";

const log = createLogger("analysis");

/** Max tool-calling steps in the single research pass (bounds cost). */
const RESEARCH_STEPS = 6;

const conf = z.enum(["low", "med", "high"]);

const ClaimBlock = z.array(
  z.object({ text: z.string(), sourceUrl: z.string(), confidence: conf }),
);

/** Required per-dimension features force the model to fill the numbers the
 *  (LLM-free) scorer consumes — fixing the old empty-features scoring. */
const ExtractionSchema = z.object({
  team: z.object({
    findings: z.string(),
    claims: ClaimBlock,
    features: z.object({
      priorExits: z.number(),
      technicalDepth: conf,
      founderMarketFit: conf,
    }),
  }),
  product: z.object({
    findings: z.string(),
    claims: ClaimBlock,
    features: z.object({
      differentiation: conf,
      technicalMoat: conf,
      stage: z.enum(["idea", "beta", "launched", "scaling"]),
    }),
  }),
  market: z.object({
    findings: z.string(),
    claims: ClaimBlock,
    features: z.object({
      marketSize: z.enum(["small", "medium", "large", "unknown"]),
      competition: conf,
      timing: z.enum(["poor", "fair", "strong"]),
    }),
  }),
  risk: z.object({
    findings: z.string(),
    claims: ClaimBlock,
    features: z.object({ overallRisk: conf, mainRisk: z.string() }),
  }),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export interface ResearchResult {
  notes: string;
  sources: string[];
}

export type ResearchFn = (candidate: Candidate) => Promise<ResearchResult>;
export type ExtractFn = (input: {
  candidate: Candidate;
  notes: string;
  sources: string[];
  correction?: string | null;
}) => Promise<Extraction>;

export interface AnalyzeDeps {
  research?: ResearchFn;
  extract?: ExtractFn;
  sleep?: (ms: number) => Promise<void>;
}

const DIMENSIONS: readonly Dimension[] = ["team", "product", "market", "risk"];

const defaultResearch: ResearchFn = async (candidate) => {
  const config = loadLlmConfig();
  const model = await resolveModel(config);
  const tools = await researchToolsFor(config);
  const res = await generateText({
    model,
    tools,
    stopWhen: stepCountIs(RESEARCH_STEPS),
    system: researchSystem(),
    prompt: buildContext(candidate),
  });
  const sources = (res.sources ?? [])
    .map((s) => (s as { url?: string }).url)
    .filter((u): u is string => Boolean(u));
  return { notes: res.text, sources };
};

const defaultExtract: ExtractFn = async ({ candidate, notes, sources, correction }) => {
  const config = loadLlmConfig();
  const model = await resolveModel(config);
  const prompt =
    extractionPrompt(candidate, notes, sources) +
    (correction ? `\n\n[CORRECTION]\n${correction}` : "");
  // No tools here — a single-shot structured completion is reliable and cheap.
  const { output } = await generateText({
    model,
    system: extractionSystem(),
    prompt,
    output: Output.object({ schema: ExtractionSchema }),
  });
  return output;
};

/** Build a validated DimensionResult from one extraction block, dropping any
 *  claim without a valid (URL-bearing) citation. */
export function toDimensionResult(
  dimension: Dimension,
  block: Extraction[Dimension],
): DimensionResult {
  const claims = block.claims.filter((c) => Claim.safeParse(c).success);
  const dropped = block.claims.length - claims.length;
  if (dropped > 0) log.warn("dropped uncited claims", { dimension, dropped });
  return DimensionResult.parse({
    dimension,
    findings: block.findings,
    claims,
    features: block.features,
  });
}

/** Neutral fallback when extraction can't be produced — keeps the pipeline
 *  running; scores land mid-range and the memo shows no findings. */
function degradedExtraction(): Extraction {
  const na = "Analysis unavailable (extraction failed).";
  return {
    team: { findings: na, claims: [], features: { priorExits: 0, technicalDepth: "med", founderMarketFit: "med" } },
    product: { findings: na, claims: [], features: { differentiation: "med", technicalMoat: "med", stage: "beta" } },
    market: { findings: na, claims: [], features: { marketSize: "unknown", competition: "med", timing: "fair" } },
    risk: { findings: na, claims: [], features: { overallRisk: "med", mainRisk: "unknown" } },
  };
}

/** Research once, extract all four dimensions, return four DimensionResults. */
export async function analyzeCandidate(
  candidate: Candidate,
  deps: AnalyzeDeps = {},
): Promise<DimensionResult[]> {
  const research = deps.research ?? defaultResearch;
  const extract = deps.extract ?? defaultExtract;

  log.info("researching", { domain: candidate.domain });
  // Research is the expensive call; retry transient network failures ("fetch
  // failed", timeouts) with backoff instead of losing the whole pass. On
  // exhaustion, fall back to the candidate's known URLs so extraction still runs.
  const researched = await withCorrectiveRetry<ResearchResult>(() => research(candidate), {
    label: `research:${candidate.domain}`,
    maxAttempts: 2,
    sleep: deps.sleep,
    onExhausted: () => ({ notes: "", sources: candidate.sources.map((s) => s.url) }),
  });

  const extraction = await withCorrectiveRetry<Extraction>(
    (correction) =>
      extract({ candidate, notes: researched.notes, sources: researched.sources, correction }),
    {
      label: `extract:${candidate.domain}`,
      maxAttempts: 2,
      sleep: deps.sleep,
      validate: (x) =>
        x?.team?.findings?.trim() ? { ok: true } : { ok: false, reason: "missing dimension findings" },
      onExhausted: () => degradedExtraction(),
    },
  );

  const results = DIMENSIONS.map((d) => toDimensionResult(d, extraction[d]));
  log.info("analyzed", {
    domain: candidate.domain,
    claims: results.reduce((n, r) => n + r.claims.length, 0),
  });
  return results;
}
