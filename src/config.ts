import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { ensureConfigDir, paths } from "./paths.js";
import { CliError } from "./output/errors.js";

export const ConfigSchema = z.object({
  /** Global kill switch: false blocks every order regardless of permissions. */
  trading_enabled: z.boolean().default(true),
  /** Orders priced further than this from the last price are refused (catches 2710 for 271.0). */
  price_band_percent: z.number().positive().default(10),
  /** An identical order inside this window is refused unless --allow-duplicate. */
  duplicate_window_seconds: z.number().int().nonnegative().default(60),
  /** Log reads in the audit log too, not only order activity. */
  audit_reads: z.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const file = paths.config();
  const raw = existsSync(file) ? (parse(readFileSync(file, "utf8")) ?? {}) : {};
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new CliError("usage_error", `config.yaml is invalid: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, `Fix or delete ${file}.`);
  }
  return result.data;
}

/** Writes the defaults once so the human can find and edit the file. */
export function ensureConfigFile(): void {
  ensureConfigDir();
  if (!existsSync(paths.config())) writeFileSync(paths.config(), stringify(ConfigSchema.parse({})), { mode: 0o600 });
}
