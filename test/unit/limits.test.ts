import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../../src/config.js";
import { checkOrder, idempotencyKey, type OrderContext, type OrderInput } from "../../src/policy/limits.js";
import { CliError } from "../../src/output/errors.js";

const order: OrderInput = { accountId: "7654321", orderbookId: "5247", side: "buy", volume: 10, price: 270 };

const ctx = (over: Partial<OrderContext> = {}): OrderContext => ({
  config: ConfigSchema.parse({}),
  permission: {
    read: true,
    trade: true,
    limits: { max_order_value: { amount: 10000, currency: "SEK" }, max_daily_value: { amount: 25000, currency: "SEK" }, allowed_sides: ["buy", "sell"] },
  },
  instrument: { name: "Investor B", type: "STOCK", currency: "SEK", tradable: true, lastPrice: 271.1 },
  fxToSek: 1,
  buyingPowerSek: 30000,
  holdingVolume: 50,
  auditToday: [],
  auditAll: [],
  allowDuplicate: false,
  now: new Date("2026-10-08T12:00:00Z"),
  ...over,
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as CliError).code;
  }
  return "passed";
};

describe("checkOrder", () => {
  it("passes a valid order and reports every check", () => {
    const r = checkOrder(order, ctx());
    expect(r.order_value).toBe(2700);
    expect(r.order_value_sek).toBe(2700);
    expect(r.price_deviation_percent).toBe(-0.41);
    expect(r.checks).toEqual(["trade_permission", "allowed_side", "tradable", "max_order_value", "max_daily_value", "buying_power", "price_band", "duplicate_window"]);
  });

  it("honours the kill switch before anything else", () => {
    expect(code(() => checkOrder(order, ctx({ config: ConfigSchema.parse({ trading_enabled: false }), permission: undefined })))).toBe("trading_disabled");
  });

  it("requires trade permission and an allowed side", () => {
    expect(code(() => checkOrder(order, ctx({ permission: { read: true, trade: false } })))).toBe("permission_denied");
    expect(code(() => checkOrder(order, ctx({ permission: { read: true, trade: true, limits: { allowed_sides: ["sell"] } } })))).toBe("permission_denied");
  });

  it("refuses untradable instruments and funds", () => {
    expect(code(() => checkOrder(order, ctx({ instrument: { ...ctx().instrument, tradable: false } })))).toBe("not_tradable");
    expect(code(() => checkOrder(order, ctx({ instrument: { ...ctx().instrument, type: "FUND" } })))).toBe("not_tradable");
  });

  it("enforces max_order_value", () => {
    expect(code(() => checkOrder({ ...order, volume: 40 }, ctx()))).toBe("limit_exceeded");
  });

  it("enforces max_daily_value against today's placed orders", () => {
    const placed = { time: "2026-10-08T09:00:00Z", command: "orders buy", result: "placed", order: { account_id: "7654321", value_sek: 23000 } };
    expect(code(() => checkOrder(order, ctx({ auditToday: [placed] })))).toBe("limit_exceeded");
  });

  it("converts foreign currency with the given rate, and refuses when no rate is known", () => {
    const usd = { ...ctx().instrument, currency: "USD", lastPrice: 200 };
    const r = checkOrder({ ...order, price: 200, volume: 2 }, ctx({ instrument: usd, fxToSek: 10 }));
    expect(r.order_value_sek).toBe(4000);
    expect(code(() => checkOrder({ ...order, price: 200, volume: 2 }, ctx({ instrument: usd, fxToSek: undefined })))).toBe("limit_exceeded");
  });

  it("checks buying power for buys and the holding for sells", () => {
    expect(code(() => checkOrder(order, ctx({ buyingPowerSek: 1000 })))).toBe("insufficient_buying_power");
    const noLimits = { read: true, trade: true };
    expect(code(() => checkOrder({ ...order, side: "sell", volume: 51 }, ctx({ permission: noLimits })))).toBe("insufficient_holding");
    expect(code(() => checkOrder({ ...order, side: "sell", volume: 30 }, ctx({ permission: noLimits })))).toBe("passed");
  });

  it("catches price typos outside the band", () => {
    expect(code(() => checkOrder({ ...order, price: 2710, volume: 1 }, ctx()))).toBe("price_out_of_band");
    expect(code(() => checkOrder({ ...order, price: 300 }, ctx({ config: ConfigSchema.parse({ price_band_percent: 15 }) })))).toBe("passed");
  });

  it("refuses an identical order inside the duplicate window unless allowed", () => {
    const key = idempotencyKey(order);
    const recent = { time: "2026-10-08T11:59:30Z", command: "orders buy", result: "placed", order: { account_id: "7654321", idempotency_key: key } };
    expect(code(() => checkOrder(order, ctx({ auditAll: [recent] })))).toBe("duplicate_order");
    expect(code(() => checkOrder(order, ctx({ auditAll: [recent], allowDuplicate: true })))).toBe("passed");
    const old = { ...recent, time: "2026-10-08T11:58:00Z" };
    expect(code(() => checkOrder(order, ctx({ auditAll: [old] })))).toBe("passed");
  });

  it("rejects non-integer volume", () => {
    expect(code(() => checkOrder({ ...order, volume: 1.5 }, ctx()))).toBe("usage_error");
  });
});
