/**
 * Scoring (Strategy pattern). A Scorer turns analysis results + candidate into
 * a deterministic 0..100 Score with a per-dimension breakdown and a
 * human-readable "why". v1 is a transparent weighted sum; a feedback-tuned
 * scorer can be swapped in later without touching the pipeline.
 */
import type { Candidate, DimensionResult, Score } from "../types.ts";
import { createLogger } from "../logger.ts";
import { extractSubscores, type Subscores } from "./features.ts";
import { WEIGHTS_V1, type WeightSet } from "./weights.ts";

const log = createLogger("scoring");

export interface Scorer {
  score(candidate: Candidate, results: DimensionResult[], nowMs: number): Score;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const to100 = (n: number) => round1(n * 100);

const LABELS: (keyof Subscores)[] = ["team", "product", "market", "risk", "freshness"];

export class WeightedScorer implements Scorer {
  private readonly weightSet: WeightSet;

  constructor(weightSet: WeightSet = WEIGHTS_V1) {
    this.weightSet = weightSet;
  }

  score(candidate: Candidate, results: DimensionResult[], nowMs: number): Score {
    const sub = extractSubscores(results, candidate, nowMs);
    const w = this.weightSet.weights;

    const total = to100(
      LABELS.reduce((sum, k) => sum + sub[k] * w[k], 0),
    );

    const subscores = {
      team: to100(sub.team),
      product: to100(sub.product),
      market: to100(sub.market),
      risk: to100(sub.risk),
      freshness: to100(sub.freshness),
    };

    const explanation =
      LABELS.map((k) => `${k} ${subscores[k]}×${w[k]}`).join(", ") +
      ` → ${total}/100 (weights ${this.weightSet.version})`;

    log.info("scored", { domain: candidate.domain, total, version: this.weightSet.version });
    return { total, subscores, weightsVersion: this.weightSet.version, explanation };
  }
}

/** Default scorer instance for the pipeline. */
export const defaultScorer = new WeightedScorer();
