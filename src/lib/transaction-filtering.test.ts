import assert from 'node:assert/strict';
import test from 'node:test';
import type { Account, Category, Transaction } from './types';
import {
  ALL_ACCOUNTS_FILTER_ID,
  ALL_CATEGORIES_FILTER_ID,
  UNCATEGORIZED_CATEGORY_FILTER_ID,
  getAccountFilterOptions,
  getCategoryFilterOptions,
  matchesCategoryFilter,
  matchesTransactionFilters,
} from './transaction-filtering';

const account = (id: string, name: string, workspaceId = 'ws1'): Account => ({
  id,
  workspaceId,
  name,
  type: 'bank',
  currency: 'EUR',
  institution: name,
  openingBalance: 0,
  archived: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
});

const category = (id: string, name: string, workspaceId = 'ws1'): Category => ({
  id,
  workspaceId,
  name,
  type: 'expense',
  order: 0,
  isSystem: false,
});

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'txn-1',
  workspaceId: 'ws1',
  accountId: 'acc-a',
  date: new Date('2026-01-01'),
  description: 'Test',
  rawDescription: 'Test',
  amountOriginal: -10,
  currencyOriginal: 'EUR',
  amountBase: -10,
  type: 'Expense',
  needsReview: true,
  isInternalTransfer: false,
  isPotentialDuplicate: false,
  isInconsistent: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

test('category options keep special options first and sort real categories alphabetically', () => {
  const input = [category('cat-z', 'zebra'), category('cat-a', 'Alpha'), category('cat-m', 'meals')];
  const options = getCategoryFilterOptions(input);

  assert.deepEqual(options.map((option) => option.id), [
    ALL_CATEGORIES_FILTER_ID,
    UNCATEGORIZED_CATEGORY_FILTER_ID,
    'cat-a',
    'cat-m',
    'cat-z',
  ]);
  assert.deepEqual(input.map((item) => item.id), ['cat-z', 'cat-a', 'cat-m']);
});

test('account options keep All accounts first and sort active accounts alphabetically', () => {
  const archived = { ...account('acc-old', 'Archived'), archived: true };
  const input = [account('acc-z', 'zeta'), archived, account('acc-a', 'ActivoBank')];
  const options = getAccountFilterOptions(input);

  assert.deepEqual(options.map((option) => option.id), [ALL_ACCOUNTS_FILTER_ID, 'acc-a', 'acc-z']);
  assert.deepEqual(input.map((item) => item.id), ['acc-z', 'acc-old', 'acc-a']);
});

test('Uncategorized includes ordinary transactions without a category', () => {
  assert.equal(matchesCategoryFilter(transaction(), [UNCATEGORIZED_CATEGORY_FILTER_ID]), true);
  assert.equal(matchesCategoryFilter(transaction({ type: 'Income' }), [UNCATEGORIZED_CATEGORY_FILTER_ID]), true);
  assert.equal(matchesCategoryFilter(transaction({ type: 'Adjustment' }), [UNCATEGORIZED_CATEGORY_FILTER_ID]), true);
});

test('Uncategorized excludes categorized and intentionally uncategorized InternalTransfer transactions', () => {
  assert.equal(matchesCategoryFilter(
    transaction({ categoryId: 'cat-food' }),
    [UNCATEGORIZED_CATEGORY_FILTER_ID]
  ), false);
  assert.equal(matchesCategoryFilter(
    transaction({ type: 'InternalTransfer', isInternalTransfer: true }),
    [UNCATEGORIZED_CATEGORY_FILTER_ID]
  ), false);
});

test('account and Uncategorized filters combine with AND semantics', () => {
  const filters = [UNCATEGORIZED_CATEGORY_FILTER_ID];
  assert.equal(matchesTransactionFilters(transaction({ accountId: 'acc-a' }), ['acc-a'], filters), true);
  assert.equal(matchesTransactionFilters(transaction({ accountId: 'acc-b' }), ['acc-a'], filters), false);
  assert.equal(matchesTransactionFilters(
    transaction({ accountId: 'acc-a', categoryId: 'cat-food' }),
    ['acc-a'],
    filters
  ), false);
});

test('existing category and empty-filter behavior remains unchanged', () => {
  const categorized = transaction({ categoryId: 'cat-food' });
  assert.equal(matchesCategoryFilter(categorized, []), true);
  assert.equal(matchesCategoryFilter(categorized, ['cat-food']), true);
  assert.equal(matchesCategoryFilter(categorized, ['cat-other']), false);
});

test('filter options contain only the selected workspace records supplied by the scoped provider', () => {
  const allAccounts = [account('acc-1', 'Personal', 'ws1'), account('acc-2', 'Business', 'ws2')];
  const allCategories = [category('cat-1', 'Personal', 'ws1'), category('cat-2', 'Business', 'ws2')];
  const ws1Accounts = allAccounts.filter((item) => item.workspaceId === 'ws1');
  const ws1Categories = allCategories.filter((item) => item.workspaceId === 'ws1');

  assert.deepEqual(getAccountFilterOptions(ws1Accounts).map((option) => option.id), [
    ALL_ACCOUNTS_FILTER_ID,
    'acc-1',
  ]);
  assert.deepEqual(getCategoryFilterOptions(ws1Categories).map((option) => option.id), [
    ALL_CATEGORIES_FILTER_ID,
    UNCATEGORIZED_CATEGORY_FILTER_ID,
    'cat-1',
  ]);
});
