import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBudgetSuggestionModel,
  buildBudgetSuggestionSelection,
  getDefaultBudgetSuggestionRange,
} from './budget-suggestions';
import type { BudgetLine, Category, Transaction } from './types';
import { calculateMonthlyAverage } from './reporting-period';

const workspaceId = 'ws1';
const now = new Date('2026-10-01T00:00:00.000Z');

const category = (id: string, type: Category['type'], order: number): Category => ({
  id,
  workspaceId,
  name: id,
  type,
  order,
  isSystem: false,
});

const transaction = (
  id: string,
  date: string,
  type: Transaction['type'],
  amountBase: number,
  categoryId?: string,
  overrides: Partial<Transaction> = {}
): Transaction => ({
  id,
  workspaceId,
  accountId: 'acc-1',
  date: new Date(date),
  description: id,
  rawDescription: id,
  amountOriginal: amountBase,
  currencyOriginal: 'EUR',
  amountBase,
  type,
  categoryId,
  needsReview: false,
  isInternalTransfer: type === 'InternalTransfer',
  isPotentialDuplicate: false,
  isInconsistent: false,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const budgetLine = (categoryId: string, amount: number): BudgetLine => ({
  id: `line-${categoryId}`,
  budgetId: 'budget-2026',
  month: 10,
  type: 'Expense',
  categoryId,
  subcategoryId: '',
  totalSample: 0,
  monthlyAverage: amount,
  annualBudget: amount * 12,
  percentageOfType: 0,
  userAdjustedMonthly: amount,
});

const categories = [
  category('expense', 'expense', 1),
  category('both', 'both', 2),
  category('zero', 'expense', 3),
  category('negative', 'expense', 4),
  category('no-history', 'expense', 5),
  category('income-only', 'income', 6),
];

const buildModel = (lines: BudgetLine[] = []) => buildBudgetSuggestionModel({
  workspaceId,
  target: { year: 2026, month: 10 },
  historyFrom: { year: 2026, month: 7 },
  historyTo: { year: 2026, month: 9 },
  categories,
  budgetLines: lines,
  transactions: [
    transaction('expense-jul', '2026-07-01T00:00:00.000Z', 'Expense', -300, 'expense'),
    transaction('expense-aug', '2026-08-15T12:00:00.000Z', 'Expense', -300, 'expense'),
    transaction('expense-sep', '2026-09-30T20:00:00.000Z', 'Expense', -300, 'expense'),
    transaction('reimbursement', '2026-08-20T12:00:00.000Z', 'Income', 150, 'expense'),
    transaction('both-expense', '2026-09-10T12:00:00.000Z', 'Expense', -90, 'both'),
    transaction('zero-expense', '2026-07-10T12:00:00.000Z', 'Expense', -100, 'zero'),
    transaction('zero-refund', '2026-08-10T12:00:00.000Z', 'Income', 100, 'zero'),
    transaction('negative-expense', '2026-07-11T12:00:00.000Z', 'Expense', -50, 'negative'),
    transaction('negative-refund', '2026-07-12T12:00:00.000Z', 'Income', 100, 'negative'),
    transaction('ordinary-income', '2026-08-01T12:00:00.000Z', 'Income', 1000),
    transaction('pending', '2026-08-02T12:00:00.000Z', 'Expense', -999, 'expense', { needsReview: true }),
    transaction('transfer', '2026-08-03T12:00:00.000Z', 'InternalTransfer', -999, 'expense'),
    transaction('adjustment', '2026-08-04T12:00:00.000Z', 'Adjustment', -999, 'expense'),
    transaction('target-month', '2026-10-01T00:00:00.000Z', 'Expense', -999, 'expense'),
    transaction('other-workspace', '2026-08-05T12:00:00.000Z', 'Expense', -999, 'expense', { workspaceId: 'ws2' }),
    transaction('income-category', '2026-08-06T12:00:00.000Z', 'Expense', -999, 'income-only'),
  ],
});

test('default history is the three complete months before the target, including year boundaries', () => {
  assert.deepEqual(getDefaultBudgetSuggestionRange({ year: 2026, month: 10 }), {
    from: { year: 2026, month: 7 },
    to: { year: 2026, month: 9 },
  });
  assert.deepEqual(getDefaultBudgetSuggestionRange({ year: 2026, month: 2 }), {
    from: { year: 2025, month: 11 },
    to: { year: 2026, month: 1 },
  });
});

test('historical model uses reimbursement-aware net spending and excludes non-reporting populations', () => {
  const model = buildModel();
  const expense = model.rows.find((row) => row.categoryId === 'expense')!;
  const both = model.rows.find((row) => row.categoryId === 'both')!;

  assert.equal(model.equivalentMonths, 3);
  assert.equal(expense.historicalNetExpense, 750);
  assert.equal(expense.historicalMonthlyAverage, 250);
  assert.equal(both.historicalMonthlyAverage, 30);
  assert.equal(model.rows.some((row) => row.categoryId === 'income-only'), false);
  assert.equal(expense.selectedByDefault, true);
});

test('zero, negative, and absent history remain distinguishable and are not proposed automatically', () => {
  const model = buildModel();
  const zero = model.rows.find((row) => row.categoryId === 'zero')!;
  const negative = model.rows.find((row) => row.categoryId === 'negative')!;
  const absent = model.rows.find((row) => row.categoryId === 'no-history')!;

  assert.equal(zero.hasHistory, true);
  assert.equal(zero.historicalMonthlyAverage, 0);
  assert.equal(zero.proposedBudget, undefined);
  assert.equal(zero.selectedByDefault, false);
  assert.equal(negative.hasHistory, true);
  assert.equal(negative.historicalNetExpense, -50);
  assert.ok((negative.historicalMonthlyAverage ?? 0) < 0);
  assert.equal(negative.proposedBudget, undefined);
  assert.equal(absent.hasHistory, false);
  assert.equal(absent.historicalMonthlyAverage, undefined);
});

test('existing target budgets are shown but not selected by default', () => {
  const model = buildModel([budgetLine('expense', 200)]);
  const expense = model.rows.find((row) => row.categoryId === 'expense')!;
  assert.equal(expense.hasTargetBudget, true);
  assert.equal(expense.currentTargetBudget, 200);
  assert.equal(expense.proposedBudget, 250);
  assert.equal(expense.selectedByDefault, false);
});

test('selection supports independent edits, counts replacements, totals cents, and rejects invalid amounts', () => {
  const model = buildModel([budgetLine('expense', 200)]);
  const selected = new Set(['expense', 'both']);
  const amounts = new Map<string, number | undefined>([['expense', 275.55], ['both', 40.10]]);
  const result = buildBudgetSuggestionSelection(model.rows, selected, amounts);

  assert.deepEqual(result.entries, [
    { categoryId: 'expense', amount: 275.55 },
    { categoryId: 'both', amount: 40.10 },
  ]);
  assert.equal(result.selectedTotal, 315.65);
  assert.equal(result.newBudgetCount, 1);
  assert.equal(result.replacementCount, 1);
  assert.throws(
    () => buildBudgetSuggestionSelection(model.rows, new Set(['expense']), new Map([['expense', -1]])),
    /non-negative/i
  );
});

test('half-cent historical averages initialize proposals at the same nearest-cent values and total exact cents', () => {
  const cases = [
    { id: 'housing', total: 6385.37, expected: 3192.69 },
    { id: 'restaurants', total: 400.33, expected: 200.17 },
    { id: 'transport', total: 488.95, expected: 244.48 },
    { id: 'shopping', total: 67.35, expected: 33.68 },
  ];
  const model = buildBudgetSuggestionModel({
    workspaceId,
    target: { year: 2026, month: 10 },
    historyFrom: { year: 2026, month: 8 },
    historyTo: { year: 2026, month: 9 },
    categories: cases.map((item, index) => category(item.id, 'expense', index + 1)),
    budgetLines: [],
    transactions: cases.map((item) => transaction(
      `tx-${item.id}`,
      '2026-08-15T12:00:00.000Z',
      'Expense',
      -item.total,
      item.id
    )),
  });

  const selected = new Set(model.rows.map((row) => row.categoryId));
  const proposals = new Map(model.rows.map((row) => [row.categoryId, row.proposedBudget]));
  const selection = buildBudgetSuggestionSelection(model.rows, selected, proposals);

  for (const item of cases) {
    const row = model.rows.find((candidate) => candidate.categoryId === item.id)!;
    assert.equal(row.historicalMonthlyAverage, item.expected);
    assert.equal(row.proposedBudget, item.expected);
    assert.equal(row.proposedBudget!.toFixed(2), item.expected.toFixed(2));
  }
  assert.equal(selection.selectedTotal, 3671.02);
  assert.deepEqual(selection.entries.map((entry) => entry.amount), cases.map((item) => item.expected));
});

test('manual proposals preserve their entered cent values while Expense Report average math remains unchanged', () => {
  const model = buildModel();
  const selection = buildBudgetSuggestionSelection(
    model.rows,
    new Set(['expense']),
    new Map([['expense', 123.45]])
  );
  assert.equal(selection.entries[0].amount, 123.45);
  assert.equal(selection.selectedTotal, 123.45);
  assert.equal(calculateMonthlyAverage(6385.37, 2), 3192.685);
});

test('whole leap-year February uses complete calendar boundaries and one equivalent month', () => {
  const model = buildBudgetSuggestionModel({
    workspaceId,
    target: { year: 2024, month: 3 },
    historyFrom: { year: 2024, month: 2 },
    historyTo: { year: 2024, month: 2 },
    categories: [category('expense', 'expense', 1)],
    budgetLines: [],
    transactions: [transaction('leap-day', '2024-02-29T23:59:59.000Z', 'Expense', -290, 'expense')],
  });
  assert.equal(model.equivalentMonths, 1);
  assert.equal(model.rows[0].historicalMonthlyAverage, 290);
});

test('historical period cannot include the target month', () => {
  assert.throws(
    () => buildBudgetSuggestionModel({
      workspaceId,
      target: { year: 2026, month: 10 },
      historyFrom: { year: 2026, month: 9 },
      historyTo: { year: 2026, month: 10 },
      categories,
      budgetLines: [],
      transactions: [],
    }),
    /before the target month/i
  );
});
