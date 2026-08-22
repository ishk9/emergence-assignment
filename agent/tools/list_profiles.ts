/**
 * List the thesis profiles a partner can pass to `triage` — built-ins plus any
 * custom ones under ./profiles/.
 */
import { defineTool } from "eve/tools";
import { z } from "zod";
import { listProfiles, loadProfile } from "../lib/scoring/profiles.ts";

export default defineTool({
  description:
    "List the available thesis profiles (built-in + custom) that can be passed to triage's `profile` argument, with each one's risk appetite and description.",
  inputSchema: z.object({}),
  async execute() {
    const profiles = listProfiles().map((name) => {
      const p = loadProfile(name);
      return { name: p.name, riskAppetite: p.riskAppetite, description: p.description };
    });
    return { profiles };
  },
  toModelOutput(out) {
    const lines = out.profiles
      .map((p) => `- ${p.name} (risk: ${p.riskAppetite}) — ${p.description || "(no description)"}`)
      .join("\n");
    return { type: "text", value: `Available thesis profiles:\n${lines}` };
  },
});
