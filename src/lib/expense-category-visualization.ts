import type { ExpenseCategoryPoint } from '@/app/(app)/dashboard/utils';

export const EXPENSE_CATEGORY_COLORS = [
  '#4F46E5',
  '#06B6D4',
  '#22C55E',
  '#F97316',
  '#EC4899',
  '#0EA5E9',
  '#A855F7',
];

export const NON_POSITIVE_CATEGORY_COLOR = '#94A3B8';

export type ExpenseCategoryVisualizationItem = ExpenseCategoryPoint & {
  color: string;
  representedInPie: boolean;
};

export function buildExpenseCategoryVisualization(data: ExpenseCategoryPoint[]) {
  let positiveIndex = 0;
  const listItems = data.map<ExpenseCategoryVisualizationItem>((entry) => {
    const representedInPie = entry.netExpense > 0;
    const color = representedInPie
      ? EXPENSE_CATEGORY_COLORS[positiveIndex++ % EXPENSE_CATEGORY_COLORS.length]
      : NON_POSITIVE_CATEGORY_COLOR;
    return { ...entry, color, representedInPie };
  });

  return {
    listItems,
    pieItems: listItems.filter((entry) => entry.representedInPie),
    hasNonPositiveCategories: listItems.some((entry) => !entry.representedInPie),
  };
}
