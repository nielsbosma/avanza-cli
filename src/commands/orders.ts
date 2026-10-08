import type { Command } from "commander";
import { loadConfig } from "../config.js";
import type { Position } from "../client/index.js";
import { CliError } from "../output/errors.js";
import { emit } from "../output/format.js";
import { round } from "../output/money.js";
import { appendAudit, placedToday, readAudit } from "../policy/audit.js";
import { checkOrder, type CheckedOrder, type Side } from "../policy/limits.js";
import { canRead, requireTrade } from "../policy/permissions.js";
import { getClient, getPermissions } from "./context.js";
import { agentCommand } from "./meta.js";
import { mapDeal, mapOrder, orderAccountId } from "./mappers.js";

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const positiveNumber = (v: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error("expected a positive number");
  return n;
};
const positiveInt = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error("expected a positive whole number");
  return n;
};
const isoDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("expected YYYY-MM-DD");
  return v;
};

/** Instrument currency → SEK, from a position in the same currency (value in SEK / value in currency). */
function fxFromPositions(currency: string, positions: Position[]): number | undefined {
  if (currency === "SEK") return 1;
  for (const p of positions) {
    const last = p.instrument.orderbook?.quote?.latest?.value;
    if (p.instrument.currency !== currency || p.value.unit !== "SEK" || !last) continue;
    const native = p.volume.value * last * (p.instrument.volumeFactor ?? 1);
    if (native > 0) return p.value.value / native;
  }
  return undefined;
}

interface OrderOpts {
  account: string;
  orderbook: string;
  volume: number;
  price: number;
  validUntil?: string;
  dryRun?: boolean;
  allowDuplicate?: boolean;
}

async function placeOrder(side: Side, opts: OrderOpts) {
  const command = `orders ${side}`;
  const client = getClient();
  const permissions = await getPermissions();
  const config = loadConfig();
  const input = { accountId: opts.account, orderbookId: opts.orderbook, side, volume: opts.volume, price: opts.price };

  let checked: CheckedOrder;
  try {
    // Cheap checks first, so a disabled or unauthorised account never reaches Avanza.
    if (!config.trading_enabled) {
      throw new CliError("trading_disabled", "Trading is disabled (trading_enabled: false in config.yaml).", "Only a human can turn it back on.");
    }
    requireTrade(permissions, opts.account);

    const [overview, positions] = [await client.overview(), await client.positions()];
    const account = overview.accounts.find((a) => a.id === opts.account);
    if (!account) throw new CliError("not_found", `No account ${opts.account}.`);
    const all = [...positions.withOrderbook, ...(positions.withoutOrderbook ?? [])];
    const held = all.filter((p) => p.account.id === opts.account && p.instrument.orderbook?.id === opts.orderbook);
    const knownType = all.find((p) => p.instrument.orderbook?.id === opts.orderbook)?.instrument.type;

    const details = await client.instrumentDetails(opts.orderbook, knownType);
    if (details.kind === "fund") throw new CliError("not_tradable", "Fund orders are not supported; only limit orders on listed instruments.");
    const info = details.info;
    const currency = info.listing?.currency ?? held[0]?.instrument.currency ?? "SEK";
    const tradableFlag = (info.tradable ?? "").toUpperCase();
    const tradable = tradableFlag === "" ? true : side === "buy" ? tradableFlag.includes("BUYABLE") : tradableFlag.includes("SELLABLE");

    const audit = readAudit();
    checked = checkOrder(input, {
      config,
      permission: permissions.accounts[opts.account],
      instrument: { name: info.name, type: details.type, currency, tradable, lastPrice: info.quote?.last ?? undefined },
      fxToSek: fxFromPositions(currency, all),
      buyingPowerSek: account.buyingPower?.value,
      holdingVolume: held.reduce((s, p) => s + p.volume.value, 0),
      auditToday: placedToday(audit, opts.account),
      auditAll: audit,
      allowDuplicate: opts.allowDuplicate ?? false,
    });
  } catch (e) {
    if (e instanceof CliError) {
      appendAudit({ command, result: "refused", order: { account_id: opts.account, orderbook_id: opts.orderbook, side, volume: opts.volume, price: opts.price }, message: `${e.code}: ${e.message}` });
    }
    throw e;
  }

  const order = {
    account_id: checked.accountId,
    orderbook_id: checked.orderbookId,
    instrument: checked.instrument_name,
    side,
    order_type: "limit",
    volume: checked.volume,
    price: { amount: checked.price, currency: checked.currency },
    order_value: { amount: round(checked.order_value, 2), currency: checked.currency },
    order_value_sek: checked.order_value_sek !== undefined ? { amount: checked.order_value_sek, currency: "SEK" } : undefined,
    last_price: checked.last_price !== undefined ? { amount: checked.last_price, currency: checked.currency } : undefined,
    price_deviation_percent: checked.price_deviation_percent,
    valid_until: opts.validUntil ?? localDate(),
    idempotency_key: checked.idempotency_key,
  };
  const auditOrder = {
    account_id: checked.accountId,
    orderbook_id: checked.orderbookId,
    side,
    volume: checked.volume,
    price: checked.price,
    currency: checked.currency,
    value_sek: checked.order_value_sek,
    idempotency_key: checked.idempotency_key,
  };

  if (opts.dryRun) {
    emit("order_preview", { dry_run: true, checks_passed: checked.checks, order });
    return;
  }

  const result = await client.placeOrder({
    accountId: checked.accountId,
    orderbookId: checked.orderbookId,
    side: side === "buy" ? "BUY" : "SELL",
    price: checked.price,
    volume: checked.volume,
    validUntil: order.valid_until,
  });
  const message = result.message ?? (Array.isArray(result.messages) ? result.messages.join("; ") : result.messages) ?? undefined;
  const orderId = result.orderId != null ? String(result.orderId) : undefined;

  if (result.orderRequestStatus !== "SUCCESS") {
    appendAudit({ command, result: "rejected", order: auditOrder, message: message ?? result.orderRequestStatus });
    throw new CliError("order_rejected", `Avanza rejected the order: ${message ?? result.orderRequestStatus}.`, "Do not retry blindly; report this to the human.", {
      order_request_status: result.orderRequestStatus,
    });
  }
  appendAudit({ command, result: "placed", order: { ...auditOrder, order_id: orderId }, message });
  emit("order_result", { status: "placed", order_id: orderId, message, order });
}

