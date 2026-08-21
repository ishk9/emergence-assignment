import test from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "./logger.ts";

/** Capture console.log + console.error lines emitted during `fn`. */
function capture(fn: () => void): string[] {
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  console.error = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return lines;
}

test("emits one structured JSON line with scope + fields", () => {
  const prev = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "info";
  const lines = capture(() => createLogger("hn").info("fetched", { count: 12 }));
  process.env.LOG_LEVEL = prev;

  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]!);
  assert.equal(rec.scope, "hn");
  assert.equal(rec.msg, "fetched");
  assert.equal(rec.count, 12);
  assert.equal(rec.level, "info");
  assert.ok(rec.ts, "has timestamp");
});

test("filters below the LOG_LEVEL threshold", () => {
  const prev = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "warn";
  const lines = capture(() => {
    const log = createLogger("x");
    log.debug("nope");
    log.info("nope");
    log.warn("yes");
    log.error("yes");
  });
  process.env.LOG_LEVEL = prev;

  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]!).level, "warn");
  assert.equal(JSON.parse(lines[1]!).level, "error");
});

test("child() nests the scope", () => {
  const prev = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "debug";
  const lines = capture(() => createLogger("pipeline").child("scorer").debug("weighted"));
  process.env.LOG_LEVEL = prev;

  assert.equal(JSON.parse(lines[0]!).scope, "pipeline:scorer");
});
