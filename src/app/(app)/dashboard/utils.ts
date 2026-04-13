import { differenceInDays, eachDayOfInterval, eachMonthOfInterval, format, isSameDay, isSameMonth, startOfMonth, subDays, subMonths } from 'date-fns';
import type { Transaction } from '@/lib/types';

export function getLast30DaysRange(): { start: Date; end: Date } {
  const end = new Date();
  const start = subDays(end, 29);
  return { start, end };
}

export function getLast12MonthsRange(): { start: Date; end: Date } {
  const end = new Date();
  const start = startOfMonth(subMonths(end, 11));
  return { start, end };
}

export function toDate(value: string | Date | undefined | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export type MonthlyOverviewPoint = {
  year: number;
  month: number;
  label: string;
  income: number;
  expenses: number;
};

export function buildMonthlyOverviewData(transactions: Transaction[]): MonthlyOverviewPoint[] {
  const { start, end } = getLast12MonthsRange();
  const months = eachMonthOfInterval({ start, end });

  return months.map((monthDate) => {
    const monthTransactions = transactions.filter((t) => {
      const date = toDate(t.date);
      return date ? isSameMonth(date, monthDate) : false;
    });

    const income = monthTransactions
      .filter((t) => t.type === 'Income')
      .reduce((sum, t) => sum + t.amountBase, 0);

    const expenses = monthTransactions
      .filter((t) => t.type === 'Expense')
      .reduce((sum, t) => sum + Math.abs(t.amountBase), 0);

    return {
      year: monthDate.getFullYear(),
      month: monthDate.getMonth(),
      label: format(monthDate, 'MMM yy'),
      income,
      expenses,
    };
  });
}

export function buildRangeOverviewData(
  transactions: Transaction[],
  start: Date,
  end: Date
): MonthlyOverviewPoint[] {
  const daysDiff = differenceInDays(end, start);

  if (daysDiff <= 60) {
    // Daily grouping
    const days = eachDayOfInterval({ start, end });
    return days.map((day) => {
      const dayTxs = transactions.filter((t) => {
        const date = toDate(t.date);
        return date ? isSameDay(date, day) : false;
      });
      const income = dayTxs.filter(t => t.type === 'Income').reduce((s, t) => s + t.amountBase, 0);
      const expenses = dayTxs.filter(t => t.type === 'Expense').reduce((s, t) => s + Math.abs(t.amountBase), 0);
      return { year: day.getFullYear(), month: day.getMonth(), label: format(day, 'MMM d'), income, expenses };
    });
  }

  if (daysDiff <= 365) {
    // Monthly grouping
    const months = eachMonthOfInterval({ start, end });
    return months.map((monthDate) => {
      const monthTxs = transactions.filter((t) => {
        const date = toDate(t.date);
        return date ? isSameMonth(date, monthDate) : false;
      });
      const income = monthTxs.filter(t => t.type === 'Income').reduce((s, t) => s + t.amountBase, 0);
      const expenses = monthTxs.filter(t => t.type === 'Expense').reduce((s, t) => s + Math.abs(t.amountBase), 0);
      return { year: monthDate.getFullYear(), month: monthDate.getMonth(), label: format(monthDate, 'MMM yy'), income, expenses };
    });
  }

  // Quarterly grouping for very large ranges (> 1 year)
  const months = eachMonthOfInterval({ start, end });
  const quarters: MonthlyOverviewPoint[] = [];
  for (let i = 0; i < months.length; i += 3) {
    const quarterMonths = months.slice(i, i + 3);
    const quarterTxs = transactions.filter((t) => {
      const date = toDate(t.date);
      return date ? quarterMonths.some(m => isSameMonth(date, m)) : false;
    });
    const firstMonth = quarterMonths[0];
    const income = quarterTxs.filter(t => t.type === 'Income').reduce((s, t) => s + t.amountBase, 0);
    const expenses = quarterTxs.filter(t => t.type === 'Expense').reduce((s, t) => s + Math.abs(t.amountBase), 0);
    quarters.push({ year: firstMonth.getFullYear(), month: firstMonth.getMonth(), label: `Q${Math.floor(i / 3) + 1} ${firstMonth.getFullYear()}`, income, expenses });
  }
  return quarters;
}
