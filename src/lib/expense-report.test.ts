import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboardReport } from '@/app/(app)/dashboard/utils';
import {
  EXPENSE_REPORT_CATEGORY_COLUMN_LABELS,
  EXPENSE_REPORT_SUMMARY_LABELS,
  UNCATEGORIZED_REPORT_CATEGORY_KEY,
  assertExpenseReportReconciles,
  buildExpenseReportModel,
} from './expense-report';
import type { Account, Category, Subcategory, Transaction } from './types';

const workspaceId = 'ws-report';

const accounts: Account[] = [
  {
    id: 'acc-bank',
    workspaceId,
    name: 'Main Bank',
    type: 'bank',
    currency: 'EUR',
    institution: 'Fixture',
    openingBalance: 0,
    archived: false,
    createdAt: new Date(2026, 0, 1),
    updatedAt: new Date(2026, 0, 1),
  },
];

const categories: (Category & { subcategories: Subcategory[] })[] = [
  {
    id: 'cat-housing',
    workspaceId,
    name: 'Housing',
    type: 'expense',
    order: 1,
    isSystem: false,
    subcategories: [
      { id: 'sub-rent', workspaceId, categoryId: 'cat-housing', name: 'Rent', order: 1, isSystem: false },
      { id: 'sub-maintenance', workspaceId, categoryId: 'cat-housing', name: 'Maintenance', order: 2, isSystem: false },
    ],
  },
  {
    id: 'cat-food',
    workspaceId,
    name: 'Food',
    type: 'expense',
    order: 2,
    isSystem: false,
    subcategories: [
      { id: 'sub-groceries', workspaceId, categoryId: 'cat-food', name: 'Groceries', order: 1, isSystem: false },
    ],
  },
];

