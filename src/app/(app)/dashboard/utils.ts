import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  eachMonthOfInterval,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from 'date-fns';
import type { Category, Transaction } from '@/lib/types';
import { isConfirmedExpense, isConfirmedIncome } from '@/lib/transaction-reporting';

export const UNCATEGORIZED_EXPENSE_SLICE_ID = '__uncategorized__';

export type DashboardRangeGrouping = 'daily' | 'monthly' | 'quarterly';

export type DashboardTotals = {
  income: number;
  expenses: number;
  net: number;
  savingsRate: number;
};

export type ExpenseCategoryPoint = {
  categoryId: string;
  categoryName: string;
  total: number;
};

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

export function isWithinDashboardCalendarRange(
  value: string | Date | undefined | null,
  start: Date,
  end: Date
): boolean {
  const date = toDate(value);
  if (!date) return false;
  const rangeStart = startOfDay(start);
  const rangeEndExclusive = addDays(startOfDay(end), 1);
  return date >= rangeStart && date < rangeEndExclusive;
}

export function selectDashboardPeriodTransactions(
  transactions: Transaction[],
  start: Date,
  end: Date
): Transaction[] {
  return transactions.filter(
    (transaction) =>
      !transaction.needsReview &&
      isWithinDashboardCalendarRange(transaction.date, start, end)
  );
}

export function calculateDashboardTotals(
  selectedPeriodTransactions: Transaction[]
): DashboardTotals {
  const income = selectedPeriodTransactions
    .filter(isConfirmedIncome)
    .reduce((sum, transaction) => sum + transaction.amountBase, 0);
  const expenses = selectedPeriodTransactions
    .filter(isConfirmedExpense)
    .reduce((sum, transaction) => sum + Math.abs(transaction.amountBase), 0);
  const net = income - expenses;
  return {
    income,
    expenses,
    net,
    savingsRate: income !== 0 ? net / income : 0,
  };
}

export function getDashboardRangeGrouping(start: Date, end: Date): DashboardRangeGrouping {
  const daysDiff = differenceInCalendarDays(startOfDay(end), startOfDay(start));
  if (daysDiff <= 60) return 'daily';
  if (daysDiff <= 365) return 'monthly';
  return 'quarterly';
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
      .filter(isConfirmedIncome)
      .reduce((sum, t) => sum + t.amountBase, 0);

    const expenses = monthTransactions
      .filter(isConfirmedExpense)
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
  selectedPeriodTransactions: Transaction[],
  start: Date,
  end: Date,
  grouping = getDashboardRangeGrouping(start, end)
): MonthlyOverviewPoint[] {
  if (grouping === 'daily') {
    // Daily grouping
    const days = eachDayOfInterval({ start: startOfDay(start), end: startOfDay(end) });
    return days.map((day) => {
      const dayTxs = selectedPeriodTransactions.filter((t) => {
        const date = toDate(t.date);
        return date ? isSameDay(date, day) : false;
      });
      const income = dayTxs.filter(isConfirmedIncome).reduce((s, t) => s + t.amountBase, 0);
      const expenses = dayTxs.filter(isConfirmedExpense).reduce((s, t) => s + Math.abs(t.amountBase), 0);
      return { year: day.getFullYear(), month: day.getMonth(), label: format(day, 'MMM d'), income, expenses };
    });
  }

  if (grouping === 'monthly') {
    // Monthly grouping
    const months = eachMonthOfInterval({ start: startOfDay(start), end: startOfDay(end) });
    return months.map((monthDate) => {
      const monthTxs = selectedPeriodTransactions.filter((t) => {
        const date = toDate(t.date);
        return date ? isSameMonth(date, monthDate) : false;
      });
      const income = monthTxs.filter(isConfirmedIncome).reduce((s, t) => s + t.amountBase, 0);
      const expenses = monthTxs.filter(isConfirmedExpense).reduce((s, t) => s + Math.abs(t.amountBase), 0);
      return { year: monthDate.getFullYear(), month: monthDate.getMonth(), label: format(monthDate, 'MMM yy'), income, expenses };
    });
  }

  // Quarterly grouping for very large ranges (> 1 year)
  const months = eachMonthOfInterval({ start: startOfDay(start), end: startOfDay(end) });
  const quarters: MonthlyOverviewPoint[] = [];
  for (let i = 0; i < months.length; i += 3) {
    const quarterMonths = months.slice(i, i + 3);
    const quarterTxs = selectedPeriodTransactions.filter((t) => {
      const date = toDate(t.date);
      return date ? quarterMonths.some(m => isSameMonth(date, m)) : false;
    });
    const firstMonth = quarterMonths[0];
    const income = quarterTxs.filter(isConfirmedIncome).reduce((s, t) => s + t.amountBase, 0);
    const expenses = quarterTxs.filter(isConfirmedExpense).reduce((s, t) => s + Math.abs(t.amountBase), 0);
    quarters.push({ year: firstMonth.getFullYear(), month: firstMonth.getMonth(), label: `Q${Math.floor(i / 3) + 1} ${firstMonth.getFullYear()}`, income, expenses });
  }
  return quarters;
}

