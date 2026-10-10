import assert from 'node:assert/strict';
import test from 'node:test';
import type { Transaction } from '@/lib/types';
import {
  UNCATEGORIZED_EXPENSE_SLICE_ID,
  buildDashboardReport,
  getOverviewDescription,
  getPeriodAverageDescription,
  isWithinDashboardCalendarRange,
  selectDashboardPeriodTransactions,
} from './utils';

const workspaceId = 'ws-test';

const transaction = (
  id: string,
  date: Date,
  amountBase: number,
  type: Transaction['type'],
  overrides: Partial<Transaction> = {}
): Transaction => ({
  id,
  workspaceId,
  accountId: 'acc-test',
  date,
  description: 'Fixture transaction',
  rawDescription: 'FIXTURE TRANSACTION',
  amountOriginal: amountBase,
  currencyOriginal: 'EUR',
  amountBase,
  type,
  needsReview: false,
  isInternalTransfer: type === 'InternalTransfer',
  isPotentialDuplicate: false,
  isInconsistent: false,
  createdAt: date,
  updatedAt: date,
  ...overrides,
});

const categories = [
  { id: 'cat-a', name: 'Category A' },
  { id: 'cat-b', name: 'Category B' },
];

const toCents = (value: number) => Math.round(value * 100);
const overviewTotals = (report: ReturnType<typeof buildDashboardReport>) => ({
  income: report.overviewData.reduce((sum, point) => sum + point.income, 0),
  expenses: report.overviewData.reduce((sum, point) => sum + point.expenses, 0),
});

test('calendar range includes both complete boundary days and excludes the following day', () => {
  const start = new Date(2026, 7, 1);
  const end = new Date(2026, 8, 30);
  const fixtures = [
    transaction('start-midnight', new Date(2026, 7, 1, 0, 0, 0), 10, 'Income'),
    transaction('start-later', new Date(2026, 7, 1, 18, 30, 0), 10, 'Income'),
    transaction('end-midnight', new Date(2026, 8, 30, 0, 0, 0), 10, 'Income'),
    transaction('end-later', new Date(2026, 8, 30, 23, 59, 59, 999), 10, 'Income'),
    transaction('after-end', new Date(2026, 9, 1, 0, 0, 0), 10, 'Income'),
  ];

  assert.equal(isWithinDashboardCalendarRange(fixtures[0].date, start, end), true);
  assert.equal(isWithinDashboardCalendarRange(fixtures[1].date, start, end), true);
  assert.equal(isWithinDashboardCalendarRange(fixtures[2].date, start, end), true);
  assert.equal(isWithinDashboardCalendarRange(fixtures[3].date, start, end), true);
  assert.equal(isWithinDashboardCalendarRange(fixtures[4].date, start, end), false);
  assert.deepEqual(
    selectDashboardPeriodTransactions(fixtures, start, end).map(({ id }) => id),
    ['start-midnight', 'start-later', 'end-midnight', 'end-later']
  );
});

test('one report population drives headline, overview, averages, and category reconciliation', () => {
  const start = new Date(2026, 7, 1);
  const end = new Date(2026, 8, 30);
  const report = buildDashboardReport([
    transaction('income', new Date(2026, 8, 30, 12), 11_664.78, 'Income'),
    transaction('expense', new Date(2026, 7, 15, 12), -9_515.66, 'Expense', { categoryId: 'cat-a' }),
    transaction('pending', new Date(2026, 7, 20, 12), -500, 'Expense', { needsReview: true, categoryId: 'cat-b' }),
    transaction('transfer', new Date(2026, 7, 25, 12), -1_000, 'InternalTransfer', {
      internalDirection: 'Out',
      destinationAccountId: 'acc-cash',
    }),
    transaction('adjustment', new Date(2026, 7, 26, 12), 75, 'Adjustment'),
  ], categories, start, end);

  assert.equal(report.selectedPeriodTransactions.length, 4);
  assert.equal(toCents(report.totals.income), 1_166_478);
  assert.equal(toCents(report.totals.expenses), 951_566);
  assert.equal(toCents(report.totals.net), 214_912);
  assert.equal(Math.round(report.totals.savingsRate * 1_000), 184);

  const chartTotals = overviewTotals(report);
  assert.equal(toCents(chartTotals.income), toCents(report.totals.income));
  assert.equal(toCents(chartTotals.expenses), toCents(report.totals.expenses));
  assert.equal(toCents(report.averages.income * report.overviewData.length), toCents(report.totals.income));
  assert.equal(toCents(report.averages.expenses * report.overviewData.length), toCents(report.totals.expenses));
  assert.equal(report.averages.savingsRate, report.totals.savingsRate);

  const pieTotal = report.expenseCategoryData.reduce((sum, slice) => sum + slice.total, 0);
  assert.equal(toCents(pieTotal), toCents(report.totals.expenses));
  assert.equal(report.averages.description, 'Daily average across 61 calendar days');
});

