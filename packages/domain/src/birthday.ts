import { assertISODate } from './calendar.js';

export interface BirthdaySettings { enabled: boolean; month: number; day: number }
export interface BirthdayReward {
  year: number;
  date: string;
  awardedAt: string;
  /** No project yet is valid: the keepsake waits for the first visible plot. */
  settlementIndex: number | null;
}
export const DEFAULT_BIRTHDAY: Readonly<BirthdaySettings> = Object.freeze({ enabled: false, month: 1, day: 1 });

export function isBirthdayDateValid(month: number, day: number): boolean {
  return Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12
    && day >= 1 && day <= new Date(Date.UTC(2000, month, 0)).getUTCDate();
}

/** A leap-day birthday is observed on February 28 in non-leap years. */
export function birthdayOnDate(settings: BirthdaySettings, date: string): boolean {
  assertISODate(date);
  if (!settings.enabled || !isBirthdayDateValid(settings.month, settings.day)) return false;
  const year = Number(date.slice(0, 4));
  const day = Math.min(settings.day, new Date(Date.UTC(year, settings.month, 0)).getUTCDate());
  return date.slice(5) === `${String(settings.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
