/**
 * Versioned scoring weights. Kept separate + versioned so the feedback loop can
 * later ship tuned weight sets (and every Score records which version produced
 * it, for auditability). Weights must sum to 1.
 */
import type { Subscores } from "./features.ts";

export interface WeightSet {
  version: string;
  weights: Subscores;
}

export const WEIGHTS_V1: WeightSet = {
  version: "v1",
  weights: {
    team: 0.3,
    product: 0.25,
    market: 0.2,
    risk: 0.15,
    freshness: 0.1,
  },
};