const transaction = (
  id: string,
  date: Date,
  amountBase: number,
  type: Transaction['type'] = 'Expense',
  overrides: Partial<Transaction> = {}
): Transaction => ({
  id,
  workspaceId,
  accountId: 'acc-bank',
  date,
  description: `Transaction ${id}`,
  rawDescription: `TRANSACTION ${id}`,
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

const makeReport = (transactions: Transaction[]) => {
  const periodStart = new Date(2026, 7, 1);
  const periodEnd = new Date(2026, 8, 30);
  const dashboard = buildDashboardReport(transactions, categories, periodStart, periodEnd);
  const expense = buildExpenseReportModel(dashboard.selectedPeriodTransactions, categories, accounts, {
    workspaceId,
    workspaceName: 'Personal',
    baseCurrency: 'EUR',
    periodStart,
    periodEnd,
  });
  return { dashboard, expense };
};

test('category overview exposes only the simplified net-focused columns', () => {
  assert.deepEqual(EXPENSE_REPORT_CATEGORY_COLUMN_LABELS, [
    'Category',
    'Amount',
    'Monthly Average',
    '% of Total Expenses',
    'Transactions',
  ]);
  assert.equal(EXPENSE_REPORT_CATEGORY_COLUMN_LABELS.includes('Gross' as never), false);
  assert.equal(EXPENSE_REPORT_CATEGORY_COLUMN_LABELS.includes('Reimbursements' as never), false);
});

test('summary exposes the five planning-oriented card labels', () => {
  assert.deepEqual(EXPENSE_REPORT_SUMMARY_LABELS, [
    'Expenses',
    'Monthly Average',
    '% of Income',
    'Transactions',
    'Categories',
  ]);
});

test('expense report reconciles with dashboard totals and all category/subcategory transactions', () => {
  const { dashboard, expense } = makeReport([
    transaction('rent', new Date(2026, 7, 2, 10), -800, 'Expense', {
      categoryId: 'cat-housing',
      subcategoryId: 'sub-rent',
    }),
    transaction('maintenance', new Date(2026, 7, 3, 10), -100, 'Expense', {
      categoryId: 'cat-housing',
      subcategoryId: 'sub-maintenance',
      comments: 'Keep the receipt',
    }),
    transaction('housing-other', new Date(2026, 7, 4, 10), -50, 'Expense', {
      categoryId: 'cat-housing',
    }),
    transaction('groceries', new Date(2026, 7, 5, 10), -200, 'Expense', {
      categoryId: 'cat-food',
      subcategoryId: 'sub-groceries',
    }),
    transaction('uncategorized', new Date(2026, 7, 6, 10), -25),
  ]);

  assert.equal(expense.totalExpenses, dashboard.totals.expenses);
  assert.equal(expense.totalExpenses, 1_175);
  assert.equal(expense.monthlyAverage, 587.5);
  assert.equal(expense.ordinaryIncome, 0);
  assert.equal(expense.percentOfIncome, 0);
  assert.equal(expense.grossExpenses, 1_175);
  assert.equal(expense.reimbursements, 0);
  assert.equal(expense.equivalentMonths, 2);
  assert.equal(expense.transactionCount, 5);
  assert.equal(expense.categoryCount, 3);
  assert.equal(expense.uncategorizedTotal, 25);
  assert.deepEqual(expense.categories.map(({ name }) => name), ['Housing', 'Food', 'Uncategorized']);
  assert.equal(expense.categories[0].percentageOfTotal, 950 / 1_175);
  assert.equal(expense.categories[0].monthlyAverage, 475);
  assert.equal(expense.categories[0].transactionCount, 3);
  assert.deepEqual(expense.categories[0].subcategories.map(({ name }) => name), [
    'Rent',
    'Maintenance',
    'No subcategory',
  ]);
  assert.equal(expense.categories[0].subcategories.reduce((sum, group) => sum + group.netExpense, 0), 950);
  assert.equal(expense.categories[0].subcategories[1].transactions[0].comments, 'Keep the receipt');
  assert.equal(expense.categories[2].key, UNCATEGORIZED_REPORT_CATEGORY_KEY);
  assert.doesNotThrow(() => assertExpenseReportReconciles(expense));
});

test('report excludes income, InternalTransfer, Adjustment, pending, and out-of-range transactions', () => {
  const { expense } = makeReport([
    transaction('included-start', new Date(2026, 7, 1, 0), -10, 'Expense'),
    transaction('included-end', new Date(2026, 8, 30, 23, 59, 59), -20, 'Expense'),
    transaction('before', new Date(2026, 6, 31, 23, 59), -1_000, 'Expense'),
    transaction('after', new Date(2026, 9, 1, 0), -1_000, 'Expense'),
    transaction('income', new Date(2026, 7, 2), 1_000, 'Income'),
    transaction('adjustment', new Date(2026, 7, 2), -500, 'Adjustment'),
    transaction('transfer', new Date(2026, 7, 2), -400, 'InternalTransfer', {
      internalDirection: 'Out',
      destinationAccountId: 'acc-cash',
    }),
    transaction('pending', new Date(2026, 7, 2), -300, 'Expense', { needsReview: true }),
  ]);

  assert.equal(expense.totalExpenses, 30);
  assert.equal(expense.transactionCount, 2);
  assert.equal(expense.categories[0].name, 'Uncategorized');
});

test('transaction drill-down ordering is deterministic and comments never affect totals', () => {
  const sharedDate = new Date(2026, 7, 10, 12);
  const { expense } = makeReport([
    transaction('b', sharedDate, -2, 'Expense', { categoryId: 'cat-food', comments: 'Second note' }),
    transaction('a', sharedDate, -3, 'Expense', { categoryId: 'cat-food' }),
    transaction('newer', new Date(2026, 7, 11, 12), -5, 'Expense', { categoryId: 'cat-food' }),
  ]);

  assert.equal(expense.totalExpenses, 10);
  assert.deepEqual(expense.categories[0].transactions.map(({ id }) => id), ['newer', 'a', 'b']);
  assert.equal(expense.categories[0].subcategories[0].name, 'No subcategory');
  assert.equal(expense.categories[0].subcategories[0].netExpense, 10);
});

test('an unavailable category reference is rejected instead of silently becoming Uncategorized', () => {
  const { selectedPeriodTransactions } = buildDashboardReport([
    transaction('invalid-category', new Date(2026, 7, 2), -10, 'Expense', { categoryId: 'missing' }),
  ], categories, new Date(2026, 7, 1), new Date(2026, 8, 30));

  assert.throws(() => buildExpenseReportModel(selectedPeriodTransactions, categories, accounts, {
    workspaceId,
    workspaceName: 'Personal',
    baseCurrency: 'EUR',
    periodStart: new Date(2026, 7, 1),
    periodEnd: new Date(2026, 8, 30),
  }), /unavailable category/);
});

test('expense report exposes reimbursement gross/net values and signed drill-down rows', () => {
  const { dashboard, expense } = makeReport([
    transaction('expense-rent', new Date(2026, 7, 2), -700, 'Expense', {
      categoryId: 'cat-housing', subcategoryId: 'sub-rent',
    }),
    transaction('refund-rent', new Date(2026, 7, 3), 100, 'Income', {
      categoryId: 'cat-housing', subcategoryId: 'sub-rent', comments: 'Landlord refund',
    }),
    transaction('refund-no-subcategory', new Date(2026, 7, 4), 25, 'Income', {
      categoryId: 'cat-housing',
    }),
    transaction('ordinary-income', new Date(2026, 7, 5), 1_000, 'Income'),
    transaction('pending-refund', new Date(2026, 7, 6), 50, 'Income', {
      categoryId: 'cat-housing', subcategoryId: 'sub-rent', needsReview: true,
    }),
  ]);

  assert.equal(dashboard.totals.income, 1_000);
  assert.equal(dashboard.totals.grossExpenses, 700);
  assert.equal(dashboard.totals.reimbursements, 125);
  assert.equal(dashboard.totals.expenses, 575);
  assert.equal(expense.grossExpenses, 700);
  assert.equal(expense.reimbursements, 125);
  assert.equal(expense.totalExpenses, 575);
  assert.equal(expense.ordinaryIncome, 1_000);
  assert.equal(expense.monthlyAverage, 287.5);
  assert.equal(expense.percentOfIncome, 0.575);

  const housing = expense.categories[0];
  assert.equal(housing.grossExpense, 700);
  assert.equal(housing.reimbursements, 125);
  assert.equal(housing.netExpense, 575);
  assert.equal(housing.monthlyAverage, 287.5);
  assert.equal(
    expense.categories.reduce((sum, category) => sum + category.monthlyAverage, 0),
    expense.monthlyAverage
  );
  assert.equal(housing.transactionCount, 3);
  assert.equal(housing.subcategories.find((item) => item.name === 'Rent')?.netExpense, 600);
  assert.equal(housing.subcategories.find((item) => item.name === 'Rent')?.monthlyAverage, 300);
  assert.equal(housing.subcategories.find((item) => item.name === 'No subcategory')?.netExpense, -25);
  assert.equal(housing.subcategories.find((item) => item.name === 'No subcategory')?.monthlyAverage, -12.5);

  const reimbursement = housing.transactions.find((item) => item.id === 'refund-rent');
  assert.equal(reimbursement?.kind, 'Reimbursement');
  assert.equal(reimbursement?.amount, -100);
  assert.equal(reimbursement?.comments, 'Landlord refund');
  assert.doesNotThrow(() => assertExpenseReportReconciles(expense));
});

test('reimbursement-only categories remain negative and percentages are safe when net total is non-positive', () => {
  const { expense } = makeReport([
    transaction('refund-only', new Date(2026, 7, 3), 120, 'Income', {
      categoryId: 'cat-food', subcategoryId: 'sub-groceries',
    }),
  ]);

  assert.equal(expense.grossExpenses, 0);
  assert.equal(expense.reimbursements, 120);
  assert.equal(expense.totalExpenses, -120);
  assert.equal(expense.ordinaryIncome, 0);
  assert.equal(expense.percentOfIncome, 0);
  assert.equal(expense.categories[0].netExpense, -120);
  assert.equal(expense.categories[0].monthlyAverage, -60);
  assert.equal(expense.categories[0].subcategories[0].netExpense, -120);
  assert.equal(expense.categories[0].percentageOfTotal, 0);
  assert.equal(expense.categories[0].subcategories[0].percentageOfCategory, 1);
  assert.doesNotThrow(() => assertExpenseReportReconciles(expense));
});
