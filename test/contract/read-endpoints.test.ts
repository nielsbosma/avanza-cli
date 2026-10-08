import { describe, expect, it } from "vitest";
import { createClient } from "../../src/client/index.js";

/**
 * Opt-in contract tests against a real Avanza account. Every read endpoint is called and its
 * response validated against the zod schema, so Avanza changes are caught early.
 * No test here places an order.
 *
 *   AVANZA_USERNAME=… AVANZA_PASSWORD=… AVANZA_TOTP_SECRET=… npm run test:contract
 */
const enabled = !!(process.env.AVANZA_USERNAME && process.env.AVANZA_PASSWORD);

describe.skipIf(!enabled)("Avanza read endpoints", () => {
  const client = createClient({ persist: false });
  let orderbookId = "5247"; // Investor B, replaced by a held instrument when there is one
  let heldType: string | undefined;

  it("overview", async () => {
    const o = await client.overview();
    expect(o.accounts.length).toBeGreaterThan(0);
  });

  it("positions", async () => {
    const p = await client.positions();
    const first = p.withOrderbook.find((x) => x.instrument.type === "STOCK");
    if (first?.instrument.orderbook) {
      orderbookId = first.instrument.orderbook.id;
      heldType = first.instrument.type;
    }
  });

  it("instrument details", async () => {
    const d = await client.instrumentDetails(orderbookId, heldType);
    expect(d.info.name).toBeTruthy();
  });

  it("search", async () => {
    const hits = await client.search("Investor", "stock", 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.orderBookId ?? hits[0]!.orderbookId).toBeTruthy();
  });

  it("transactions", async () => {
    const from = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    await client.transactions({ from, maxElements: 20 });
  });

  it("orders and deals", async () => {
    await client.orders();
    await client.deals();
  });
});
