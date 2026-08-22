/**
 * Let a partner define their own scoring thesis in chat. Persists a profile to
 * ./profiles/<name>.json; afterwards `triage` can be called with that profile
 * name. Weights need not sum to 1 — they're normalized on load.
 */
import { defineTool } from "eve/tools";
import { z } from "zod";
import { saveProfile } from "../lib/scoring/profiles.ts";

export default defineTool({
  description:
    "Create or overwrite a thesis profile the partner can then use for scoring/verdict via triage's `profile` argument. " +
    "A profile sets dimension weights (team/product/market/risk/freshness), a thesis description, and a risk appetite. " +
    "It affects ONLY the score and verdict — never the analysis. Use it when a partner describes how THEY judge companies.",
  inputSchema: z.object({
    name: z.string().min(1).describe("Short profile name, e.g. 'fintech-conservative'."),
    description: z.string().describe("The thesis in prose — what this partner is looking for. Fed to the verdict step."),
    weights: z
      .object({
        team: z.number().nonnegative(),
        product: z.number().nonnegative(),
        market: z.number().nonnegative(),
        risk: z.number().nonnegative(),
        freshness: z.number().nonnegative(),
      })
      .describe("Relative importance of each dimension. Any nonnegative numbers; normalized on load."),
    riskAppetite: z
      .enum(["low", "med", "high"])
      .optional()
      .describe("How much unknown/risk the partner tolerates. low = needs de-risking; high = advances promising bets."),
  }),
  async execute({ name, description, weights, riskAppetite }) {
    const { profile, path } = saveProfile({ name, description, weights, riskAppetite: riskAppetite ?? "med" });
    return { saved: true, path, profile };
  },
  toModelOutput(out) {
    const w = out.profile.weights;
    return {
      type: "text",
      value:
        `Saved profile "${out.profile.name}" to ${out.path} (risk appetite: ${out.profile.riskAppetite}).\n` +
        `Normalized weights — team ${w.team.toFixed(2)}, product ${w.product.toFixed(2)}, market ${w.market.toFixed(2)}, risk ${w.risk.toFixed(2)}, freshness ${w.freshness.toFixed(2)}.\n` +
        `Use it with triage's profile="${out.profile.name}".`,
    };
  },
});
