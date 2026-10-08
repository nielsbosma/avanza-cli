/** Recorded-shape Avanza responses (values made up), following the reference implementation's models. */

const q = (value: number, unit = "SEK") => ({ value, unit, unitType: "MONETARY", decimalPrecision: 2 });
const pct = (value: number) => ({ value, unit: "percentage", unitType: "PERCENTAGE", decimalPrecision: 2 });

export const overview = {
  categories: [{ id: "c1", name: "Långsiktigt" }],
  accounts: [
    {
      id: "1234567",
      categoryId: "c1",
      type: "INVESTERINGSSPARKONTO",
      name: { defaultName: "ISK", userDefinedName: "ISK Long-term" },
      balance: q(5120.5),
      totalValue: q(176804.12),
      buyingPower: q(5120.5),
      buyingPowerWithoutCredit: q(5120.5),
      profit: { absolute: q(20000), relative: pct(12.7) },
      performance: { ONE_MONTH: { absolute: q(2311.4), relative: pct(1.32) }, THIS_YEAR: { absolute: q(14820), relative: pct(9.15) } },
      status: "ACTIVE",
      urlParameterId: "abc",
      owner: true,
    },
    {
      id: "7654321",
      categoryId: "c1",
      type: "INVESTERINGSSPARKONTO",
      name: { defaultName: "ISK", userDefinedName: null },
      balance: q(30000),
      totalValue: q(50000),
      buyingPower: q(30000),
      buyingPowerWithoutCredit: q(30000),
      status: "ACTIVE",
      urlParameterId: "def",
      owner: true,
    },
    {
      id: "9999999",
      categoryId: "c1",
      type: "KAPITALFORSAKRING",
      name: { defaultName: "KF", userDefinedName: "Secret pension" },
      totalValue: q(999999),
      buyingPower: q(0),
      status: "ACTIVE",
    },
  ],
  loans: [],
};

const position = (accountId: string, id: string, name: string, volume: number, last: number, acquired: number, currency = "SEK", type = "STOCK") => ({
  id: `${accountId}-${id}`,
  account: { id: accountId, type: "INVESTERINGSSPARKONTO", name: "ISK", urlParameterId: "x", hasCredit: false },
  instrument: {
    type,
    name,
    currency,
    isin: "SE0015811963",
    volumeFactor: 1,
    orderbook: {
      id,
      name,
      type,
      tradeStatus: "BUYABLE_AND_SELLABLE",
      flagCode: "SE",
      quote: { latest: q(last, currency), change: q(1.8, currency), changePercent: pct(0.67) },
    },
  },
  volume: { value: volume, unit: "st", unitType: "VOLUME", decimalPrecision: 0 },
  value: q(volume * last * (currency === "USD" ? 10 : 1)),
  averageAcquiredPrice: q(acquired / volume, currency),
  acquiredValue: q(acquired),
  lastTradingDayPerformance: { absolute: q(216), relative: pct(0.67) },
});

export const positions = {
  withOrderbook: [
    position("1234567", "5247", "Investor B", 120, 271.1, 28608),
    position("7654321", "5247", "Investor B", 50, 271.1, 12000),
    position("7654321", "238449", "Apple", 10, 200, 15000, "USD"),
    position("9999999", "5361", "Volvo B", 1000, 250, 200000),
  ],
  withoutOrderbook: [],
  cashPositions: [],
};

export const investor = {
  orderbookId: "5247",
  name: "Investor B",
  isin: "SE0015811963",
  instrumentId: "1",
  type: "STOCK",
  tradable: "BUYABLE_AND_SELLABLE",
  sectors: [{ sectorId: "1", sectorName: "Finans" }],
  listing: { shortName: "INVE B", tickerSymbol: "INVE B", countryCode: "SE", currency: "SEK", marketPlaceCode: "XSTO", marketPlaceName: "Stockholmsbörsen" },
  quote: { buy: 271.0, sell: 271.2, last: 271.1, highest: 273, lowest: 268, change: 1.8, changePercent: 0.67, spread: 0.07, timeOfLast: 1791459000000, totalValueTraded: 1e9, totalVolumeTraded: 3.7e6, updated: 1791459000000, volumeWeightedAveragePrice: 270.5 },
  historicalClosingPrices: { oneDay: 269.3, oneWeek: 267.9, oneMonth: 262.2, threeMonths: 258, startOfYear: 240.1, oneYear: 229.2, start: 10, startDate: "1990-01-01" },
  keyIndicators: {
    numberOfOwners: 500000,
    volatility: 18.2,
    beta: 0.9,
    priceEarningsRatio: 14.2,
    priceSalesRatio: 5.1,
    directYield: 1.8,
    dividendsPerYear: 2,
    marketCapital: { value: 830000000000, currency: "SEK" },
    dividend: { exDate: "2099-05-08", paymentDate: "2099-05-12", amount: 2.6, currencyCode: "SEK" },
  },
};

export const searchHits = {
  totalNumberOfHits: 1,
  hits: [
    {
      orderBookId: "5247",
      type: "STOCK",
      title: "Investor B",
      highlightedTitle: "Investor B",
      description: "INVE B",
      urlSlugName: "investor-b",
      flagCode: "SE",
      marketPlaceName: "Stockholmsbörsen",
      tradeable: true,
      price: { last: "271,10", currency: "SEK", todayChangePercent: "0,67" },
    },
  ],
};
