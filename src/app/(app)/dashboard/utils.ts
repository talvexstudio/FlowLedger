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
import {
  calculateReportingTotals,
  isConfirmedExpense,
  isReimbursement,
} from '@/lib/transaction-reporting';

export const UNCATEGORIZED_EXPENSE_SLICE_ID = '__uncategorized__';

export type DashboardRangeGrouping = 'daily' | 'monthly' | 'quarterly';

export type DashboardTotals = {
  income: number;
  grossExpenses: number;
  reimbursements: number;
  expenses: number;
  net: number;
  savingsRate: number;
};

export type ExpenseCategoryPoint = {
  categoryId: string;
  categoryName: string;
  grossExpense: number;
  reimbursements: number;
  netExpense: number;
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
  selectedPeriodTransactions: Transaction[],
  categories: Pick<Category, 'id' | 'type'>[]
): DashboardTotals {
  const reportingTotals = calculateReportingTotals(selectedPeriodTransactions, categories);
  const income = reportingTotals.ordinaryIncome;
  const expenses = reportingTotals.netExpenses;
  const net = income - expenses;
  return {
    income,
    grossExpenses: reportingTotals.grossExpenses,
    reimbursements: reportingTotals.reimbursements,
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

export function buildMonthlyOverviewData(
  transactions: Transaction[],
  categories: Pick<Category, 'id' | 'type'>[]
): MonthlyOverviewPoint[] {
  const { start, end } = getLast12MonthsRange();
  const months = eachMonthOfInterval({ start, end });

  return months.map((monthDate) => {
    const monthTransactions = transactions.filter((t) => {
      const date = toDate(t.date);
      return date ? isSameMonth(date, monthDate) : false;
    });

    const totals = calculateReportingTotals(monthTransactions, categories);
    const income = totals.ordinaryIncome;
    const expenses = totals.netExpenses;

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
  categories: Pick<Category, 'id' | 'type'>[],
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
      const totals = calculateReportingTotals(dayTxs, categories);
      const income = totals.ordinaryIncome;
      const expenses = totals.netExpenses;
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
      const totals = calculateReportingTotals(monthTxs, categories);
      const income = totals.ordinaryIncome;
      const expenses = totals.netExpenses;
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
    const totals = calculateReportingTotals(quarterTxs, categories);
    const income = totals.ordinaryIncome;
    const expenses = totals.netExpenses;
    quarters.push({ year: firstMonth.getFullYear(), month: firstMonth.getMonth(), label: `Q${Math.floor(i / 3) + 1} ${firstMonth.getFullYear()}`, income, expenses });
  }
  return quarters;
}

export function buildExpenseCategoryData(
  selectedPeriodTransactions: Transaction[],
  categories: Pick<Category, 'id' | 'name' | 'type'>[]
): ExpenseCategoryPoint[] {
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const totals = new Map<string, { grossExpenseCents: number; reimbursementCents: number }>();

  for (const transaction of selectedPeriodTransactions) {
    const grossExpense = isConfirmedExpense(transaction);
    const reimbursement = isReimbursement(transaction, categories);
    if (!grossExpense && !reimbursement) continue;
    const categoryId = transaction.categoryId || UNCATEGORIZED_EXPENSE_SLICE_ID;
    const current = totals.get(categoryId) ?? { grossExpenseCents: 0, reimbursementCents: 0 };
    if (grossExpense) current.grossExpenseCents += Math.round(Math.abs(transaction.amountBase) * 100);
    else current.reimbursementCents += Math.round(Math.abs(transaction.amountBase) * 100);
    totals.set(categoryId, current);
  }

  return Array.from(totals.entries())
    .map(([categoryId, amounts]) => {
      const grossExpense = amounts.grossExpenseCents / 100;
      const reimbursements = amounts.reimbursementCents / 100;
      const netExpense = (amounts.grossExpenseCents - amounts.reimbursementCents) / 100;
      return {
        categoryId,
        categoryName: categoryId === UNCATEGORIZED_EXPENSE_SLICE_ID
          ? 'Uncategorized'
          : categoryNames.get(categoryId) ?? 'Unknown category',
        grossExpense,
        reimbursements,
        netExpense,
        total: netExpense,
      };
    })
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
  categories: Pick<Category, 'id' | 'name' | 'type'>[],
  start: Date,
  end: Date
) {
  const selectedPeriodTransactions = selectDashboardPeriodTransactions(transactions, start, end);
  const totals = calculateDashboardTotals(selectedPeriodTransactions, categories);
  const grouping = getDashboardRangeGrouping(start, end);
  const overviewData = buildRangeOverviewData(selectedPeriodTransactions, categories, start, end, grouping);
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
