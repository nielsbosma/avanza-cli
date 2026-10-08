export interface Money {
  amount: number;
  currency: string;
}

export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function money(amount: number | undefined | null, currency: string | undefined | null): Money | undefined {
  if (amount === undefined || amount === null || !Number.isFinite(amount) || !currency) return undefined;
  return { amount: round(amount, 4), currency };
}

/** Percent change between two prices, as a plain number (4.2 = 4.2 %). */
export function pctChange(now: number | undefined, then: number | undefined | null): number | undefined {
  if (now === undefined || then === undefined || then === null || then === 0) return undefined;
  return round((now / then - 1) * 100);
}
