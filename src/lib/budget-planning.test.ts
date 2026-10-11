import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBudgetPlanningRows, getPreviousBudgetMonthReference } from './budget-planning';
import type { BudgetLine, Category, Subcategory, Transaction } from './types';

const workspaceId = 'ws-plan';
type WorkspaceCategory = Category & { subcategories: Subcategory[] };

const categories: WorkspaceCategory[] = [
  { id: 'cat-expense', workspaceId, name: 'Housing', type: 'expense', order: 2, isSystem: false, subcategories: [] },
  { id: 'cat-both', workspaceId, name: 'Mixed', type: 'both', order: 1, isSystem: false, subcategories: [] },
  { id: 'cat-income', workspaceId, name: 'Salary', type: 'income', order: 3, isSystem: false, subcategories: [] },
];

const line = (categoryId: string, month: number, amount: number): BudgetLine => ({
  id: `line-${categoryId}-${month}`,
  budgetId: 'budget-2027',
  month,
  type: 'Expense',
  categoryId,
  subcategoryId: '',
  totalSample: 0,
  monthlyAverage: amount,
  annualBudget: amount * 12,
  percentageOfType: 0,
  userAdjustedMonthly: amount,
});

const transaction = (id: string, categoryId: string, amountBase: number): Transaction => ({
  id,
  workspaceId,
  accountId: 'acc-1',
  date: new Date(2027, 9, 10),
  description: id,
  rawDescription: id,
  amountOriginal: amountBase,
  currencyOriginal: 'EUR',
  amountBase,
  type: amountBase < 0 ? 'Expense' : 'Income',
  categoryId,
  needsReview: false,
  isInternalTransfer: false,
  isPotentialDuplicate: false,
  isInconsistent: false,
  createdAt: new Date(2027, 9, 10),
  updatedAt: new Date(2027, 9, 10),
});

test('future month with no activity still exposes every budgetable category in canonical order', () => {
  const rows = buildBudgetPlanningRows([], [], categories, 9, 2027);

  assert.deepEqual(rows.map((row) => row.categoryId), ['cat-both', 'cat-expense']);
  assert.ok(rows.every((row) => row.used === 0 && !row.hasBudget));
  assert.ok(rows.every((row) => row.monthlyBudget === 0));
  assert.equal(rows.some((row) => row.categoryId === 'cat-income'), false);
});

test('budget, spending, and planning-only categories remain visible independently', () => {
  const rows = buildBudgetPlanningRows(
    [line('cat-expense', 10, 1_200)],
    [transaction('mixed-spend', 'cat-both', -80)],
    categories,
    9,
    2027
  );

  const housing = rows.find((row) => row.categoryId === 'cat-expense')!;
  const mixed = rows.find((row) => row.categoryId === 'cat-both')!;
  assert.equal(housing.hasBudget, true);
  assert.equal(housing.used, 0);
  assert.equal(housing.remaining, 1_200);
  assert.equal(mixed.hasBudget, false);
  assert.equal(mixed.used, 80);
});

test('removing a monthly line returns the category to an editable no-budget planning row', () => {
  const withBudget = buildBudgetPlanningRows([line('cat-expense', 10, 500)], [], categories, 9, 2027);
  const withoutBudget = buildBudgetPlanningRows([], [], categories, 9, 2027);

  assert.equal(withBudget.find((row) => row.categoryId === 'cat-expense')?.hasBudget, true);
  const cleared = withoutBudget.find((row) => row.categoryId === 'cat-expense')!;
  assert.equal(cleared.hasBudget, false);
  assert.equal(cleared.used, 0);
});

test('used remains reimbursement-aware and month-specific lines do not leak across months', () => {
  const rows = buildBudgetPlanningRows(
    [line('cat-expense', 10, 500), line('cat-expense', 11, 700)],
    [transaction('expense', 'cat-expense', -400), transaction('reimbursement', 'cat-expense', 100)],
    categories,
    9,
    2027
  );
  const housing = rows.find((row) => row.categoryId === 'cat-expense')!;
  assert.equal(housing.monthlyBudget, 500);
  assert.equal(housing.used, 300);
  assert.equal(housing.remaining, 200);
});

test('copy previous month resolves the immediately preceding calendar month', () => {
  assert.deepEqual(getPreviousBudgetMonthReference(9, 2027), { year: 2027, month: 9 });
  assert.deepEqual(getPreviousBudgetMonthReference(0, 2027), { year: 2026, month: 12 });
});
