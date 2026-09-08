const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const MIN_YEAR = 1990;

export function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

/** AR-2.2: "current calendar year" is the system clock's year, evaluated in UTC. */
export function currentCalendarYear(): number {
  return new Date().getUTCFullYear();
}

export function isValidYear(year: number): boolean {
  return Number.isInteger(year) && year >= MIN_YEAR && year <= currentCalendarYear() + 1;
}

export function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function isValidCurrencyCode(value: string): boolean {
  return CURRENCY_CODE_PATTERN.test(value);
}

/** AR-2.3: bound floating-point representation error for 2-decimal-minor-unit currencies. */
export function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
