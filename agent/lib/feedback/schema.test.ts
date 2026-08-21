import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryFeedbackStore, PartnerVerdict } from "./schema.ts";

const sample = {
  domain: "acme.com",
  candidateName: "Acme",
  query: "ai devtools",
  aiVerdict: "Meeting" as const,
  partnerVerdict: "Watch" as const,
  at: "2026-08-22T00:00:00.000Z",
};

test("PartnerVerdict validates a well-formed record", () => {
  const v = PartnerVerdict.parse(sample);
  assert.equal(v.partnerVerdict, "Watch");
});

test("PartnerVerdict rejects an invalid verdict", () => {
  assert.throws(() => PartnerVerdict.parse({ ...sample, partnerVerdict: "Maybe" }));
});

test("InMemoryFeedbackStore records and returns verdicts", async () => {
  const store = new InMemoryFeedbackStore();
  await store.record(sample);
  const all = await store.all();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.domain, "acme.com");
});
