import { z } from "zod";

/**
 * Schemas for Avanza's private API responses. Fields the CLI relies on are required, so a
 * changed endpoint fails loudly (schema_mismatch); everything else is optional and unknown
 * keys pass through, so harmless additions on Avanza's side do not break anything.
 */

const num = z.number();
const optStr = z.string().nullish();
const optNum = z.number().nullish();

/** Avanza's `{ value, unit, unitType, decimalPrecision }` number wrapper. */
export const Quantity = z.looseObject({
  value: num,
  unit: z.string().nullish(),
  unitType: z.string().nullish(),
  decimalPrecision: optNum,
});
export type Quantity = z.infer<typeof Quantity>;

const Performance = z.looseObject({ absolute: Quantity.nullish(), relative: Quantity.nullish() });

// ---------- account overview: /_api/account-overview/overview/categorizedAccounts

export const OverviewAccount = z.looseObject({
  id: z.string(),
  categoryId: optStr,
  type: z.string(),
  name: z.looseObject({ defaultName: z.string(), userDefinedName: optStr }),
  balance: Quantity.nullish(),
  totalValue: Quantity.nullish(),
  buyingPower: Quantity.nullish(),
  buyingPowerWithoutCredit: Quantity.nullish(),
  profit: Performance.nullish(),
  performance: z.record(z.string(), Performance).nullish(),
  status: optStr,
  urlParameterId: optStr,
  owner: z.boolean().nullish(),
});
export type OverviewAccount = z.infer<typeof OverviewAccount>;

export const Overview = z.looseObject({
  categories: z.array(z.looseObject({ id: z.string(), name: z.string() })).nullish(),
  accounts: z.array(OverviewAccount),
});
export type Overview = z.infer<typeof Overview>;

// ---------- positions: /_api/position-data/positions

const PositionAccount = z.looseObject({ id: z.string(), type: optStr, name: optStr, urlParameterId: optStr });

