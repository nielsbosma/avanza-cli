import { stringify } from "yaml";
import { CliError } from "./errors.js";

export const SCHEMA_VERSION = 1;

export type OutputFormat = "yaml" | "json";

let format: OutputFormat = "yaml";
export const setOutputFormat = (f: OutputFormat) => (format = f);

/** Removes undefined (and empty-object) fields so "not provided by Avanza" means "absent", never null. */
export function prune<T>(value: T): T {
  if (Array.isArray(value)) return value.map(prune) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || v === null || (typeof v === "number" && !Number.isFinite(v))) continue;
      const p = prune(v);
      if (p && typeof p === "object" && !Array.isArray(p) && Object.keys(p).length === 0) continue;
      out[k] = p;
    }
    return out as T;
  }
  return value;
}

export function render(kind: string, body: Record<string, unknown>, f: OutputFormat = format): string {
  const doc = prune({ kind, schema_version: SCHEMA_VERSION, ...body });
  return f === "json" ? JSON.stringify(doc, null, 2) + "\n" : stringify(doc, { lineWidth: 0 });
}

export function emit(kind: string, body: Record<string, unknown>): void {
  process.stdout.write(render(kind, body));
}

export function renderError(err: CliError, f: OutputFormat = format): string {
  return render("error", { error: { code: err.code, message: err.message, hint: err.hint, ...(err.details ? { details: err.details } : {}) } }, f);
}

export const warn = (message: string) => process.stderr.write(`warning: ${message}\n`);
