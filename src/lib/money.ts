// Money is always handled as integer cents. Floats only appear at the edges
// (Claude's extraction, PayPal's decimal strings) and are converted immediately.

export type Cents = number;

export function toCents(value: number): Cents {
  // 28.2 * 100 === 2819.9999999999995, so round instead of truncating.
  return Math.round(value * 100);
}

/** VAT (or any percentage) of an amount in cents, rounded half-up to the cent. */
export function pctOf(cents: Cents, percent: number): Cents {
  return Math.round((cents * percent) / 100);
}

/** Decimal string for PayPal amounts, e.g. 123456 -> "1234.56". */
export function toDecimalString(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Parses a PayPal decimal string ("12.10") into cents without float drift. */
export function fromDecimalString(value: string): Cents {
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new Error(`Invalid decimal amount: ${value}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"));
  return m[1] ? -cents : cents;
}

const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });

export function fmt(cents: Cents | null | undefined): string {
  if (cents == null) return "—";
  return eur.format(cents / 100);
}

/** Signed format for deltas: +€29.26 / −€3.12 */
export function fmtDelta(cents: Cents): string {
  if (cents === 0) return fmt(0);
  return `${cents > 0 ? "+" : "−"}${fmt(Math.abs(cents))}`;
}

export function fmtUnit(cents: Cents, unit: string): string {
  return `${fmt(cents)}/${unit}`;
}

export function fmtQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(qty * 10 === Math.round(qty * 10) ? 1 : 2);
}
