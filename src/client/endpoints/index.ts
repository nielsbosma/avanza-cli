import { CliError } from "../../output/errors.js";
import type { AvanzaHttp } from "../http.js";
import {
  DealsResponse,
  FundInfo,
  InstrumentInfo,
  OrderRequestResult,
  OrdersResponse,
  Overview,
  Positions,
  SearchResponse,
  Transactions,
} from "../schemas/index.js";

/** Paths, from the reference implementation (Qluxzz/avanza, constants.py). */
export const Route = {
  overview: "/_api/account-overview/overview/categorizedAccounts",
  positions: "/_api/position-data/positions",
  instrument: (type: string, id: string) => `/_api/market-guide/${type}/${id}`,
  fund: (id: string) => `/_api/fund-guide/guide/${id}`,
  search: "/_api/search/filtered-search",
  transactions: "/_api/transactions/list",
  orders: "/_api/trading/rest/orders",
  deals: "/_api/trading/rest/deals",
  placeOrder: "/_api/trading/order-entry/order/new",
  deleteOrder: "/_api/trading/order-entry/order/delete",
} as const;

/** Avanza's instrument type (as in positions/search) to the market-guide path segment. */
export function marketGuideType(type: string): string | undefined {
  const t = type.toUpperCase();
  const map: Record<string, string> = {
    STOCK: "stock",
    EXCHANGE_TRADED_FUND: "exchange_traded_fund",
    CERTIFICATE: "certificate",
    WARRANT: "warrant",
    BOND: "bond",
    INDEX: "index",
    PREMIUM_BOND: "premium_bond",
    SUBSCRIPTION_OPTION: "subscription_option",
    CONVERTIBLE: "convertible",
  };
  return map[t];
}

export const isFund = (type: string | null | undefined) => (type ?? "").toUpperCase() === "FUND";

export type SearchType = "stock" | "fund" | "etf" | "certificate" | "warrant";
const searchTypeMap: Record<SearchType, string> = {
  stock: "STOCK",
  fund: "FUND",
  etf: "EXCHANGE_TRADED_FUND",
  certificate: "CERTIFICATE",
  warrant: "WARRANT",
};

export type InstrumentDetails =
  | { kind: "listed"; type: string; info: InstrumentInfo }
  | { kind: "fund"; type: "FUND"; info: FundInfo };

export type TransactionType = "buy-sell" | "dividend" | "deposit-withdraw" | "interest" | "foreign-tax" | "forex" | "options";

/** One function per Avanza endpoint; responses validated against zod schemas. */
export function endpoints(http: AvanzaHttp) {
  return {
    overview: () => http.request("GET", Route.overview, Overview),

    positions: () => http.request("GET", Route.positions, Positions),

    instrument: (type: string, orderbookId: string) => http.request("GET", Route.instrument(type, orderbookId), InstrumentInfo),

    fund: (orderbookId: string) => http.request("GET", Route.fund(orderbookId), FundInfo),

    /**
     * Instrument details by orderbook id. With a known Avanza type it is one request;
     * without one, tries stock, ETF, then fund.
     */
    async instrumentDetails(orderbookId: string, type?: string | null): Promise<InstrumentDetails> {
      if (type && isFund(type)) return { kind: "fund", type: "FUND", info: await this.fund(orderbookId) };
      const known = type ? marketGuideType(type) : undefined;
      if (known) return { kind: "listed", type: type!.toUpperCase(), info: await this.instrument(known, orderbookId) };
      for (const [segment, t] of [
        ["stock", "STOCK"],
        ["exchange_traded_fund", "EXCHANGE_TRADED_FUND"],
      ] as const) {
        try {
          return { kind: "listed", type: t, info: await this.instrument(segment, orderbookId) };
        } catch (e) {
          if (!(e instanceof CliError) || e.code !== "avanza_api_error") throw e;
        }
      }
      try {
        return { kind: "fund", type: "FUND", info: await this.fund(orderbookId) };
      } catch (e) {
        if (e instanceof CliError && e.code === "avanza_api_error") {
          throw new CliError("not_found", `No instrument with orderbook id ${orderbookId}.`, "Find ids with `avanza instruments search <query>`.");
        }
        throw e;
      }
    },

    search: (query: string, type?: SearchType, limit = 10) =>
      http
        .request("POST", Route.search, SearchResponse, {
          body: {
            query,
            searchFilter: { types: type ? [searchTypeMap[type]] : [] },
            pagination: { from: 0, size: limit },
          },
        })
        .then((r) => r.hits),

    transactions: (opts: { from?: string; to?: string; types?: TransactionType[]; isin?: string; maxElements?: number }) =>
      http
        .request("GET", Route.transactions, Transactions, {
          query: {
            maxElements: opts.maxElements ?? 1000,
            from: opts.from,
            to: opts.to,
            transactionTypes: opts.types?.length ? opts.types.join(",") : undefined,
            isin: opts.isin,
          },
        })
        .then((r) => r.transactions),

    orders: () => http.request("GET", Route.orders, OrdersResponse).then((r) => r.orders),

    deals: () => http.request("GET", Route.deals, DealsResponse).then((r) => r.deals),

    placeOrder: (o: { accountId: string; orderbookId: string; side: "BUY" | "SELL"; price: number; volume: number; validUntil: string }) =>
      http.request("POST", Route.placeOrder, OrderRequestResult, {
        body: {
          accountId: o.accountId,
          orderbookId: o.orderbookId,
          side: o.side,
          condition: "NORMAL",
          price: o.price,
          validUntil: o.validUntil,
          volume: o.volume,
        },
      }),

    deleteOrder: (accountId: string, orderId: string) =>
      http.request("POST", Route.deleteOrder, OrderRequestResult, { body: { accountId, orderId } }),
  };
}

export type Endpoints = ReturnType<typeof endpoints>;
