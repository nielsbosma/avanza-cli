import { createHash } from "node:crypto";
import type { Config } from "../config.js";
import { CliError } from "../output/errors.js";
import { round } from "../output/money.js";
import type { AccountPermission } from "./permissions.js";
import type { AuditEntry } from "./audit.js";

export type Side = "buy" | "sell";

export interface OrderInput {
  accountId: string;
  orderbookId: string;
  side: Side;
  volume: number;
  price: number;
}

/** Everything the checks need, gathered by the caller so this stays a pure function. */
export interface OrderContext {
  config: Config;
  permission: AccountPermission | undefined;
  instrument: {
    name: string;
    type: string;
    currency: string;
    tradable: boolean;
    lastPrice?: number;
  };
  /** Instrument currency → SEK. 1 for SEK; undefined when unknown. */
  fxToSek?: number;
  buyingPowerSek?: number;
  holdingVolume: number;
  auditToday: AuditEntry[];
  auditAll: AuditEntry[];
  allowDuplicate: boolean;
  now?: Date;
}

export interface CheckedOrder extends OrderInput {
  instrument_name: string;
  currency: string;
  order_value: number;
  order_value_sek?: number;
  today_placed_value_sek: number;
  last_price?: number;
  price_deviation_percent?: number;
  idempotency_key: string;
  checks: string[];
}

export function idempotencyKey(o: OrderInput): string {
  return createHash("sha256").update([o.accountId, o.orderbookId, o.side, o.volume, o.price].join("|")).digest("hex").slice(0, 16);
}

const refuse = (code: ConstructorParameters<typeof CliError>[0], message: string, hint?: string, details?: Record<string, unknown>): never => {
  throw new CliError(code, message, hint, details);
};

/**
 * The trading-safety checks, in the order the spec gives them. Any failure throws before
 * Avanza is called.
 */
export function checkOrder(o: OrderInput, ctx: OrderContext): CheckedOrder {
  const checks: string[] = [];
  const now = ctx.now ?? new Date();

  if (!Number.isInteger(o.volume) || o.volume <= 0) refuse("usage_error", "--volume must be a positive whole number.");
  if (!(o.price > 0)) refuse("usage_error", "--price must be a positive number.");

  // 0. Global kill switch.
  if (!ctx.config.trading_enabled) {
    refuse("trading_disabled", "Trading is disabled (trading_enabled: false in config.yaml).", "Only a human can turn it back on.");
  }

  // 1. Trade permission and allowed side.
  if (!ctx.permission?.trade) {
    refuse("permission_denied", `Account ${o.accountId} is not enabled for trading.`, "A human can grant it with `avanza agent permissions`.");
  }
  const sides = ctx.permission?.limits?.allowed_sides ?? ["buy", "sell"];
  if (!sides.includes(o.side)) {
    refuse("permission_denied", `Side "${o.side}" is not allowed on account ${o.accountId}.`, "A human can change allowed sides with `avanza agent permissions`.");
  }
  checks.push("trade_permission", "allowed_side");

  // 2. Tradable now.
  if (!ctx.instrument.tradable) refuse("not_tradable", `${ctx.instrument.name} (${o.orderbookId}) is not tradable right now.`);
  if (ctx.instrument.type.toUpperCase() === "FUND") {
    refuse("not_tradable", "Fund orders are not supported; only limit orders on listed instruments.");
  }
  checks.push("tradable");

  // 3. Order and daily value limits (limits are in SEK).
  const orderValue = round(o.volume * o.price, 4);
  const orderValueSek = ctx.fxToSek !== undefined ? round(orderValue * ctx.fxToSek, 2) : undefined;
  const todaySek = round(ctx.auditToday.reduce((sum, e) => sum + (e.order?.value_sek ?? 0), 0), 2);
  const limits = ctx.permission?.limits;
  if ((limits?.max_order_value || limits?.max_daily_value) && orderValueSek === undefined) {
    refuse("limit_exceeded", `Cannot convert ${ctx.instrument.currency} to SEK to check the account's limits.`, "Trade instruments in SEK, or hold a position in the same currency.");
  }
  if (limits?.max_order_value && orderValueSek! > limits.max_order_value.amount) {
    refuse("limit_exceeded", `Order value ${orderValueSek} SEK exceeds max_order_value ${limits.max_order_value.amount} SEK.`, undefined, { order_value_sek: orderValueSek, max_order_value: limits.max_order_value.amount });
  }
  if (limits?.max_daily_value && todaySek + orderValueSek! > limits.max_daily_value.amount) {
    refuse("limit_exceeded", `Today's placed orders (${todaySek} SEK) plus this one (${orderValueSek} SEK) exceed max_daily_value ${limits.max_daily_value.amount} SEK.`, undefined, {
      today_placed_value_sek: todaySek,
      order_value_sek: orderValueSek,
      max_daily_value: limits.max_daily_value.amount,
    });
  }
  checks.push("max_order_value", "max_daily_value");

  // 4. Buying power / holding.
  if (o.side === "buy") {
    if (ctx.buyingPowerSek === undefined || orderValueSek === undefined) {
      refuse("insufficient_buying_power", "Could not determine buying power for this order.");
    }
    if (orderValueSek! > ctx.buyingPowerSek!) {
      refuse("insufficient_buying_power", `Order value ${orderValueSek} SEK exceeds buying power ${ctx.buyingPowerSek} SEK.`);
    }
    checks.push("buying_power");
  } else {
    if (o.volume > ctx.holdingVolume) {
      refuse("insufficient_holding", `Cannot sell ${o.volume}: the account holds ${ctx.holdingVolume}.`);
    }
    checks.push("holding");
  }

  // 5. Price band around the last price.
  let deviation: number | undefined;
  if (ctx.instrument.lastPrice === undefined || ctx.instrument.lastPrice <= 0) {
    refuse("price_out_of_band", "No last price is available to check the order price against.");
  }
  deviation = round((o.price / ctx.instrument.lastPrice! - 1) * 100);
  if (Math.abs(deviation) > ctx.config.price_band_percent) {
    refuse("price_out_of_band", `Price ${o.price} is ${deviation}% from the last price ${ctx.instrument.lastPrice} (band ±${ctx.config.price_band_percent}%).`, "Check the price for a typo.");
  }
  checks.push("price_band");

  // Duplicate-order window.
  const key = idempotencyKey(o);
  if (!ctx.allowDuplicate) {
    const windowMs = ctx.config.duplicate_window_seconds * 1000;
    const dup = ctx.auditAll.find((e) => e.result === "placed" && e.order?.idempotency_key === key && now.getTime() - new Date(e.time).getTime() < windowMs);
    if (dup) {
      refuse("duplicate_order", `An identical order was placed at ${dup.time}.`, "Pass --allow-duplicate if this is intended.");
    }
  }
  checks.push("duplicate_window");

  return {
    ...o,
    instrument_name: ctx.instrument.name,
    currency: ctx.instrument.currency,
    order_value: orderValue,
    order_value_sek: orderValueSek,
    today_placed_value_sek: todaySek,
    last_price: ctx.instrument.lastPrice,
    price_deviation_percent: deviation,
    idempotency_key: key,
    checks,
  };
}
