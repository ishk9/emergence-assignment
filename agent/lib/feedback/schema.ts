/**
 * SCAFFOLD — partner-verdict capture. Types + an in-memory store only; NOT
 * wired into the pipeline this round. This is the hook for the compound
 * feedback loop: persist partner decisions, then use them to (a) tune scoring
 * weights toward partner taste and (b) build the eval golden set.
 * See plans/startup-triage-pipeline.md "Deferred".
 */
import { z } from "zod";
import { Verdict } from "../types.ts";

/** What actually happened after triage (fills in over time). */
export const Outcome = z.enum(["tracking", "met", "invested", "passed"]);
export type Outcome = z.infer<typeof Outcome>;

export const PartnerVerdict = z.object({
  domain: z.string().min(1),
  candidateName: z.string(),
  query: z.string(),
  /** What the pipeline recommended. */
  aiVerdict: Verdict,
  /** What the partner decided. */
  partnerVerdict: Verdict,
  outcome: Outcome.optional(),
  note: z.string().optional(),
  at: z.iso.datetime(),
});
export type PartnerVerdict = z.infer<typeof PartnerVerdict>;

export interface FeedbackStore {
  record(v: PartnerVerdict): Promise<void>;
  all(): Promise<PartnerVerdict[]>;
}

/** SCAFFOLD store — swap for a persistent one when the loop is wired. */
export class InMemoryFeedbackStore implements FeedbackStore {
  private items: PartnerVerdict[] = [];
  async record(v: PartnerVerdict): Promise<void> {
    this.items.push(PartnerVerdict.parse(v));
  }
  async all(): Promise<PartnerVerdict[]> {
    return [...this.items];
  }
}
