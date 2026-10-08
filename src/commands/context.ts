import { createClient, type AvanzaClient } from "../client/index.js";
import { loadPermissions, canRead, type PermissionsFile } from "../policy/permissions.js";
import { CliError } from "../output/errors.js";
import type { OverviewAccount } from "../client/index.js";

let client: AvanzaClient | undefined;
let permissions: PermissionsFile | undefined;

export const getClient = () => (client ??= createClient());
export const getPermissions = async () => (permissions ??= await loadPermissions());

/** For tests. */
export function setContext(c: AvanzaClient | undefined, p: PermissionsFile | undefined) {
  client = c;
  permissions = p;
}

/** Human commands only: refuse without a TTY so an agent cannot grant itself rights. */
export function requireTty(command: string): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError("not_a_tty", `\`avanza ${command}\` is for humans and needs an interactive terminal.`, "Ask the human to run it.");
  }
}

/** The policy layer for reads: accounts without read permission do not exist. */
export async function readableAccounts(): Promise<OverviewAccount[]> {
  const p = await getPermissions();
  const overview = await getClient().overview();
  return overview.accounts.filter((a) => canRead(p, a.id));
}

export async function readableAccount(accountId: string): Promise<OverviewAccount> {
  const p = await getPermissions();
  if (!canRead(p, accountId)) {
    throw new CliError("not_found", `No readable account ${accountId}.`, "List readable accounts with `avanza accounts list`.");
  }
  const account = (await getClient().overview()).accounts.find((a) => a.id === accountId);
  if (!account) throw new CliError("not_found", `No readable account ${accountId}.`, "List readable accounts with `avanza accounts list`.");
  return account;
}

/** Accounts to read: one (checked) when --account is given, otherwise every readable one. */
export async function accountScope(accountId?: string): Promise<OverviewAccount[]> {
  if (accountId) return [await readableAccount(accountId)];
  const accounts = await readableAccounts();
  return accounts;
}