export function buildExpenseCategoryData(
  selectedPeriodTransactions: Transaction[],
  categories: Pick<Category, 'id' | 'name'>[]
): ExpenseCategoryPoint[] {
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const totals = new Map<string, number>();

  for (const transaction of selectedPeriodTransactions.filter(isConfirmedExpense)) {
    const categoryId = transaction.categoryId || UNCATEGORIZED_EXPENSE_SLICE_ID;
    totals.set(categoryId, (totals.get(categoryId) ?? 0) + Math.abs(transaction.amountBase));
  }

  return Array.from(totals.entries())
    .map(([categoryId, total]) => ({
      categoryId,
      categoryName: categoryId === UNCATEGORIZED_EXPENSE_SLICE_ID
        ? 'Uncategorized'
        : categoryNames.get(categoryId) ?? 'Unknown category',
      total,
    }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total);
}

export function getPeriodAverageDescription(
  grouping: DashboardRangeGrouping,
  pointCount: number
): string {
  const label = grouping === 'daily'
    ? 'calendar day'
    : grouping === 'monthly' ? 'calendar month' : 'quarter';
  const unit = pointCount === 1 ? label : `${label}s`;
  const prefix = grouping === 'daily' ? 'Daily' : grouping === 'monthly' ? 'Monthly' : 'Quarterly';
  return `${prefix} average across ${pointCount} ${unit}`;
}

export function getOverviewDescription(grouping: DashboardRangeGrouping): string {
  const prefix = grouping === 'daily' ? 'Daily' : grouping === 'monthly' ? 'Monthly' : 'Quarterly';
  return `${prefix} totals in selected period.`;
}

export function buildDashboardReport(
  transactions: Transaction[],
  categories: Pick<Category, 'id' | 'name'>[],
  start: Date,
  end: Date
) {
  const selectedPeriodTransactions = selectDashboardPeriodTransactions(transactions, start, end);
  const totals = calculateDashboardTotals(selectedPeriodTransactions);
  const grouping = getDashboardRangeGrouping(start, end);
  const overviewData = buildRangeOverviewData(selectedPeriodTransactions, start, end, grouping);
  const expenseCategoryData = buildExpenseCategoryData(selectedPeriodTransactions, categories);
  const pointCount = overviewData.length || 1;

  return {
    selectedPeriodTransactions,
    totals,
    grouping,
    overviewData,
    expenseCategoryData,
    averages: {
      income: totals.income / pointCount,
      expenses: totals.expenses / pointCount,
      savingsRate: totals.savingsRate,
      description: getPeriodAverageDescription(grouping, overviewData.length),
    },
  };
}
