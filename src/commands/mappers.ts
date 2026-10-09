import type { InstrumentDetails, OrderLike, OverviewAccount, Position, Quantity, SearchHit, Transaction } from "../client/index.js";
import { money, pct, pctChange, price, round } from "../output/money.js";

const q = (x: Quantity | null | undefined, fallbackCurrency?: string) => (x ? money(x.value, x.unit && x.unit !== "percentage" ? x.unit : fallbackCurrency) : undefined);
const qv = (x: Quantity | null | undefined) => (x ? x.value : undefined);
const qp = (x: Quantity | null | undefined, fallbackCurrency?: string) => (x ? price(x.value, x.unit && x.unit !== "percentage" ? x.unit : fallbackCurrency) : undefined);
const amt = (x: Quantity | null | undefined) => (x ? round(x.value) : undefined);
const lower = (s: string | null | undefined) => (s ? s.toLowerCase() : undefined);

export function accountName(a: OverviewAccount): string {
  return a.name.userDefinedName || a.name.defaultName;
}

const periodKeys: Record<string, string> = {
  ONE_WEEK: "one_week",
  ONE_MONTH: "one_month",
  THREE_MONTHS: "three_months",
  THIS_YEAR: "ytd",
  ONE_YEAR: "one_year",
  THREE_YEARS: "three_years",
  FIVE_YEARS: "five_years",
  ALL_TIME: "all_time",
};

export function mapAccountSummary(a: OverviewAccount) {
  return {
    id: a.id,
    name: accountName(a),
    type: a.type,
    total_value: q(a.totalValue, "SEK"),
    buying_power: q(a.buyingPower, "SEK"),
    cash: q(a.balance, "SEK"),
  };
}

export function mapAccountDetail(a: OverviewAccount) {
  const performance: Record<string, unknown> = {};
  for (const [period, p] of Object.entries(a.performance ?? {})) {
    const key = periodKeys[period] ?? period.toLowerCase();
    performance[key] = { amount: amt(p.absolute), currency: p.absolute?.unit ?? "SEK", percent: pct(qv(p.relative)) };
  }
  return {
    ...mapAccountSummary(a),
    buying_power_without_credit: q(a.buyingPowerWithoutCredit, "SEK"),
    profit: a.profit ? { amount: amt(a.profit.absolute), currency: a.profit.absolute?.unit ?? "SEK", percent: pct(qv(a.profit.relative)) } : undefined,
    performance,
    status: a.status ?? undefined,
  };
}

/** Allocation of an account's holdings by instrument type, as share of the account's total value. */
export function allocation(positions: Position[], totalValueSek: number | undefined) {
  const byType = new Map<string, number>();
  for (const p of positions) byType.set(lower(p.instrument.type)!, (byType.get(lower(p.instrument.type)!) ?? 0) + p.value.value);
  return [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, value]) => ({
      type,
      market_value: money(value, "SEK"),
      share_of_account: totalValueSek ? round((value / totalValueSek) * 100) : undefined,
    }));
}

function returnsFromDetails(d: InstrumentDetails | undefined, last: number | undefined) {
  if (!d) return undefined;
  if (d.kind === "fund") {
    const f = d.info;
    return {
      one_week: pct(f.developmentOneWeek),
      one_month: pct(f.developmentOneMonth),
      three_months: pct(f.developmentThreeMonths),
      ytd: pct(f.developmentThisYear),
      one_year: pct(f.developmentOneYear),
      three_years: pct(f.developmentThreeYears),
      five_years: pct(f.developmentFiveYears),
    };
  }
  const h = d.info.historicalClosingPrices;
  const price = last ?? d.info.quote?.last ?? undefined;
  if (!h || price === undefined) return undefined;
  return {
    one_week: pctChange(price, h.oneWeek),
    one_month: pctChange(price, h.oneMonth),
    three_months: pctChange(price, h.threeMonths),
    ytd: pctChange(price, h.startOfYear),
    one_year: pctChange(price, h.oneYear),
    three_years: pctChange(price, h.threeYears),
    five_years: pctChange(price, h.fiveYears),
  };
}

function incomeFromDetails(d: InstrumentDetails | undefined) {
  if (!d || d.kind !== "listed") return {};
  const k = d.info.keyIndicators;
  const div = k?.dividend;
  const exDate = div?.exDate ?? undefined;
  // Avanza says whether the ex-date has passed; fall back to comparing dates.
  const isPast = exDate ? (div?.exDateStatus ? div.exDateStatus === "HISTORICAL" : exDate <= new Date().toISOString().slice(0, 10)) : undefined;
  return {
    dividend_per_share: div?.amount != null ? price(div.amount, div.currencyCode ?? d.info.listing?.currency) : undefined,
    dividend_yield: pct(k?.directYield ?? k?.historicYield, true),
    dividends_per_year: k?.dividendsPerYear ?? undefined,
    last_ex_dividend_date: isPast ? exDate : undefined,
    next_ex_dividend_date: isPast === false ? exDate : undefined,
  };
}

