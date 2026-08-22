import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { BALANCED, listProfiles, loadProfile, normalizeProfile, saveProfile } from "./profiles.ts";

test("built-in profiles load and their weights sum to 1", () => {
  for (const name of ["balanced", "conservative", "aggressive"]) {
    const p = loadProfile(name);
    const w = p.weights;
    const sum = w.team + w.product + w.market + w.risk + w.freshness;
    assert.ok(Math.abs(sum - 1) < 1e-9, `${name} weights sum to ${sum}`);
  }
});

test("no name -> balanced default", () => {
  assert.equal(loadProfile().name, "balanced");
  assert.equal(loadProfile("").name, BALANCED.name);
});

test("risk appetite differs across built-ins", () => {
  assert.equal(loadProfile("conservative").riskAppetite, "low");
  assert.equal(loadProfile("aggressive").riskAppetite, "high");
});

test("normalizeProfile scales arbitrary weights to sum 1", () => {
  const p = normalizeProfile({
    name: "x",
    description: "",
    weights: { team: 2, product: 2, market: 2, risk: 2, freshness: 2 },
    riskAppetite: "med",
  });
  assert.ok(Math.abs(p.weights.team - 0.2) < 1e-9);
});

test("unknown profile throws with the available list", () => {
  assert.throws(() => loadProfile("does-not-exist"), /Unknown profile.*Available:/);
});

test("saveProfile round-trips and appears in listProfiles", () => {
  const name = "test-tmp-profile";
  try {
    const { profile, path } = saveProfile({
      name,
      description: "unit test",
      weights: { team: 1, product: 1, market: 1, risk: 1, freshness: 1 },
      riskAppetite: "high",
    });
    assert.match(path, /profiles\/test-tmp-profile\.json$/);
    assert.equal(profile.riskAppetite, "high");
    assert.ok(listProfiles().includes(name));
    const loaded = loadProfile(name);
    assert.equal(loaded.description, "unit test");
    assert.ok(Math.abs(loaded.weights.team - 0.2) < 1e-9); // normalized on load
  } finally {
    rmSync(`profiles/${name}.json`, { force: true });
  }
});
