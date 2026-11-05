const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usdPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 4,
});
const tiny = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 });

/** Balances and totals: `$5,502.21`; dust shows as `<$0.01` rather than `$0.00`. */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return `<${usd.format(0.01)}`;
  return usd.format(value);
}

/** Unit prices keep their significant digits below $1: `$0.000012`. */
export function formatPrice(value: number): string {
  return value > 0 && value < 1 ? usdPrecise.format(value) : usd.format(value);
}

/** Token amounts cut to the catalog's display decimals; dust keeps 4 significant digits. */
export function formatAmount(balance: string, displayDecimals: number): string {
  const n = Number(balance);
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n < 10 ** -displayDecimals) return tiny.format(n);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: displayDecimals }).format(n);
}

/** 24h change as in the mobile app: `+0.9%`, `−0.19%`, `0%`. */
export function formatChange(percent: number): string {
  const abs = Math.abs(percent).toFixed(2).replace(/\.?0+$/, "");
  if (abs === "0") return "0%";
  return `${percent > 0 ? "+" : "−"}${abs}%`;
}
