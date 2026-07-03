// format.mjs — shared display formatting. Locale pinned to en-US so panel
// numbers agree with the scripted demo copy everywhere ($2,480.00).

export function money(amount, currency, { maximumFractionDigits } = {}) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  if (!currency) return n.toFixed(2); // never render "12.00 undefined"
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`; // unknown/invalid ISO code
  }
}
