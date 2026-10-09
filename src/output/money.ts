export interface Money {
  amount: number;
  currency: string;
}

export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Amounts round to 2 decimals; pass 4 for unit prices (fund NAVs, penny stocks). */
export function money(amount: number | undefined | null, currency: string | undefined | null, decimals = 2): Money | undefined {
  if (amount === undefined || amount === null || !Number.isFinite(amount) || !currency) return undefined;
  return { amount: round(amount, decimals), currency };
}

export const price = (amount: number | undefined | null, currency: string | undefined | null) => money(amount, currency, 4);

/** A percentage rounded to 2 decimals; `fraction` converts Avanza's 0.0138 to 1.38. */
export function pct(v: number | undefined | null, fraction = false): number | undefined {
  if (v === undefined || v === null || !Number.isFinite(v)) return undefined;
  return round(fraction ? v * 100 : v);
}

/** Percent change between two prices, as a plain number (4.2 = 4.2 %). */
export function pctChange(now: number | undefined, then: number | undefined | null): number | undefined {
  if (now === undefined || then === undefined || then === null || then === 0) return undefined;
  return round((now / then - 1) * 100);
}
