import {
  addDays,
  differenceInCalendarDays,
  eachMonthOfInterval,
  endOfMonth,
  getDaysInMonth,
  startOfDay,
  startOfMonth,
} from 'date-fns';
import type { Transaction } from './types';

export function toReportingDate(value: string | Date | undefined | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isWithinReportingCalendarRange(
  value: string | Date | undefined | null,
  start: Date,
  end: Date
): boolean {
  const date = toReportingDate(value);
  if (!date) return false;
  const rangeStart = startOfDay(start);
  const rangeEndExclusive = addDays(startOfDay(end), 1);
  return date >= rangeStart && date < rangeEndExclusive;
}

export function selectConfirmedReportingPeriodTransactions(
  transactions: Transaction[],
  start: Date,
  end: Date
): Transaction[] {
  return transactions.filter((transaction) => (
    !transaction.needsReview && isWithinReportingCalendarRange(transaction.date, start, end)
  ));
}

export function calculateEquivalentCalendarMonths(start: Date, end: Date): number {
  const rangeStart = startOfDay(start);
  const rangeEnd = startOfDay(end);
  if (rangeEnd < rangeStart) return 0;

  return eachMonthOfInterval({ start: rangeStart, end: rangeEnd }).reduce((total, month) => {
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    const coveredStart = rangeStart > monthStart ? rangeStart : monthStart;
    const coveredEnd = rangeEnd < monthEnd ? rangeEnd : monthEnd;
    const coveredDays = differenceInCalendarDays(coveredEnd, coveredStart) + 1;
    return total + coveredDays / getDaysInMonth(month);
  }, 0);
}

export function calculateMonthlyAverage(netExpense: number, equivalentMonths: number): number {
  return equivalentMonths > 0 ? netExpense / equivalentMonths : 0;
}
