import { endOfMonth, startOfMonth, subMonths } from 'date-fns';
import type { BudgetLine, Category, Transaction } from './types';
import { findBudgetLineForMonth, isBudgetableCategory } from './budget-planning';
import {
  calculateEquivalentCalendarMonths,
  selectConfirmedReportingPeriodTransactions,
} from './reporting-period';
import {
  getReportingExpenseContribution,
  isReportingExpenseRecord,
} from './transaction-reporting';
import type { BudgetMonthReference } from './data-management/budget-copy';
import { centsToMoney, divideMoneyCents, moneyToCents } from './money-rounding';

export type BudgetSuggestionRow = {
  categoryId: string;
  categoryName: string;
  hasHistory: boolean;
  historicalNetExpense: number;
  historicalMonthlyAverage?: number;
  hasTargetBudget: boolean;
  currentTargetBudget?: number;
  proposedBudget?: number;
  selectedByDefault: boolean;
};

export type BudgetSuggestionModel = {
  workspaceId: string;
  target: BudgetMonthReference;
  historyFrom: BudgetMonthReference;
  historyTo: BudgetMonthReference;
  periodStart: Date;
  periodEnd: Date;
  equivalentMonths: number;
  rows: BudgetSuggestionRow[];
};

export type BudgetSuggestionSelection = {
  entries: Array<{ categoryId: string; amount: number }>;
  selectedTotal: number;
  newBudgetCount: number;
  replacementCount: number;
};

const monthIndex = ({ year, month }: BudgetMonthReference) => year * 12 + month - 1;

export const startOfBudgetMonth = ({ year, month }: BudgetMonthReference) => (
  startOfMonth(new Date(year, month - 1, 1))
);

export const endOfBudgetMonth = ({ year, month }: BudgetMonthReference) => (
  endOfMonth(new Date(year, month - 1, 1))
);

export function getDefaultBudgetSuggestionRange(
  target: BudgetMonthReference
): { from: BudgetMonthReference; to: BudgetMonthReference } {
  const targetDate = startOfBudgetMonth(target);
  const fromDate = subMonths(targetDate, 3);
  const toDate = subMonths(targetDate, 1);
  return {
    from: { year: fromDate.getFullYear(), month: fromDate.getMonth() + 1 },
    to: { year: toDate.getFullYear(), month: toDate.getMonth() + 1 },
  };
}

export function validateBudgetSuggestionRange(
  from: BudgetMonthReference,
  to: BudgetMonthReference,
  target: BudgetMonthReference
) {
  for (const [label, period] of [['From', from], ['To', to], ['Target', target]] as const) {
    if (!Number.isInteger(period.year) || !Number.isInteger(period.month) || period.month < 1 || period.month > 12) {
      throw new Error(`${label} month is invalid.`);
    }
  }
  if (monthIndex(from) > monthIndex(to)) {
    throw new Error('The historical From month must not be after the To month.');
  }
  if (monthIndex(to) >= monthIndex(target)) {
    throw new Error('The historical period must end before the target month.');
  }
}

export function buildBudgetSuggestionModel(input: {
  workspaceId: string;
  target: BudgetMonthReference;
  historyFrom: BudgetMonthReference;
  historyTo: BudgetMonthReference;
  transactions: Transaction[];
  categories: Category[];
  budgetLines: BudgetLine[];
}): BudgetSuggestionModel {
  validateBudgetSuggestionRange(input.historyFrom, input.historyTo, input.target);
  const periodStart = startOfBudgetMonth(input.historyFrom);
  const periodEnd = endOfBudgetMonth(input.historyTo);
  const equivalentMonths = calculateEquivalentCalendarMonths(periodStart, periodEnd);
  const categories = input.categories
    .filter((category) => category.workspaceId === input.workspaceId && isBudgetableCategory(category))
    .slice()
    .sort((left, right) => (
      left.order - right.order || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    ));
  const categoryIds = new Set(categories.map((category) => category.id));
  const reportingTransactions = selectConfirmedReportingPeriodTransactions(
    input.transactions.filter((transaction) => transaction.workspaceId === input.workspaceId),
    periodStart,
    periodEnd
  );
  const historyByCategory = new Map<string, { cents: number; recordCount: number }>();

  for (const transaction of reportingTransactions) {
    if (!transaction.categoryId || !categoryIds.has(transaction.categoryId)) continue;
    if (!isReportingExpenseRecord(transaction, categories)) continue;
    const current = historyByCategory.get(transaction.categoryId) ?? { cents: 0, recordCount: 0 };
    current.cents += Math.round(getReportingExpenseContribution(transaction, categories) * 100);
    current.recordCount += 1;
    historyByCategory.set(transaction.categoryId, current);
  }

  const rows = categories.map<BudgetSuggestionRow>((category) => {
    const history = historyByCategory.get(category.id);
    const historicalNetExpense = centsToMoney(history?.cents ?? 0);
    const historicalMonthlyAverage = history
      ? divideMoneyCents(history.cents, equivalentMonths)
      : undefined;
    const targetLine = findBudgetLineForMonth(input.budgetLines, category.id, input.target.month);
    const currentTargetBudget = targetLine
      ? targetLine.userAdjustedMonthly ?? targetLine.monthlyAverage
      : undefined;
    const proposedBudget = historicalMonthlyAverage !== undefined && historicalMonthlyAverage > 0
      ? historicalMonthlyAverage
      : undefined;
    return {
      categoryId: category.id,
      categoryName: category.name,
      hasHistory: Boolean(history),
      historicalNetExpense,
      historicalMonthlyAverage,
      hasTargetBudget: Boolean(targetLine),
      currentTargetBudget,
      proposedBudget,
      selectedByDefault: proposedBudget !== undefined && !targetLine,
    };
  });

  return {
    workspaceId: input.workspaceId,
    target: input.target,
    historyFrom: input.historyFrom,
    historyTo: input.historyTo,
    periodStart,
    periodEnd,
    equivalentMonths,
    rows,
  };
}

export function buildBudgetSuggestionSelection(
  rows: BudgetSuggestionRow[],
  selectedCategoryIds: ReadonlySet<string>,
  proposedAmounts: ReadonlyMap<string, number | undefined>
): BudgetSuggestionSelection {
  const rowsById = new Map(rows.map((row) => [row.categoryId, row]));
  const entries: Array<{ categoryId: string; amount: number }> = [];
  let totalCents = 0;
  let newBudgetCount = 0;
  let replacementCount = 0;

  for (const categoryId of selectedCategoryIds) {
    const row = rowsById.get(categoryId);
    if (!row) throw new Error('A selected category is no longer available.');
    const amount = proposedAmounts.get(categoryId);
    if (amount === undefined || !Number.isFinite(amount) || amount < 0) {
      throw new Error(`Enter a valid non-negative proposed budget for ${row.categoryName}.`);
    }
    const amountCents = moneyToCents(amount);
    entries.push({ categoryId, amount: centsToMoney(amountCents) });
    totalCents += amountCents;
    if (row.hasTargetBudget) replacementCount += 1;
    else newBudgetCount += 1;
  }

  return {
    entries,
    selectedTotal: centsToMoney(totalCents),
    newBudgetCount,
    replacementCount,
  };
}