function valuationFromDetails(d: InstrumentDetails | undefined) {
  if (!d || d.kind !== "listed") return undefined;
  const k = d.info.keyIndicators;
  if (!k) return undefined;
  return {
    pe: k.priceEarningsRatio ?? undefined,
    ps: k.priceSalesRatio ?? undefined,
    pb: k.priceBookRatio ?? undefined,
    market_cap: k.marketCapital ? money(k.marketCapital.value, k.marketCapital.currency) : undefined,
    beta: k.beta ?? undefined,
    volatility: pct(k.volatility, true),
    return_on_equity: pct(k.returnOnEquity, true),
    eps: k.earningsPerShare ? money(k.earningsPerShare.value, k.earningsPerShare.currency) : undefined,
    number_of_owners: k.numberOfOwners ?? undefined,
  };
}

const riskScores: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7 };

function fundFromDetails(d: InstrumentDetails | undefined) {
  if (d?.kind === "listed" && d.etf) {
    const e = d.etf;
    return {
      ongoing_charge: pct(e.fee?.totalPercentageFee),
      risk_level: e.riskScore ? riskScores[e.riskScore] : undefined,
      fund_category: e.category ?? e.assetCategory ?? undefined,
      issuer: e.issuer ?? undefined,
    };
  }
  if (!d || d.kind !== "fund") return undefined;
  const f = d.info;
  return {
    ongoing_charge: f.productFee ?? f.ongoingCharges ?? undefined,
    management_fee: f.managementFee ?? undefined,
    risk_level: f.risk ?? undefined,
    fund_category: f.categories?.[0] ?? f.fundTypeName ?? undefined,
    rating: f.rating ?? undefined,
    sharpe_ratio: pct(f.sharpeRatio),
    standard_deviation: pct(f.standardDeviation),
    nav: f.nav != null ? price(f.nav, f.currency) : undefined,
    index_fund: f.indexFund ?? undefined,
  };
}

export function lastPrice(p: Position, d?: InstrumentDetails): number | undefined {
  return p.instrument.orderbook?.quote?.latest?.value ?? (d?.kind === "listed" ? d.info.quote?.last ?? undefined : d?.info.nav ?? undefined);
}

/** One holding with the statistics the spec lists; absent data stays absent. */
export function mapHolding(p: Position, accountTotalSek: number | undefined, d?: InstrumentDetails) {
  const currency = p.instrument.currency;
  const volume = p.volume.value;
  const last = lastPrice(p, d);
  const valueSek = p.value.unit === "SEK" ? p.value.value : undefined;
  const acquired = p.acquiredValue?.value;
  const pl = acquired !== undefined ? p.value.value - acquired : undefined;
  const perf = p.lastTradingDayPerformance;

  return {
    name: p.instrument.name,
    ticker: d?.kind === "listed" ? d.info.listing?.tickerSymbol ?? undefined : undefined,
    orderbook_id: p.instrument.orderbook?.id,
    isin: p.instrument.isin ?? undefined,
    type: lower(p.instrument.type),
    currency,
    account_id: p.account.id,
    volume,
    average_price: qp(p.averageAcquiredPrice, currency),
    acquisition_value: q(p.acquiredValue, "SEK"),
    last_price: last !== undefined ? price(last, currency) : undefined,
    market_value: last !== undefined ? money(round(volume * last * (p.instrument.volumeFactor ?? 1), 2), currency) : undefined,
    market_value_sek: valueSek !== undefined ? money(valueSek, "SEK") : q(p.value),
    share_of_account: valueSek !== undefined && accountTotalSek ? round((valueSek / accountTotalSek) * 100) : undefined,
    profit_loss:
      pl !== undefined
        ? { amount: round(pl, 2), currency: p.value.unit ?? "SEK", percent: acquired ? round((pl / acquired) * 100) : undefined }
        : undefined,
    today: perf?.absolute ? { amount: round(perf.absolute.value), currency: perf.absolute.unit ?? "SEK", percent: pct(perf.relative?.value) } : undefined,
    returns: returnsFromDetails(d, last),
    ...incomeFromDetails(d),
    valuation: valuationFromDetails(d),
    fund: fundFromDetails(d),
  };
}

