import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCategorySaveRequest, buildSubcategorySaveRequest } from './api';
import { getCategoryChangeSet, getChangedRules, type EditableCategory } from './settings-change-sets';
import { getSelectableOptions, getTransactionEditHydrationPatch } from './transaction-form-hydration';
import { applyRuleClassificationToTransaction, ruleMatchesTransactionForBackfill } from './utils/rule-utils';
import type { Account, ClassificationRule } from './types';

const baselineCategory: EditableCategory = {
  id: 'cat-a',
  workspaceId: 'ws1',
  name: 'Category A',
  type: 'expense',
  order: 1,
  isSystem: false,
  isActive: true,
  subcategories: [{
    id: 'sub-a',
    workspaceId: 'ws1',
    categoryId: 'cat-a',
    name: 'Subcategory A',
    order: 1,
    isSystem: false,
    isActive: true,
    flowType: 'Expense',
  }],
};

test('category change set includes only the changed subcategory', () => {
  const current = structuredClone(baselineCategory);
  current.subcategories[0].name = 'Renamed';

  const changes = getCategoryChangeSet([current], [baselineCategory]);

  assert.equal(changes.categories.length, 0);
  assert.equal(changes.subcategories.length, 1);
  assert.equal(changes.subcategories[0].categoryId, 'cat-a');
  assert.equal(changes.subcategories[0].data.categoryId, 'cat-a');
});

test('category payload preserves domain type and subcategory payload uses authoritative parent id', () => {
  const categoryRequest = buildCategorySaveRequest('ws1', baselineCategory);
  const subcategoryRequest = buildSubcategorySaveRequest('ws1', 'cat-a', {
    ...baselineCategory.subcategories[0],
    categoryId: 'stale-parent',
  });

  assert.equal(categoryRequest.entity, 'category');
  assert.equal(categoryRequest.data.type, 'expense');
  assert.equal(subcategoryRequest.entity, 'subcategory');
  assert.equal(subcategoryRequest.categoryId, 'cat-a');
  assert.equal(subcategoryRequest.data.categoryId, 'cat-a');
});

test('rule change set includes only changed rules', () => {
  const baseline: ClassificationRule[] = [
    { id: 'rule-a', workspaceId: 'ws1', match: { descriptionContains: 'A' }, action: {}, createdAt: new Date() },
    { id: 'rule-b', workspaceId: 'ws1', match: { descriptionContains: 'B' }, action: {}, createdAt: new Date() },
  ];
  const current = structuredClone(baseline);
  current[1].action.categoryId = 'cat-a';

  assert.deepEqual(getChangedRules(current, baseline).map(rule => rule.id), ['rule-b']);
});

test('transaction edit hydration waits for options and never overwrites dirty fields', () => {
  const account = { id: 'account-b' } as Account;
  const transaction = { id: 'tx-a', accountId: 'account-b', categoryId: 'cat-a', subcategoryId: 'sub-a' };
  const pristine = { accountId: false, categoryId: false, subcategoryId: false };

  assert.deepEqual(getTransactionEditHydrationPatch({
    transaction,
    accounts: [],
    categories: [],
    current: {},
    dirty: pristine,
  }), {});

  assert.deepEqual(getTransactionEditHydrationPatch({
    transaction,
    accounts: [account],
    categories: [baselineCategory],
    current: {},
    dirty: pristine,
  }), {
    accountId: 'account-b',
    categoryId: 'cat-a',
    subcategoryId: 'sub-a',
  });

  assert.deepEqual(getTransactionEditHydrationPatch({
    transaction,
    accounts: [account],
    categories: [baselineCategory],
    current: { accountId: 'account-a', categoryId: 'cat-manual', subcategoryId: 'sub-manual' },
    dirty: { accountId: true, categoryId: true, subcategoryId: true },
  }), {});
});

test('persisted inactive category and subcategory remain selectable while editing', () => {
  const inactiveCategory = {
    ...baselineCategory,
    isActive: false,
    subcategories: [{ ...baselineCategory.subcategories[0], isActive: false }],
  };

  assert.deepEqual(getSelectableOptions([inactiveCategory], 'cat-a').map(item => item.id), ['cat-a']);
  assert.deepEqual(
    getSelectableOptions(inactiveCategory.subcategories, 'sub-a').map(item => item.id),
    ['sub-a']
  );
});

test('inline rule backfill matching and classification remain intact', () => {
  const rule = {
    id: 'rule-a',
    workspaceId: 'ws1',
    match: { descriptionContains: 'coffee shop', accountId: 'account-b' },
    action: { categoryId: 'cat-a', subcategoryId: 'sub-a', type: 'Expense' as const },
    createdAt: new Date(),
  };
  const transaction = {
    id: 'tx-a',
    workspaceId: 'ws1',
    accountId: 'account-b',
    description: 'Coffee Shop Lisbon',
    rawDescription: 'COFFEE SHOP LISBON',
    amountBase: -5,
    type: 'Expense' as const,
    needsReview: true,
  } as Parameters<typeof ruleMatchesTransactionForBackfill>[1];

  assert.equal(ruleMatchesTransactionForBackfill(rule, transaction), true);
  assert.deepEqual(applyRuleClassificationToTransaction(transaction, rule, [baselineCategory]), {
    id: 'tx-a',
    categoryId: 'cat-a',
    subcategoryId: 'sub-a',
    type: 'Expense',
    needsReview: false,
  });
});
