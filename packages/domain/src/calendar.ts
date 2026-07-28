import type { FocusCalendar, ISODate, ISOInstant } from "./model.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch {
    throw new Error(`Invalid IANA time zone: ${timeZone}`);
  }
}

export function localDateOf(instant: ISOInstant | Date, timeZone: string): ISODate {
  assertValidTimeZone(timeZone);
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid instant");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function assertISODate(value: string): asserts value is ISODate {
  if (!DATE_PATTERN.test(value)) throw new Error("Date must use YYYY-MM-DD");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  if (date.toISOString().slice(0, 10) !== value) throw new Error("Invalid calendar date");
}

export function addLocalDays(date: ISODate, days: number): ISODate {
  assertISODate(date);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function isPlannedFocusDay(date: ISODate, calendar: FocusCalendar): boolean {
  assertISODate(date);
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return !calendar.restWeekdays.includes(weekday);
}

export function countPlannedFocusDaysAfter(
  anchorDate: ISODate,
  throughDate: ISODate,
  calendar: FocusCalendar,
): number {
  assertISODate(anchorDate);
  assertISODate(throughDate);
  if (throughDate <= anchorDate) return 0;
  let count = 0;
  for (let date = addLocalDays(anchorDate, 1); date <= throughDate; date = addLocalDays(date, 1)) {
    if (isPlannedFocusDay(date, calendar)) count += 1;
  }
  return count;
}
