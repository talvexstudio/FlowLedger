import type { BudgetLine, Category, Subcategory, Transaction } from './types';
import { calculateBudgetActualSpending, calculateBudgetPosition } from './budget-reporting';
import { shiftBudgetMonth } from './budget-navigation';
import type { BudgetMonthReference } from './data-management/budget-copy';

export type BudgetPlanningRow = {
  categoryId: string;
  categoryName: string;
  monthlyBudget: number;
  used: number;
  progress: number;
  remaining: number;
  hasBudget: boolean;
};

type WorkspaceCategory = Category & { subcategories: Subcategory[] };

export const isBudgetableCategory = (category: Pick<Category, 'type'>) =>
  category.type === 'expense' || category.type === 'both';

export const findBudgetLineForMonth = (
  budgetLines: BudgetLine[],
  categoryId: string,
  calendarMonth: number
) => budgetLines.find((line) => line.categoryId === categoryId && line.month === calendarMonth)
  ?? budgetLines.find((line) => line.categoryId === categoryId && line.month === undefined);

export const getPreviousBudgetMonthReference = (
  selectedMonth: number,
  selectedYear: number
): BudgetMonthReference => {
  const previous = shiftBudgetMonth({ month: selectedMonth, year: selectedYear }, -1);
  return { year: previous.year, month: previous.month + 1 };
};

export function buildBudgetPlanningRows(
  budgetLines: BudgetLine[],
  transactions: Transaction[],
  categories: WorkspaceCategory[],
  selectedMonth: number,
  selectedYear: number
): BudgetPlanningRow[] {
  const calendarMonth = selectedMonth + 1;
  return categories
    .filter(isBudgetableCategory)
    .slice()
    .sort((left, right) => (
      left.order - right.order || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    ))
    .map((category) => {
      const line = findBudgetLineForMonth(budgetLines, category.id, calendarMonth);
      const monthlyBudget = line?.userAdjustedMonthly ?? line?.monthlyAverage ?? 0;
      const actuals = calculateBudgetActualSpending(transactions, categories, {
        categoryId: category.id,
        month: selectedMonth,
        year: selectedYear,
      });
      const position = calculateBudgetPosition(monthlyBudget, actuals);
      return {
        categoryId: category.id,
        categoryName: category.name,
        monthlyBudget,
        used: position.used,
        progress: position.progress,
        remaining: position.remaining,
        hasBudget: Boolean(line),
      };
    });
}
