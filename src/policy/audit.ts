import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { ensureConfigDir, paths } from "../paths.js";

export interface AuditEntry {
  time: string;
  command: string;
  /** placed | rejected | cancelled | refused | dry_run | read */
  result: string;
  agent?: string;
  order?: {
    account_id: string;
    orderbook_id?: string;
    side?: "buy" | "sell";
    volume?: number;
    price?: number;
    currency?: string;
    value_sek?: number;
    idempotency_key?: string;
    order_id?: string;
  };
  message?: string;
}

/** Best guess at which agent is calling, from the environment it runs us in. */
export function callingAgent(): string | undefined {
  const env = process.env;
  if (env.AVANZA_CLI_AGENT) return env.AVANZA_CLI_AGENT;
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return "claude-code";
  if (Object.keys(env).some((k) => k.startsWith("CODEX_"))) return "codex";
  if (env.CURSOR_TRACE_ID) return "cursor";
  if (env.GEMINI_CLI) return "gemini-cli";
  return undefined;
}

export function appendAudit(entry: Omit<AuditEntry, "time" | "agent">): void {
  ensureConfigDir();
  const full: AuditEntry = { time: new Date().toISOString(), agent: callingAgent(), ...entry };
  appendFileSync(paths.audit(), JSON.stringify(full) + "\n", { mode: 0o600 });
}

export function readAudit(): AuditEntry[] {
  if (!existsSync(paths.audit())) return [];
  return readFileSync(paths.audit(), "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as AuditEntry];
      } catch {
        return [];
      }
    });
}

const localDay = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** Orders placed today (local time) on an account, from the audit log. */
export function placedToday(entries: AuditEntry[], accountId: string, now = new Date()): AuditEntry[] {
  const today = localDay(now);
  return entries.filter((e) => e.result === "placed" && e.order?.account_id === accountId && localDay(new Date(e.time)) === today);
}
