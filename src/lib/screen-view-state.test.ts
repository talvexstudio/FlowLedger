import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDefaultTransactionsViewState,
  fromDateOnlyString,
  getActiveTransactionFilterCount,
  isBudgetViewState,
  isDashboardViewState,
  isSettingsViewState,
  isTransactionsViewState,
  reconcileTransactionsViewState,
  toDateOnlyString,
  withTransactionsFilterChange,
} from './screen-view-state';
import {
  INTERNAL_TRANSFER_CATEGORY_FILTER_ID,
  UNCATEGORIZED_CATEGORY_FILTER_ID,
} from './transaction-filtering';

test('transaction view schema preserves search, filters, dates, and pagination', () => {
  const state = {
    searchQuery: 'market',
    accountIds: ['acc-1'],
    categoryIds: ['cat-1'],
    dateFrom: '2026-08-01',
    dateTo: '2026-09-30',
    page: 3,
  };
  assert.equal(isTransactionsViewState(state), true);
  assert.equal(isTransactionsViewState({ ...state, page: 0 }), false);
  assert.equal(isTransactionsViewState({ ...state, dateTo: '2026-02-31' }), false);
});

test('stale account/category IDs are dropped while supported sentinels remain', () => {
  const reconciled = reconcileTransactionsViewState({
    searchQuery: '',
    accountIds: ['acc-valid', 'acc-deleted'],
    categoryIds: [
      'cat-valid',
      'cat-deleted',
      UNCATEGORIZED_CATEGORY_FILTER_ID,
      INTERNAL_TRANSFER_CATEGORY_FILTER_ID,
    ],
    page: 2,
  }, new Set(['acc-valid']), new Set(['cat-valid']));

  assert.deepEqual(reconciled.accountIds, ['acc-valid']);
  assert.deepEqual(reconciled.categoryIds, [
    'cat-valid',
    UNCATEGORIZED_CATEGORY_FILTER_ID,
    INTERNAL_TRANSFER_CATEGORY_FILTER_ID,
  ]);
});

test('filter changes reset page and active-filter count covers four filter groups', () => {
  const initial = { ...createDefaultTransactionsViewState(), page: 5 };
  const search = withTransactionsFilterChange(initial, { searchQuery: 'coffee' });
  assert.equal(search.page, 1);
  const filtered = {
    ...search,
    accountIds: ['acc-1'],
    categoryIds: [UNCATEGORIZED_CATEGORY_FILTER_ID],
    dateFrom: '2026-08-01',
    dateTo: '2026-09-30',
  };
  assert.equal(getActiveTransactionFilterCount(filtered), 4);
  assert.equal(getActiveTransactionFilterCount(createDefaultTransactionsViewState()), 0);
});

test('date-only conversion preserves local calendar dates', () => {
  const date = new Date(2026, 7, 15);
  assert.equal(toDateOnlyString(date), '2026-08-15');
  const restored = fromDateOnlyString('2026-08-15');
  assert.equal(restored?.getFullYear(), 2026);
  assert.equal(restored?.getMonth(), 7);
  assert.equal(restored?.getDate(), 15);
});

test('Dashboard, Budget, and Settings schemas accept only safe persisted values', () => {
  assert.equal(isDashboardViewState({ start: '2026-08-01', end: '2026-09-30', preset: 'custom' }), true);
  assert.equal(isDashboardViewState({ start: '2026-10-01', end: '2026-09-30', preset: 'custom' }), false);
  assert.equal(isBudgetViewState({ month: 9, year: 2026 }), true);
  assert.equal(isBudgetViewState({ month: 12, year: 2026 }), false);
  assert.equal(isSettingsViewState({ tab: 'data-storage' }), true);
  assert.equal(isSettingsViewState({ tab: 'unknown' }), false);
});
