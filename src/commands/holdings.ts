import type { Command } from "commander";
import type { InstrumentDetails, Position } from "../client/index.js";
import { CliError } from "../output/errors.js";
import { emit, warn } from "../output/format.js";
import { accountScope, getClient } from "./context.js";
import { agentCommand } from "./meta.js";
import { mapHolding, mapInstrument } from "./mappers.js";

/** Instrument details per orderbook, one request each, sequential to keep the request rate low. */
async function detailsFor(positions: Position[]): Promise<Map<string, InstrumentDetails>> {
  const client = getClient();
  const out = new Map<string, InstrumentDetails>();
  for (const p of positions) {
    const id = p.instrument.orderbook?.id;
    if (!id || out.has(id)) continue;
    try {
      out.set(id, await client.instrumentDetails(id, p.instrument.type));
    } catch (e) {
      warn(`no instrument statistics for ${p.instrument.name} (${id}): ${(e as Error).message}`);
    }
  }
  return out;
}

export function registerHoldings(program: Command) {
  const holdings = program.command("holdings").description("Holdings with full statistics");

  agentCommand(
    holdings
      .command("list")
      .description("Every holding in readable accounts, with full statistics")
      .option("--account <id>", "Only this account")
      .option("--no-details", "Skip per-instrument statistics (returns, dividends, valuation); one request instead of one per holding")
      .action(async (opts: { account?: string; details: boolean }) => {
        const accounts = await accountScope(opts.account);
        const ids = new Set(accounts.map((a) => a.id));
        const totals = new Map(accounts.map((a) => [a.id, a.totalValue?.value]));
        const positions = await getClient().positions();
        const mine = [...positions.withOrderbook, ...(positions.withoutOrderbook ?? [])].filter((p) => ids.has(p.account.id));
        const details = opts.details ? await detailsFor(mine) : new Map<string, InstrumentDetails>();
        emit("holdings", {
          account_id: opts.account,
          as_of: new Date().toISOString(),
          holdings: mine.map((p) => mapHolding(p, totals.get(p.account.id), details.get(p.instrument.orderbook?.id ?? ""))),
        });
      }),
    {
      kind: "holdings",
      example: `kind: holdings
schema_version: 1
account_id: "1234567"
as_of: 2026-10-08T13:10:00.000Z
holdings:
  - name: Investor B
    ticker: INVE B
    orderbook_id: "5247"
    isin: SE0015811963
    type: stock
    currency: SEK
    account_id: "1234567"
    volume: 120
    average_price: { amount: 238.4, currency: SEK }
    acquisition_value: { amount: 28608, currency: SEK }
    last_price: { amount: 271.1, currency: SEK }
    market_value: { amount: 32532, currency: SEK }
    market_value_sek: { amount: 32532, currency: SEK }
    share_of_account: 18.4
    profit_loss: { amount: 3924, currency: SEK, percent: 13.72 }
    today: { amount: 216, currency: SEK, percent: 0.67 }
    returns: { one_week: 1.2, one_month: 3.4, three_months: 5.1, ytd: 12.9, one_year: 18.3 }
    dividend_yield: 1.8
    valuation: { pe: 14.2, pb: 1.1, beta: 0.9 }`,
    },
  );

  agentCommand(
    holdings
      .command("show")
      .description("One holding in depth, plus instrument key ratios")
      .argument("<orderbookId>", "Orderbook id of the instrument")
      .option("--account <id>", "Only this account")
      .action(async (orderbookId: string, opts: { account?: string }) => {
        const accounts = await accountScope(opts.account);
        const ids = new Set(accounts.map((a) => a.id));
        const totals = new Map(accounts.map((a) => [a.id, a.totalValue?.value]));
        const positions = await getClient().positions();
        const matches = [...positions.withOrderbook, ...(positions.withoutOrderbook ?? [])].filter(
          (p) => ids.has(p.account.id) && p.instrument.orderbook?.id === orderbookId,
        );
        if (matches.length === 0) {
          throw new CliError("not_found", `No holding of orderbook ${orderbookId} in a readable account.`, "See `avanza holdings list`.");
        }
        const details = await getClient().instrumentDetails(orderbookId, matches[0]!.instrument.type);
        emit("holding", {
          as_of: new Date().toISOString(),
          holdings: matches.map((p) => mapHolding(p, totals.get(p.account.id), details)),
          instrument: mapInstrument(details, orderbookId),
        });
      }),
    {
      kind: "holding",
      example: `kind: holding
schema_version: 1
holdings:
  - name: Investor B
    orderbook_id: "5247"
    account_id: "1234567"
    volume: 120
    profit_loss: { amount: 3924, currency: SEK, percent: 13.72 }
instrument:
  orderbook_id: "5247"
  name: Investor B
  quote: { last: { amount: 271.1, currency: SEK }, bid: { amount: 271.0, currency: SEK }, ask: { amount: 271.2, currency: SEK } }
  valuation: { pe: 14.2, market_cap: { amount: 830000000000, currency: SEK } }`,
    },
  );
}
