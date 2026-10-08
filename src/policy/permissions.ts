import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { ensureConfigDir, paths } from "../paths.js";
import { CliError } from "../output/errors.js";
import { warn } from "../output/format.js";
import { secretStore } from "../auth/secrets.js";

const MoneyLimit = z.object({ amount: z.number().nonnegative(), currency: z.literal("SEK") });

export const Limits = z.object({
  max_order_value: MoneyLimit.optional(),
  max_daily_value: MoneyLimit.optional(),
  allowed_sides: z.array(z.enum(["buy", "sell"])).optional(),
});
export type Limits = z.infer<typeof Limits>;

export const AccountPermission = z.object({
  name: z.string().optional(),
  read: z.boolean().default(false),
  trade: z.boolean().default(false),
  limits: Limits.optional(),
});
export type AccountPermission = z.infer<typeof AccountPermission>;

export const PermissionsFile = z.object({
  schema_version: z.literal(1),
  accounts: z.record(z.string(), AccountPermission).default({}),
});
export type PermissionsFile = z.infer<typeof PermissionsFile>;

const EMPTY: PermissionsFile = { schema_version: 1, accounts: {} };

const checksum = (text: string) => createHash("sha256").update(text).digest("hex");

/** Default deny: a missing file grants nothing. Warns when the file changed outside `agent permissions`. */
export async function loadPermissions(): Promise<PermissionsFile> {
  const file = paths.permissions();
  if (!existsSync(file)) return EMPTY;
  const text = readFileSync(file, "utf8");
  const parsed = PermissionsFile.safeParse(parse(text) ?? {});
  if (!parsed.success) {
    throw new CliError("permission_denied", "permissions.yaml is invalid; refusing to act on it.", "A human can rewrite it with `avanza agent permissions`.");
  }
  try {
    const stored = (await secretStore()).get("permissions_checksum");
    if (stored !== checksum(text)) {
      warn("permissions.yaml was modified outside `avanza agent permissions`.");
    }
  } catch {
    warn("could not verify the permissions.yaml checksum (no secret store).");
  }
  return normalise(parsed.data);
}

/** Trade implies read. */
export function normalise(p: PermissionsFile): PermissionsFile {
  const accounts: PermissionsFile["accounts"] = {};
  for (const [id, a] of Object.entries(p.accounts)) accounts[id] = { ...a, read: a.read || a.trade };
  return { ...p, accounts };
}

/** Only `agent permissions` (TTY-gated) calls this. */
export async function savePermissions(p: PermissionsFile): Promise<void> {
  ensureConfigDir();
  const text = stringify(normalise(p));
  writeFileSync(paths.permissions(), text, { mode: 0o600 });
  (await secretStore()).set("permissions_checksum", checksum(text));
}

export const canRead = (p: PermissionsFile, accountId: string) => p.accounts[accountId]?.read === true || p.accounts[accountId]?.trade === true;
export const canTrade = (p: PermissionsFile, accountId: string) => p.accounts[accountId]?.trade === true;

export function requireRead(p: PermissionsFile, accountId: string): void {
  if (!canRead(p, accountId)) {
    // Unreadable accounts look exactly like accounts that do not exist.
    throw new CliError("not_found", `No readable account ${accountId}.`, "List readable accounts with `avanza accounts list`. A human can grant access with `avanza agent permissions`.");
  }
}

export function requireTrade(p: PermissionsFile, accountId: string): void {
  if (!canTrade(p, accountId)) {
    throw new CliError("permission_denied", `Account ${accountId} is not enabled for trading.`, "A human can grant it with `avanza agent permissions`.");
  }
}