const PositionInstrument = z.looseObject({
  type: z.string(),
  name: z.string(),
  currency: z.string(),
  isin: optStr,
  volumeFactor: optNum,
  orderbook: z
    .looseObject({
      id: z.string(),
      name: optStr,
      type: optStr,
      tradeStatus: optStr,
      flagCode: optStr,
      quote: z
        .looseObject({
          latest: Quantity.nullish(),
          change: Quantity.nullish(),
          changePercent: Quantity.nullish(),
          highest: Quantity.nullish(),
          lowest: Quantity.nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

export const Position = z.looseObject({
  id: z.string(),
  account: PositionAccount,
  instrument: PositionInstrument,
  volume: Quantity,
  value: Quantity,
  averageAcquiredPrice: Quantity.nullish(),
  acquiredValue: Quantity.nullish(),
  lastTradingDayPerformance: Performance.nullish(),
});
export type Position = z.infer<typeof Position>;

export const Positions = z.looseObject({
  withOrderbook: z.array(Position),
  withoutOrderbook: z.array(Position).nullish(),
  cashPositions: z.array(z.looseObject({ id: z.string(), account: PositionAccount, totalBalance: Quantity })).nullish(),
});
export type Positions = z.infer<typeof Positions>;

// ---------- instruments: /_api/market-guide/{type}/{id}

const Money = z.looseObject({ value: num, currency: optStr });

export const InstrumentQuote = z.looseObject({
  buy: optNum,
  sell: optNum,
  last: optNum,
  highest: optNum,
  lowest: optNum,
  change: optNum,
  changePercent: optNum,
  spread: optNum,
  timeOfLast: optNum,
  totalValueTraded: optNum,
  totalVolumeTraded: optNum,
  volumeWeightedAveragePrice: optNum,
  updated: optNum,
});

export const HistoricalClosingPrices = z.looseObject({
  oneDay: optNum,
  oneWeek: optNum,
  oneMonth: optNum,
  threeMonths: optNum,
  startOfYear: optNum,
  oneYear: optNum,
  threeYears: optNum,
  fiveYears: optNum,
});

export const KeyIndicators = z.looseObject({
  numberOfOwners: optNum,
  volatility: optNum,
  beta: optNum,
  priceEarningsRatio: optNum,
  priceSalesRatio: optNum,
  priceBookRatio: optNum,
  evEbitRatio: optNum,
  returnOnEquity: optNum,
  directYield: optNum,
  dividendsPerYear: optNum,
  marketCapital: Money.nullish(),
  earningsPerShare: Money.nullish(),
  equityPerShare: Money.nullish(),
  dividend: z
    .looseObject({ exDate: optStr, paymentDate: optStr, amount: optNum, currencyCode: optStr, exDividendDate: optStr })
    .nullish(),
  nextReport: z.looseObject({ date: optStr, reportType: optStr }).nullish(),
  previousReport: z.looseObject({ date: optStr, reportType: optStr }).nullish(),
});

export const InstrumentInfo = z.looseObject({
  orderbookId: z.string(),
  name: z.string(),
  isin: optStr,
  type: optStr,
  tradable: optStr,
  listing: z
    .looseObject({ shortName: optStr, tickerSymbol: optStr, countryCode: optStr, currency: optStr, marketPlaceName: optStr, marketPlaceCode: optStr })
    .nullish(),
  quote: InstrumentQuote.nullish(),
  historicalClosingPrices: HistoricalClosingPrices.nullish(),
  keyIndicators: KeyIndicators.nullish(),
  sectors: z.array(z.looseObject({ sectorName: optStr })).nullish(),
});
export type InstrumentInfo = z.infer<typeof InstrumentInfo>;

// ---------- funds: /_api/fund-guide/guide/{id}

export const FundInfo = z.looseObject({
  isin: optStr,
  name: z.string(),
  currency: optStr,
  nav: optNum,
  navDate: optStr,
  productFee: optNum,
  managementFee: optNum,
  ongoingCharges: optNum,
  risk: optNum,
  riskText: optStr,
  rating: optNum,
  categories: z.array(z.string()).nullish(),
  fundTypeName: optStr,
  developmentOneDay: optNum,
  developmentOneWeek: optNum,
  developmentOneMonth: optNum,
  developmentThreeMonths: optNum,
  developmentThisYear: optNum,
  developmentOneYear: optNum,
  developmentThreeYears: optNum,
  developmentFiveYears: optNum,
  sharpeRatio: optNum,
  standardDeviation: optNum,
  capital: optNum,
  indexFund: z.boolean().nullish(),
});
export type FundInfo = z.infer<typeof FundInfo>;

// ---------- search: /_api/search/filtered-search

export const SearchHit = z.looseObject({
  orderBookId: z.union([z.string(), z.number()]).nullish(),
  orderbookId: z.union([z.string(), z.number()]).nullish(),
  type: optStr,
  title: z.string(),
  description: optStr,
  urlSlugName: optStr,
  flagCode: optStr,
  marketPlaceName: optStr,
  tradeable: z.boolean().nullish(),
  buyable: z.boolean().nullish(),
  sellable: z.boolean().nullish(),
  price: z
    .looseObject({ last: optStr, currency: optStr, todayChangePercent: optStr, threeMonthsAgoChangePercent: optStr })
    .nullish(),
});
export type SearchHit = z.infer<typeof SearchHit>;

export const SearchResponse = z.looseObject({ hits: z.array(SearchHit), totalNumberOfHits: optNum });

// ---------- transactions: /_api/transactions/list

export const Transaction = z.looseObject({
  id: z.string(),
  date: optStr,
  tradeDate: optStr,
  settlementDate: optStr,
  account: z.looseObject({ id: z.string(), name: optStr, type: optStr }),
  orderbook: z.looseObject({ id: z.string(), name: optStr, currency: optStr, isin: optStr }).nullish(),
  instrumentName: optStr,
  description: optStr,
  type: z.string(),
  volume: Quantity.nullish(),
  priceInTradedCurrency: Quantity.nullish(),
  amount: Quantity.nullish(),
  commission: Quantity.nullish(),
  result: Quantity.nullish(),
  isin: optStr,
});
export type Transaction = z.infer<typeof Transaction>;

export const Transactions = z.looseObject({ transactions: z.array(Transaction) });

// ---------- orders and deals: /_api/trading/rest/orders, /_api/trading/rest/deals

const OrderLike = z.looseObject({
  orderId: z.union([z.string(), z.number()]).nullish(),
  dealId: z.union([z.string(), z.number()]).nullish(),
  accountId: z.union([z.string(), z.number()]).nullish(),
  account: z.looseObject({ accountId: z.union([z.string(), z.number()]).nullish(), id: optStr, name: optStr }).nullish(),
  orderbook: z.looseObject({ id: z.union([z.string(), z.number()]).nullish(), orderbookId: optStr, name: optStr, currency: optStr }).nullish(),
  orderbookId: z.union([z.string(), z.number()]).nullish(),
  side: optStr,
  price: z.union([num, Quantity]).nullish(),
  volume: z.union([num, Quantity]).nullish(),
  originalVolume: z.union([num, Quantity]).nullish(),
  state: optStr,
  status: optStr,
  validUntil: optStr,
  created: z.union([z.string(), z.number()]).nullish(),
  time: z.union([z.string(), z.number()]).nullish(),
});
export type OrderLike = z.infer<typeof OrderLike>;

export const OrdersResponse = z.looseObject({ orders: z.array(OrderLike) });
export const DealsResponse = z.looseObject({ deals: z.array(OrderLike) });

// ---------- order entry: /_api/trading/order-entry/order/new and /delete

export const OrderRequestResult = z.looseObject({
  orderRequestStatus: z.string(),
  orderId: z.union([z.string(), z.number()]).nullish(),
  message: optStr,
  messages: z.union([z.string(), z.array(z.string())]).nullish(),
});
export type OrderRequestResult = z.infer<typeof OrderRequestResult>;
