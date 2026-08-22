/**
 * Thesis profiles: per-partner scoring config. The scoring engine is generic;
 * the *thesis* is data. A profile sets the dimension weights (how the 0..100
 * score is composed) and a risk appetite + thesis description that steer the
 * (LLM) verdict — so two partners can score the same company differently without
 * any code change. Profiles NEVER touch the analysis subagents.
 *
 * Built-in profiles always exist; a partner can add/override by dropping a JSON
 * file in ./profiles/ (hand-written or via the create_profile tool). Weights
 * need not sum to 1 — they're normalized on load.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { createLogger } from "../logger.ts";
import { WEIGHTS_V1 } from "./weights.ts";

const log = createLogger("scoring:profiles");
const PROFILES_DIR = "profiles";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const ProfileWeights = z.object({
  team: z.number().nonnegative(),
  product: z.number().nonnegative(),
  market: z.number().nonnegative(),
  risk: z.number().nonnegative(),
  freshness: z.number().nonnegative(),
});

export const ThesisProfile = z.object({
  name: z.string().min(1),
  /** Thesis in prose — fed to the verdict LLM so it judges like this partner. */
  description: z.string().default(""),
  weights: ProfileWeights,
  /** Steers the verdict LLM: low = needs more de-risking to advance a company. */
  riskAppetite: z.enum(["low", "med", "high"]).default("med"),
});
export type ThesisProfile = z.infer<typeof ThesisProfile>;

/** Scale weights to sum to 1 so partners needn't do the math. */
export function normalizeProfile(p: ThesisProfile): ThesisProfile {
  const w = p.weights;
  const sum = w.team + w.product + w.market + w.risk + w.freshness;
  if (sum <= 0) return { ...p, weights: WEIGHTS_V1.weights };
  const n = (x: number) => x / sum;
  return {
    ...p,
    weights: { team: n(w.team), product: n(w.product), market: n(w.market), risk: n(w.risk), freshness: n(w.freshness) },
  };
}

const BUILTINS: Record<string, ThesisProfile> = {
  balanced: {
    name: "balanced",
    description: "Generalist seed thesis — no strong tilt across team/product/market; moderate risk tolerance.",
    weights: WEIGHTS_V1.weights,
    riskAppetite: "med",
  },
  conservative: {
    name: "conservative",
    description:
      "Capital-preservation lens — defensibility and risk weigh heavily; only clear, de-risked bets with a real moat clear the bar.",
    weights: { team: 0.3, product: 0.2, market: 0.15, risk: 0.3, freshness: 0.05 },
    riskAppetite: "low",
  },
  aggressive: {
    name: "aggressive",
    description:
      "Momentum lens — bet on exceptional technical teams and fast traction; tolerate high risk and unknowns for outsized upside.",
    weights: { team: 0.35, product: 0.25, market: 0.15, risk: 0.05, freshness: 0.2 },
    riskAppetite: "high",
  },
};

/** The default profile when a partner names none (today's v1 behavior). */
export const BALANCED = normalizeProfile(BUILTINS.balanced);

/** Built-in + custom (./profiles/*.json) profile names. */
export function listProfiles(): string[] {
  let custom: string[] = [];
  try {
    custom = readdirSync(PROFILES_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  } catch {
    // no profiles dir yet — built-ins only
  }
  return [...new Set([...Object.keys(BUILTINS), ...custom])].sort();
}

/**
 * Load a profile by name. A ./profiles/<name>.json file wins over a built-in of
 * the same name. No name -> the balanced default. Unknown name or malformed
 * file -> throw (the caller surfaces it; we never silently score with the wrong
 * thesis).
 */
export function loadProfile(name?: string): ThesisProfile {
  if (!name || !name.trim()) return BALANCED;
  const key = slug(name);
  try {
    const raw = readFileSync(`${PROFILES_DIR}/${key}.json`, "utf8");
    return normalizeProfile(ThesisProfile.parse(JSON.parse(raw)));
  } catch (err) {
    if ((err as { code?: string }).code !== "ENOENT") {
      throw new Error(`Profile "${name}" file is invalid: ${String((err as { message?: string }).message ?? err)}`);
    }
  }
  const builtin = BUILTINS[key];
  if (builtin) return normalizeProfile(builtin);
  throw new Error(`Unknown profile "${name}". Available: ${listProfiles().join(", ")}`);
}

/** Validate + persist a profile to ./profiles/<name>.json. */
export function saveProfile(input: unknown): { profile: ThesisProfile; path: string } {
  const profile = ThesisProfile.parse(input);
  mkdirSync(PROFILES_DIR, { recursive: true });
  const path = `${PROFILES_DIR}/${slug(profile.name)}.json`;
  writeFileSync(path, JSON.stringify(profile, null, 2));
  log.info("saved profile", { name: profile.name, path });
  return { profile, path };
}
