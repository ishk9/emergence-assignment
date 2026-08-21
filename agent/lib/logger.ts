/**
 * Tiny structured logger shared across the pipeline. One JSON line per event,
 * scoped by module, level-filtered via LOG_LEVEL. eve auto-traces tool/model
 * spans; this covers the lib-internal steps (adapter fetches, dedup, scoring).
 *
 * ponytail: intentionally minimal — no transport/rotation/framework. Swap for
 * a real logger only if we need sinks beyond stdout/stderr.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const env = process.env.LOG_LEVEL as LogLevel | undefined;
  return (env && ORDER[env]) || ORDER.info;
}

export type Fields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  /** Derive a sub-scoped logger, e.g. log.child("hackernews"). */
  child(sub: string): Logger;
}

function emit(level: LogLevel, scope: string, msg: string, fields?: Fields): void {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
    ...fields,
  });
  // warn/error to stderr so they survive stdout redirection.
  if (level === "warn" || level === "error") console.error(line);
  else console.log(line);
}

export function createLogger(scope: string): Logger {
  return {
    debug: (msg, fields) => emit("debug", scope, msg, fields),
    info: (msg, fields) => emit("info", scope, msg, fields),
    warn: (msg, fields) => emit("warn", scope, msg, fields),
    error: (msg, fields) => emit("error", scope, msg, fields),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}