const ORDER_EXAMPLE = `kind: order_preview
schema_version: 1
dry_run: true
checks_passed: [trade_permission, allowed_side, tradable, max_order_value, max_daily_value, buying_power, price_band, duplicate_window]
order:
  account_id: "7654321"
  orderbook_id: "5247"
  instrument: Investor B
  side: buy
  order_type: limit
  volume: 10
  price: { amount: 270, currency: SEK }
  order_value: { amount: 2700, currency: SEK }
  last_price: { amount: 271.1, currency: SEK }
  price_deviation_percent: -0.41
  valid_until: 2026-10-08

# Without --dry-run:
kind: order_result
schema_version: 1
status: placed
order_id: "123456789"
order: { ... }`;

function orderCommand(parent: Command, side: Side) {
  return agentCommand(
    parent
      .command(side)
      .description(`${side === "buy" ? "Buy" : "Sell"} with a limit order (preview with --dry-run first)`)
      .requiredOption("--account <id>", "Account id (needs trade permission)")
      .requiredOption("--orderbook <id>", "Orderbook id of the instrument")
      .requiredOption("--volume <n>", "Number of shares", positiveInt)
      .requiredOption("--price <p>", "Limit price in the instrument's currency", positiveNumber)
      .option("--valid-until <date>", "Last day the order is valid, YYYY-MM-DD (default today)", isoDate)
      .option("--dry-run", "Run every check and return the preview; place nothing")
      .option("--allow-duplicate", "Allow an identical order inside the duplicate window")
      .action((opts: OrderOpts) => placeOrder(side, opts)),
    { kind: "order_preview | order_result", example: ORDER_EXAMPLE, trades: true },
  );
}

export function registerOrders(program: Command) {
  const orders = program.command("orders").description("List, place and cancel orders");

  agentCommand(
    orders
      .command("list")
      .description("Open orders and today's deals")
      .option("--account <id>", "Only this account")
      .action(async (opts: { account?: string }) => {
        const permissions = await getPermissions();
        if (opts.account && !canRead(permissions, opts.account)) {
          throw new CliError("not_found", `No readable account ${opts.account}.`, "List readable accounts with `avanza accounts list`.");
        }
        const visible = (id: string | undefined) => !!id && canRead(permissions, id) && (!opts.account || id === opts.account);
        const client = getClient();
        const [open, deals] = [await client.orders(), await client.deals()];
        emit("orders", {
          account_id: opts.account,
          as_of: new Date().toISOString(),
          orders: open.filter((o) => visible(orderAccountId(o))).map(mapOrder),
          deals: deals.filter((o) => visible(orderAccountId(o))).map(mapDeal),
        });
      }),
    {
      kind: "orders",
      example: `kind: orders
schema_version: 1
orders:
  - order_id: "123456789"
    account_id: "7654321"
    orderbook_id: "5247"
    instrument: Investor B
    side: buy
    volume: 10
    price: { amount: 270, currency: SEK }
    state: active
    valid_until: 2026-10-08
deals: []`,
    },
  );

  orderCommand(orders, "buy");
  orderCommand(orders, "sell");

  agentCommand(
    orders
      .command("cancel")
      .description("Cancel an open order")
      .requiredOption("--account <id>", "Account id (needs trade permission)")
      .requiredOption("--order <id>", "Order id from `orders list`")
      .action(async (opts: { account: string; order: string }) => {
        const permissions = await getPermissions();
        const config = loadConfig();
        try {
          if (!config.trading_enabled) throw new CliError("trading_disabled", "Trading is disabled (trading_enabled: false in config.yaml).");
          requireTrade(permissions, opts.account);
        } catch (e) {
          appendAudit({ command: "orders cancel", result: "refused", order: { account_id: opts.account, order_id: opts.order }, message: (e as Error).message });
          throw e;
        }
        const result = await getClient().deleteOrder(opts.account, opts.order);
        const message = result.message ?? (Array.isArray(result.messages) ? result.messages.join("; ") : result.messages) ?? undefined;
        const ok = result.orderRequestStatus === "SUCCESS";
        appendAudit({ command: "orders cancel", result: ok ? "cancelled" : "rejected", order: { account_id: opts.account, order_id: opts.order }, message });
        if (!ok) throw new CliError("order_rejected", `Avanza refused the cancellation: ${message ?? result.orderRequestStatus}.`);
        emit("order_cancel", { status: "cancelled", account_id: opts.account, order_id: opts.order, message });
      }),
    {
      kind: "order_cancel",
      trades: true,
      example: `kind: order_cancel
schema_version: 1
status: cancelled
account_id: "7654321"
order_id: "123456789"`,
    },
  );
}
