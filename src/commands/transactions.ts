import { Option, type Command } from "commander";
import type { TransactionType } from "../client/index.js";
import { emit } from "../output/format.js";
import { accountScope, getClient } from "./context.js";
import { agentCommand } from "./meta.js";
import { mapTransaction } from "./mappers.js";

const isoDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("expected YYYY-MM-DD");
  return v;
};

export function registerTransactions(program: Command) {
  const transactions = program.command("transactions").description("Account transactions");

  agentCommand(
    transactions
      .command("list")
      .description("Buys, sells, dividends, deposits, fees")
      .option("--account <id>", "Only this account")
      .option("--from <date>", "From date, YYYY-MM-DD", isoDate)
      .option("--to <date>", "To date, YYYY-MM-DD", isoDate)
      .addOption(
        new Option("--type <type...>", "Transaction types").choices(["buy-sell", "dividend", "deposit-withdraw", "interest", "foreign-tax", "forex", "options"]),
      )
      .option("--isin <isin>", "Only this instrument")
      .option("--limit <n>", "Maximum transactions", (v) => parseInt(v, 10), 1000)
      .action(async (opts: { account?: string; from?: string; to?: string; type?: TransactionType[]; isin?: string; limit: number }) => {
        const accounts = await accountScope(opts.account);
        const ids = new Set(accounts.map((a) => a.id));
        const list = await getClient().transactions({ from: opts.from, to: opts.to, types: opts.type, isin: opts.isin, maxElements: opts.limit });
        emit("transactions", {
          account_id: opts.account,
          from: opts.from,
          to: opts.to,
          transactions: list.filter((t) => ids.has(t.account.id)).map(mapTransaction),
        });
      }),
    {
      kind: "transactions",
      example: `kind: transactions
schema_version: 1
from: 2026-09-01
transactions:
  - id: "987654321"
    date: 2026-09-15
    account_id: "1234567"
    type: buy
    instrument: Investor B
    orderbook_id: "5247"
    volume: 20
    price: { amount: 262.3, currency: SEK }
    amount: { amount: -5246, currency: SEK }
    commission: { amount: 1, currency: SEK }`,
    },
  );
}