test('uncategorized expenses reconcile while InternalTransfer and pending records remain excluded', () => {
  const start = new Date(2026, 0, 1);
  const end = new Date(2026, 0, 2);
  const report = buildDashboardReport([
    transaction('categorized', new Date(2026, 0, 1, 10), -30, 'Expense', { categoryId: 'cat-a' }),
    transaction('uncategorized', new Date(2026, 0, 1, 11), -20, 'Expense'),
    transaction('transfer', new Date(2026, 0, 1, 12), -100, 'InternalTransfer', {
      internalDirection: 'Out',
      destinationAccountId: 'acc-cash',
    }),
    transaction('pending', new Date(2026, 0, 1, 13), -500, 'Expense', { needsReview: true }),
  ], categories, start, end);

  assert.equal(report.totals.expenses, 50);
  assert.deepEqual(report.expenseCategoryData, [
    { categoryId: 'cat-a', categoryName: 'Category A', total: 30 },
    { categoryId: UNCATEGORIZED_EXPENSE_SLICE_ID, categoryName: 'Uncategorized', total: 20 },
  ]);
  assert.equal(
    report.expenseCategoryData.reduce((sum, slice) => sum + slice.total, 0),
    report.totals.expenses
  );
});

test('a changed date range produces fresh category data', () => {
  const fixtures = [
    transaction('jan', new Date(2026, 0, 15, 12), -10, 'Expense', { categoryId: 'cat-a' }),
    transaction('feb', new Date(2026, 1, 15, 12), -25, 'Expense', { categoryId: 'cat-b' }),
  ];
  const january = buildDashboardReport(fixtures, categories, new Date(2026, 0, 1), new Date(2026, 0, 31));
  const february = buildDashboardReport(fixtures, categories, new Date(2026, 1, 1), new Date(2026, 1, 28));

  assert.deepEqual(january.expenseCategoryData, [
    { categoryId: 'cat-a', categoryName: 'Category A', total: 10 },
  ]);
  assert.deepEqual(february.expenseCategoryData, [
    { categoryId: 'cat-b', categoryName: 'Category B', total: 25 },
  ]);
});

test('monthly grouping is clipped to the exact selected calendar range', () => {
  const start = new Date(2026, 0, 15);
  const end = new Date(2026, 3, 20);
  const report = buildDashboardReport([
    transaction('before', new Date(2026, 0, 14, 12), 1_000, 'Income'),
    transaction('start', new Date(2026, 0, 15, 12), 10, 'Income'),
    transaction('end', new Date(2026, 3, 20, 23, 0), 20, 'Income'),
    transaction('after', new Date(2026, 3, 21, 0), 2_000, 'Income'),
  ], categories, start, end);

  assert.equal(report.grouping, 'monthly');
  assert.equal(report.overviewData.length, 4);
  assert.equal(report.totals.income, 30);
  assert.equal(overviewTotals(report).income, 30);
  assert.equal(report.averages.description, 'Monthly average across 4 calendar months');
});

test('quarterly grouping is clipped to the exact selected calendar range', () => {
  const start = new Date(2025, 0, 15);
  const end = new Date(2026, 1, 20);
  const report = buildDashboardReport([
    transaction('before', new Date(2025, 0, 14, 12), 1_000, 'Income'),
    transaction('start', new Date(2025, 0, 15, 12), 10, 'Income'),
    transaction('end', new Date(2026, 1, 20, 23), 20, 'Income'),
    transaction('after', new Date(2026, 1, 21, 0), 2_000, 'Income'),
  ], categories, start, end);

  assert.equal(report.grouping, 'quarterly');
  assert.equal(report.totals.income, 30);
  assert.equal(overviewTotals(report).income, 30);
  assert.equal(report.averages.description, 'Quarterly average across 5 quarters');
});

test('zero income keeps savings rate safe and overview copy reflects grouping', () => {
  const report = buildDashboardReport([
    transaction('expense', new Date(2026, 0, 2, 12), -25, 'Expense'),
  ], categories, new Date(2026, 0, 1), new Date(2026, 0, 3));

  assert.equal(report.totals.income, 0);
  assert.equal(report.totals.net, -25);
  assert.equal(report.totals.savingsRate, 0);
  assert.equal(getPeriodAverageDescription('daily', 1), 'Daily average across 1 calendar day');
  assert.equal(getOverviewDescription('daily'), 'Daily totals in selected period.');
  assert.equal(getOverviewDescription('monthly'), 'Monthly totals in selected period.');
  assert.equal(getOverviewDescription('quarterly'), 'Quarterly totals in selected period.');
});
