import type { Category, Transaction } from './types';
import { calculateReportingTotals, type ReportingTotals } from './transaction-reporting';

export type BudgetActualScope = {
  categoryId: string;
  subcategoryId?: string;
  month: number;
  year: number;
};

export type BudgetPosition = {
  used: number;
  remaining: number;
  progress: number;
};

export function calculateBudgetPosition(monthlyBudget: number, actuals: ReportingTotals): BudgetPosition {
  const used = actuals.netExpenses;
  return {
    used,
    remaining: monthlyBudget - used,
    progress: monthlyBudget > 0
      ? Math.max(0, Math.min((used / monthlyBudget) * 100, 100))
      : 0,
  };
}

export function calculateBudgetActualSpending(
  transactions: Transaction[],
  categories: Pick<Category, 'id' | 'type'>[],
  scope: BudgetActualScope
): ReportingTotals {
  const scopedTransactions = transactions.filter((transaction) => {
    const date = transaction.date instanceof Date ? transaction.date : new Date(transaction.date);
    return transaction.categoryId === scope.categoryId &&
      (!scope.subcategoryId || transaction.subcategoryId === scope.subcategoryId) &&
      date.getMonth() === scope.month &&
      date.getFullYear() === scope.year;
  });

  return calculateReportingTotals(scopedTransactions, categories);
}
