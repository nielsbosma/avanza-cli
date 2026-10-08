import type { Command } from "commander";
import { emit } from "../output/format.js";
import { accountScope, getClient, readableAccount } from "./context.js";
import { agentCommand } from "./meta.js";
import { allocation, mapAccountDetail, mapAccountSummary } from "./mappers.js";

export function registerAccounts(program: Command) {
  const accounts = program.command("accounts").description("Accounts the agent may read");

  agentCommand(
    accounts
      .command("list")
      .description("Readable accounts: id, name, type, total value, buying power, cash")
      .action(async () => {
        const list = await accountScope();
        emit("accounts", { as_of: new Date().toISOString(), accounts: list.map(mapAccountSummary) });
      }),
    {
      kind: "accounts",
      example: `kind: accounts
schema_version: 1
as_of: 2026-10-08T13:10:00.000Z
accounts:
  - id: "1234567"
    name: ISK Long-term
    type: INVESTERINGSSPARKONTO
    total_value: { amount: 176804.12, currency: SEK }
    buying_power: { amount: 5120.5, currency: SEK }
    cash: { amount: 5120.5, currency: SEK }`,
    },
  );

  agentCommand(
    accounts
      .command("show")
      .description("One account with totals, performance and allocation")
      .argument("<accountId>", "Account id from `accounts list`")
      .action(async (accountId: string) => {
        const account = await readableAccount(accountId);
        const positions = await getClient().positions();
        const own = [...positions.withOrderbook, ...(positions.withoutOrderbook ?? [])].filter((p) => p.account.id === accountId);
        emit("account", {
          as_of: new Date().toISOString(),
          account: {
            ...mapAccountDetail(account),
            holdings_count: own.length,
            allocation: allocation(own, account.totalValue?.value),
          },
        });
      }),
    {
      kind: "account",
      example: `kind: account
schema_version: 1
account:
  id: "1234567"
  name: ISK Long-term
  type: INVESTERINGSSPARKONTO
  total_value: { amount: 176804.12, currency: SEK }
  performance:
    one_month: { amount: 2311.4, currency: SEK, percent: 1.32 }
    ytd: { amount: 14820.0, currency: SEK, percent: 9.15 }
  holdings_count: 7
  allocation:
    - type: stock
      market_value: { amount: 120400, currency: SEK }
      share_of_account: 68.1`,
    },
  );
}
