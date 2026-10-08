import { Option, type Command } from "commander";
import type { SearchType } from "../client/index.js";
import { emit } from "../output/format.js";
import { getClient } from "./context.js";
import { agentCommand } from "./meta.js";
import { mapInstrument, mapSearchHit } from "./mappers.js";

export function registerInstruments(program: Command) {
  const instruments = program.command("instruments").description("Find and inspect instruments");

  agentCommand(
    instruments
      .command("search")
      .description("Search by name, ticker or ISIN")
      .argument("<query>", "Name, ticker or ISIN")
      .addOption(new Option("--type <type>", "Instrument type").choices(["stock", "fund", "etf", "certificate", "warrant"]))
      .option("--limit <n>", "Maximum results", (v) => parseInt(v, 10), 10)
      .action(async (query: string, opts: { type?: SearchType; limit: number }) => {
        const hits = await getClient().search(query, opts.type, opts.limit);
        emit("instrument_search", { query, results: hits.map(mapSearchHit) });
      }),
    {
      kind: "instrument_search",
      example: `kind: instrument_search
schema_version: 1
query: investor
results:
  - orderbook_id: "5247"
    name: Investor B
    ticker: INVE B
    type: stock
    currency: SEK
    market: Stockholmsbörsen
    last_price: { amount: 271.1, currency: SEK }`,
    },
  );

  agentCommand(
    instruments
      .command("show")
      .description("Quote, bid/ask, day change, returns and key ratios")
      .argument("<orderbookId>", "Orderbook id")
      .addOption(new Option("--type <type>", "Skip type detection").choices(["stock", "fund", "etf"]))
      .action(async (orderbookId: string, opts: { type?: "stock" | "fund" | "etf" }) => {
        const avanzaType = opts.type === "etf" ? "EXCHANGE_TRADED_FUND" : opts.type?.toUpperCase();
        const details = await getClient().instrumentDetails(orderbookId, avanzaType);
        emit("instrument", { as_of: new Date().toISOString(), instrument: mapInstrument(details, orderbookId) });
      }),
    {
      kind: "instrument",
      example: `kind: instrument
schema_version: 1
instrument:
  orderbook_id: "5247"
  name: Investor B
  ticker: INVE B
  type: stock
  currency: SEK
  tradable: BUYABLE_AND_SELLABLE
  quote:
    last: { amount: 271.1, currency: SEK }
    bid: { amount: 271.0, currency: SEK }
    ask: { amount: 271.2, currency: SEK }
    change: { amount: 1.8, currency: SEK, percent: 0.67 }
  returns: { one_month: 3.4, ytd: 12.9 }
  dividend_yield: 1.8
  valuation: { pe: 14.2, pb: 1.1, beta: 0.9 }`,
    },
  );
}
