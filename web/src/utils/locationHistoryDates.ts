/** Format a Date as YYYY-MM-DD in local time. */
export function formatLocalDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseLocalDateInput(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

/** Default "to" date: calendar day of 48 hours ago at local midnight. */
export function defaultLocationHistoryToDate(): string {
  const date = new Date(Date.now() - 48 * 60 * 60 * 1000);
  return formatLocalDateInput(date);
}

export function buildLocationHistoryBounds(
  fromMode: "now" | "date",
  fromDate: string,
  toDate: string
): { fromAt: Date; toAt: Date } {
  const fromAt =
    fromMode === "now" ? new Date() : parseLocalDateInput(fromDate);
  const toAt = parseLocalDateInput(toDate);

  if (toAt.getTime() > fromAt.getTime()) {
    throw new Error('"To" must be on or before "From".');
  }

  return { fromAt, toAt };
}
