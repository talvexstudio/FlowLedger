import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDashboardTotals } from '@/app/(app)/dashboard/utils';
import { buildTransactionSaveRequest } from './api';
import { calculateBudgetActualSpending } from './budget-reporting';
import { buildExpenseReportModel } from './expense-report';
import {
  categorySelectionPatch,
  NO_SUBCATEGORY_SELECTION,
  subcategorySelectionPatch,
  UNCATEGORIZED_SELECTION,
} from './transaction-category-selection';
import { matchesCategoryFilter, UNCATEGORIZED_CATEGORY_FILTER_ID } from './transaction-filtering';
import {
  isTransactionSufficientlyClassified,
  selectTransactionsToReview,
  validateTransactionClassificationSelection,
} from './transaction-review';
import type { Account, Category, Subcategory, Transaction } from './types';

const workspaceId = 'ws1';
const account: Account = {
  id: 'acc1', workspaceId, name: 'Bank', type: 'bank', currency: 'EUR',
  institution: 'Bank', openingBalance: 0, archived: false,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
};
const categories: (Category & { subcategories: Subcategory[] })[] = [{
  id: 'cat-housing', workspaceId, name: 'Housing', type: 'expense', order: 1,
  isSystem: false, isActive: true,
  subcategories: [{
    id: 'sub-rent', workspaceId, categoryId: 'cat-housing', name: 'Rent', order: 1,
    isSystem: false, isActive: true, flowType: 'Expense',
  }],
}, {
  id: 'cat-other', workspaceId, name: 'Other', type: 'expense', order: 2,
  isSystem: false, isActive: true,
  subcategories: [{
    id: 'sub-other', workspaceId, categoryId: 'cat-other', name: 'Other detail', order: 1,
    isSystem: false, isActive: true, flowType: 'Expense',
  }],
}];

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'tx1', workspaceId, accountId: account.id, date: new Date('2026-01-15T12:00:00Z'),
  description: 'Fixture', rawDescription: 'FIXTURE', amountOriginal: -100,
  currencyOriginal: 'EUR', amountBase: -100, type: 'Expense', needsReview: true,
  isInternalTransfer: false, isPotentialDuplicate: false, isPotentialTransfer: false,
  isInconsistent: false, createdAt: new Date('2026-01-15'), updatedAt: new Date('2026-01-15'),
  ...overrides,
});

test('category with an optional valid or blank subcategory is valid', () => {
  assert.equal(validateTransactionClassificationSelection(transaction({
    categoryId: 'cat-housing', subcategoryId: 'sub-rent',
  }), categories).valid, true);
  assert.equal(validateTransactionClassificationSelection(transaction({
    categoryId: 'cat-housing', subcategoryId: undefined,
  }), categories).valid, true);
  assert.equal(isTransactionSufficientlyClassified(transaction({
    categoryId: 'cat-housing', subcategoryId: undefined,
  }), categories), true);
});

test('invalid and cross-category subcategories are rejected while blank is allowed', () => {
  assert.equal(validateTransactionClassificationSelection(transaction({
    categoryId: 'cat-housing', subcategoryId: 'missing',
  }), categories).reason, 'Choose a valid subcategory for this category.');
  assert.equal(validateTransactionClassificationSelection(transaction({
    categoryId: 'cat-housing', subcategoryId: 'sub-other',
  }), categories).valid, false);
  assert.equal(validateTransactionClassificationSelection(transaction({
    subcategoryId: 'sub-rent',
  }), categories).reason, 'Choose a valid category.');
});

test('selection patches clear category and subcategory independently', () => {
  assert.deepEqual(categorySelectionPatch(UNCATEGORIZED_SELECTION), {
    categoryId: undefined,
    subcategoryId: undefined,
  });
  assert.deepEqual(categorySelectionPatch('cat-housing'), {
    categoryId: 'cat-housing',
    subcategoryId: undefined,
  });
  assert.deepEqual(subcategorySelectionPatch(NO_SUBCATEGORY_SELECTION), {
    subcategoryId: undefined,
  });
  assert.deepEqual({ categoryId: 'cat-housing', ...subcategorySelectionPatch(NO_SUBCATEGORY_SELECTION) }, {
    categoryId: 'cat-housing',
    subcategoryId: undefined,
  });
});

test('transaction update transport preserves explicit field clearing', () => {
  assert.deepEqual(buildTransactionSaveRequest(workspaceId, {
    id: 'tx1', categoryId: undefined, subcategoryId: undefined,
  }), {
    workspaceId, id: 'tx1', categoryId: null, subcategoryId: null,
  });
});

test('approved Uncategorized is reportable, filterable, and absent from review', () => {
  const approved = transaction({ needsReview: false });
  const totals = calculateDashboardTotals([approved], categories);
  const report = buildExpenseReportModel([approved], categories, [account], {
    workspaceId,
    workspaceName: 'Personal',
    baseCurrency: 'EUR',
    periodStart: new Date(2026, 0, 1),
    periodEnd: new Date(2026, 0, 31),
  });

  assert.equal(totals.expenses, 100);
  assert.equal(report.totalExpenses, 100);
  assert.equal(report.categories[0].name, 'Uncategorized');
  assert.equal(matchesCategoryFilter(approved, [UNCATEGORIZED_CATEGORY_FILTER_ID]), true);
  assert.deepEqual(selectTransactionsToReview([approved]), []);
  assert.equal(categories.some((category) => category.name === 'Uncategorized'), false);
});

test('uncategorized ordinary Income remains income and is not a reimbursement', () => {
  const income = transaction({
    id: 'income', type: 'Income', amountBase: 250, amountOriginal: 250, needsReview: false,
  });
  const totals = calculateDashboardTotals([income], categories);
  assert.equal(totals.income, 250);
  assert.equal(totals.reimbursements, 0);
  assert.equal(totals.expenses, 0);
});

test('category-only expense and reimbursement reconcile under No subcategory and budget actuals', () => {
  const expense = transaction({ categoryId: 'cat-housing', needsReview: false });
  const reimbursement = transaction({
    id: 'reimbursement', categoryId: 'cat-housing', type: 'Income',
    amountBase: 25, amountOriginal: 25, needsReview: false,
  });
  const report = buildExpenseReportModel([expense, reimbursement], categories, [account], {
    workspaceId,
    workspaceName: 'Personal',
    baseCurrency: 'EUR',
    periodStart: new Date(2026, 0, 1),
    periodEnd: new Date(2026, 0, 31),
  });
  const actuals = calculateBudgetActualSpending([expense, reimbursement], categories, {
    categoryId: 'cat-housing', year: 2026, month: 0,
  });

  const noSubcategory = report.categories[0].subcategories.find(
    (subcategory) => subcategory.name === 'No subcategory'
  );
  assert.equal(noSubcategory?.grossExpense, 100);
  assert.equal(noSubcategory?.reimbursements, 25);
  assert.equal(noSubcategory?.netExpense, 75);
  assert.equal(actuals.netExpenses, 75);
});