export function mapInstrument(d: InstrumentDetails, orderbookId: string) {
  if (d.kind === "fund") {
    const f = d.info;
    return {
      orderbook_id: orderbookId,
      name: f.name,
      isin: f.isin ?? undefined,
      type: "fund",
      currency: f.currency ?? undefined,
      nav: f.nav != null ? price(f.nav, f.currency) : undefined,
      nav_date: f.navDate ?? undefined,
      today_percent: pct(f.developmentOneDay),
      returns: returnsFromDetails(d, undefined),
      fund: fundFromDetails(d),
    };
  }
  const i = d.info;
  const cur = i.listing?.currency ?? undefined;
  const last = i.quote?.last ?? undefined;
  return {
    orderbook_id: i.orderbookId,
    name: i.name,
    ticker: i.listing?.tickerSymbol ?? undefined,
    isin: i.isin ?? undefined,
    type: lower(d.type),
    currency: cur,
    market: i.listing?.marketPlaceName ?? undefined,
    tradable: i.tradable ?? undefined,
    sector: i.sectors?.[0]?.sectorName ?? undefined,
    quote: {
      last: price(last, cur),
      bid: price(i.quote?.buy, cur),
      ask: price(i.quote?.sell, cur),
      high: price(i.quote?.highest, cur),
      low: price(i.quote?.lowest, cur),
      change: i.quote?.change != null ? { amount: round(i.quote.change, 4), currency: cur, percent: pct(i.quote.changePercent) } : undefined,
      volume: i.quote?.totalVolumeTraded ?? undefined,
      turnover: money(i.quote?.totalValueTraded, cur),
      time: i.quote?.timeOfLast ? new Date(i.quote.timeOfLast).toISOString() : undefined,
    },
    returns: returnsFromDetails(d, last),
    ...incomeFromDetails(d),
    valuation: valuationFromDetails(d),
    fund: fundFromDetails(d),
    next_report: i.keyIndicators?.nextReport?.date ?? undefined,
  };
}

export function mapSearchHit(h: SearchHit) {
  const id = h.orderBookId ?? h.orderbookId;
  // Live titles read "Investor B (INVE B)"; description is a company blurb, not the ticker.
  const m = /^(.*?)\s*\(([^()]+)\)$/.exec(h.title);
  return {
    orderbook_id: id != null ? String(id) : undefined,
    name: m ? m[1] : h.title,
    ticker: m ? m[2] : undefined,
    type: lower(h.type),
    currency: h.price?.currency ?? undefined,
    market: h.marketPlaceName ?? undefined,
    country: h.flagCode ?? undefined,
    last_price: h.price?.last && h.price.currency ? price(Number(h.price.last.replace(",", ".").replace(/\s/g, "")), h.price.currency) : undefined,
    tradeable: h.tradeable ?? undefined,
  };
}

export function mapTransaction(t: Transaction) {
  const cur = t.orderbook?.currency ?? undefined;
  return {
    id: t.id,
    date: t.tradeDate ?? t.date?.slice(0, 10) ?? undefined,
    settlement_date: t.settlementDate ?? undefined,
    account_id: t.account.id,
    type: t.type.toLowerCase(),
    description: t.description ?? undefined,
    instrument: t.orderbook?.name ?? t.instrumentName ?? undefined,
    orderbook_id: t.orderbook?.id,
    isin: t.isin ?? t.orderbook?.isin ?? undefined,
    volume: qv(t.volume),
    price: qp(t.priceInTradedCurrency, cur),
    amount: q(t.amount, "SEK"),
    commission: q(t.commission, "SEK"),
    result: q(t.result, "SEK"),
  };
}

const numOf = (x: number | Quantity | null | undefined) => (typeof x === "number" ? x : x?.value);
const str = (x: string | number | null | undefined) => (x == null ? undefined : String(x));

export function orderAccountId(o: OrderLike): string | undefined {
  return str(o.account?.accountId ?? o.account?.id ?? o.accountId);
}

export function mapOrder(o: OrderLike) {
  return {
    order_id: str(o.orderId),
    account_id: orderAccountId(o),
    orderbook_id: str(o.orderbook?.id ?? o.orderbook?.orderbookId ?? o.orderbookId),
    instrument: o.orderbook?.name ?? undefined,
    side: lower(o.side),
    volume: numOf(o.volume),
    original_volume: numOf(o.originalVolume),
    price: numOf(o.price) !== undefined ? money(numOf(o.price), o.orderbook?.currency ?? (typeof o.price === "object" ? o.price?.unit : undefined)) : undefined,
    state: lower(o.state ?? o.status),
    valid_until: o.validUntil ?? undefined,
    created: typeof o.created === "number" ? new Date(o.created).toISOString() : (o.created ?? undefined),
  };
}

export function mapDeal(o: OrderLike) {
  return {
    deal_id: str(o.dealId),
    order_id: str(o.orderId),
    account_id: orderAccountId(o),
    orderbook_id: str(o.orderbook?.id ?? o.orderbookId),
    instrument: o.orderbook?.name ?? undefined,
    side: lower(o.side),
    volume: numOf(o.volume),
    price: numOf(o.price) !== undefined ? money(numOf(o.price), o.orderbook?.currency ?? "SEK") : undefined,
    time: typeof o.time === "number" ? new Date(o.time).toISOString() : (o.time ?? undefined),
  };
}
