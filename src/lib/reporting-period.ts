import {
  differenceInCalendarDays,
  eachMonthOfInterval,
  endOfMonth,
  getDaysInMonth,
  startOfDay,
  startOfMonth,
} from 'date-fns';

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
