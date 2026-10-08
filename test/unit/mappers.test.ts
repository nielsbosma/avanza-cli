import { describe, expect, it } from "vitest";
import { InstrumentInfo, Overview, Positions, SearchResponse } from "../../src/client/schemas/index.js";
import { mapAccountDetail, mapAccountSummary, mapHolding, mapInstrument, mapSearchHit } from "../../src/commands/mappers.js";
import { investor, overview, positions, searchHits } from "../fixtures/avanza.js";

describe("schemas accept the recorded responses", () => {
  it.each([
    ["overview", Overview, overview],
    ["positions", Positions, positions],
    ["instrument", InstrumentInfo, investor],
    ["search", SearchResponse, searchHits],
  ] as const)("%s", (_n, schema, data) => {
    expect(schema.safeParse(data).success).toBe(true);
  });

  it("fail loudly when a relied-on field disappears", () => {
    const broken = { ...positions, withOrderbook: [{ ...positions.withOrderbook[0], volume: undefined }] };
    expect(Positions.safeParse(broken).success).toBe(false);
  });
});

describe("mappers", () => {
  const ov = Overview.parse(overview);
  const pos = Positions.parse(positions);
  const info = InstrumentInfo.parse(investor);

  it("maps an account summary and detail", () => {
    expect(mapAccountSummary(ov.accounts[0]!)).toEqual({
      id: "1234567",
      name: "ISK Long-term",
      type: "INVESTERINGSSPARKONTO",
      total_value: { amount: 176804.12, currency: "SEK" },
      buying_power: { amount: 5120.5, currency: "SEK" },
      cash: { amount: 5120.5, currency: "SEK" },
    });
    expect(mapAccountSummary(ov.accounts[1]!).name).toBe("ISK");
    const detail = mapAccountDetail(ov.accounts[0]!);
    expect(detail.performance).toEqual({
      one_month: { amount: 2311.4, currency: "SEK", percent: 1.32 },
      ytd: { amount: 14820, currency: "SEK", percent: 9.15 },
    });
  });

  it("maps a holding with full statistics", () => {
    const h = mapHolding(pos.withOrderbook[0]!, 176804.12, { kind: "listed", type: "STOCK", info });
    expect(h).toMatchObject({
      name: "Investor B",
      ticker: "INVE B",
      orderbook_id: "5247",
      type: "stock",
      account_id: "1234567",
      volume: 120,
      average_price: { amount: 238.4, currency: "SEK" },
      last_price: { amount: 271.1, currency: "SEK" },
      market_value: { amount: 32532, currency: "SEK" },
      profit_loss: { amount: 3924, currency: "SEK", percent: 13.72 },
      today: { amount: 216, currency: "SEK", percent: 0.67 },
      share_of_account: 18.4,
      dividend_yield: 1.8,
      dividend_per_share: { amount: 2.6, currency: "SEK" },
      next_ex_dividend_date: "2099-05-08",
      valuation: { pe: 14.2, ps: 5.1, beta: 0.9 },
    });
    expect(h.returns?.ytd).toBe(12.91);
    expect(h.valuation?.pb).toBeUndefined();
  });

  it("keeps instrument currency and SEK values apart", () => {
    const h = mapHolding(pos.withOrderbook[2]!, 50000);
    expect(h.market_value).toEqual({ amount: 2000, currency: "USD" });
    expect(h.market_value_sek).toEqual({ amount: 20000, currency: "SEK" });
  });

  it("maps an instrument and a search hit", () => {
    const i = mapInstrument({ kind: "listed", type: "STOCK", info }, "5247");
    if (!("quote" in i)) throw new Error("expected a listed instrument");
    expect(i.quote.bid).toEqual({ amount: 271, currency: "SEK" });
    expect(i.quote.ask).toEqual({ amount: 271.2, currency: "SEK" });
    const hit = mapSearchHit(SearchResponse.parse(searchHits).hits[0]!);
    expect(hit).toMatchObject({ orderbook_id: "5247", name: "Investor B", ticker: "INVE B", type: "stock", last_price: { amount: 271.1, currency: "SEK" } });
  });
});
