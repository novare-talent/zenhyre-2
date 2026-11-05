/** All money in the system is integer paise. */
export type Paise = number;

export function rupees(r: number): Paise {
  return Math.round(r * 100);
}

export function percentOf(amount: Paise, rate: number): Paise {
  return Math.round(amount * rate);
}

export function formatPaise(p: Paise): string {
  const r = Math.round(p / 100);
  return "₹" + new Intl.NumberFormat("en-IN").format(r);
}
