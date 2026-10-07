import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_CATEGORY_TEMPLATE,
  instantiateDefaultCategoryTemplate,
} from './default-category-template';
import { DEFAULT_SYSTEM_CATEGORIES } from './data-management/default-data';
import type { Transaction } from './types';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-workspace-categories-'));
const dataDirectory = path.join(root, 'data');
const operationsDirectory = path.join(root, 'operations');
const now = '2026-10-06T10:00:00.000Z';

const baseTransaction = (
  id: string,
  workspaceId: string,
  accountId: string,
  categoryId: string,
  subcategoryId: string
) => ({
  id,
  workspaceId,
  accountId,
  date: '2026-10-06',
  description: id,
  rawDescription: id,
  amountOriginal: -10,
  currencyOriginal: 'EUR',
  amountBase: -10,
  type: 'Expense',
  categoryId,
  subcategoryId,
  needsReview: false,
  isInternalTransfer: false,
  isPotentialDuplicate: false,
  isInconsistent: false,
  createdAt: now,
  updatedAt: now,
});

const fixture = () => ({
  workspaces: [
    { id: 'ws1', ownerUserId: 'local', name: 'Personal', baseCurrency: 'EUR', createdAt: now, updatedAt: now },
    { id: 'ws2', ownerUserId: 'local', name: 'Business', baseCurrency: 'EUR', createdAt: now, updatedAt: now },
  ],
  accounts: [
    { id: 'acc-1', workspaceId: 'ws1', name: 'Personal', type: 'bank', currency: 'EUR', institution: 'Bank', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
    { id: 'acc-2', workspaceId: 'ws2', name: 'Business', type: 'bank', currency: 'EUR', institution: 'Bank', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
  ],
  categories: [
    {
      id: 'cat-legacy', name: 'Legacy', type: 'expense', order: 1, isSystem: true, isActive: true,
      subcategories: [{ id: 'sub-legacy', categoryId: 'cat-legacy', name: 'Legacy sub', order: 1, isSystem: true, isActive: true, flowType: 'Expense' }],
    },
    {
      id: 'cat-ws1', workspaceId: 'ws1', name: 'Shared name', type: 'expense', order: 2, isSystem: false, isActive: true,
      subcategories: [{ id: 'sub-ws1', workspaceId: 'ws1', categoryId: 'cat-ws1', name: 'Personal sub', order: 1, isSystem: false, isActive: true, flowType: 'Expense' }],
    },
    {
      id: 'cat-ws2', workspaceId: 'ws2', name: 'Shared name', type: 'expense', order: 1, isSystem: false, isActive: true,
      subcategories: [{ id: 'sub-ws2', workspaceId: 'ws2', categoryId: 'cat-ws2', name: 'Business sub', order: 1, isSystem: false, isActive: true, flowType: 'Expense' }],
    },
  ],
  imports: [],
  importTemplates: [],
  budgets: [],
  rules: [],
  transactions: [baseTransaction('tx-legacy', 'ws1', 'acc-1', 'cat-legacy', 'sub-legacy')],
});

const filenames: Record<keyof ReturnType<typeof fixture>, string> = {
  workspaces: 'workspaces.json',
  accounts: 'accounts.json',
  categories: 'categories.json',
  imports: 'imports.json',
  importTemplates: 'import-templates.json',
  budgets: 'budgets.json',
  rules: 'rules.json',
  transactions: 'transactions.json',
};

const writeFixture = (stores = fixture()) => {
  fs.mkdirSync(dataDirectory, { recursive: true });
  for (const [key, filename] of Object.entries(filenames)) {
    fs.writeFileSync(
      path.join(dataDirectory, filename),
      JSON.stringify(stores[key as keyof typeof stores], null, 2)
    );
  }
};

let categories: typeof import('./services/categories');
let transactions: typeof import('./services/transactions');
let rules: typeof import('./services/rules');
let budgets: typeof import('./services/budgets');
let storeState: typeof import('./data-management/store-state');
let backup: typeof import('./data-management/backup');
let restore: typeof import('./data-management/restore');

test.before(async () => {
  process.env.FLOWLEDGER_DATA_DIR = dataDirectory;
  [categories, transactions, rules, budgets, storeState, backup, restore] = await Promise.all([
    import('./services/categories'),
    import('./services/transactions'),
    import('./services/rules'),
    import('./services/budgets'),
    import('./data-management/store-state'),
    import('./data-management/backup'),
    import('./data-management/restore'),
  ]);
});

test.beforeEach(() => writeFixture());

test.after(() => {
  delete process.env.FLOWLEDGER_DATA_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

test('legacy unscoped taxonomy is ws1-only and preserves IDs', async () => {
  const ws1 = await categories.getCategories('ws1');
  const ws2 = await categories.getCategories('ws2');
  const legacy = ws1.find((category) => category.id === 'cat-legacy');
  assert.equal(legacy?.workspaceId, 'ws1');
  assert.equal(legacy?.subcategories[0].id, 'sub-legacy');
  assert.equal(legacy?.subcategories[0].workspaceId, 'ws1');
  assert.equal(ws2.some((category) => category.id === 'cat-legacy'), false);
  assert.deepEqual(ws1.map((category) => category.id).sort(), ['cat-legacy', 'cat-ws1']);
  assert.deepEqual(ws2.map((category) => category.id), ['cat-ws2']);
});

test('new categories require a real workspace and receive global IDs', async () => {
  await assert.rejects(
    () => categories.saveCategory('', { name: 'No owner', type: 'expense', order: 1, isSystem: false }),
    /workspaceId is required/i
  );
  const first = await categories.saveCategory('ws1', { name: 'Independent', type: 'expense', order: 3, isSystem: false });
  const second = await categories.saveCategory('ws2', { name: 'Independent', type: 'expense', order: 2, isSystem: false });
  assert.notEqual(first.id, second.id);
  assert.match(first.id, /^cat_/);
  assert.equal(first.workspaceId, 'ws1');
  assert.equal(second.workspaceId, 'ws2');
});

test('wrong-workspace category update and delete are rejected', async () => {
  await assert.rejects(
    () => categories.saveCategory('ws2', { id: 'cat-ws1', name: 'Wrong', type: 'expense', order: 2, isSystem: false }),
    /selected workspace/i
  );
  await assert.rejects(() => categories.deleteCategory('ws2', 'cat-ws1'), /selected workspace/i);
});

test('subcategories inherit parent ownership and reject wrong-workspace parents', async () => {
  const created = await categories.saveSubcategory('ws1', 'cat-ws1', {
    id: 'temp-new', categoryId: 'cat-ws1', name: 'New sub', order: 2,
    isSystem: false, isActive: true, flowType: 'Expense',
  });
  assert.equal(created.workspaceId, 'ws1');
  assert.equal(created.categoryId, 'cat-ws1');
  assert.notEqual(created.id, 'temp-new');
  await assert.rejects(
    () => categories.saveSubcategory('ws2', 'cat-ws1', {
      id: 'temp-wrong', categoryId: 'cat-ws1', name: 'Wrong', order: 2,
      isSystem: false, flowType: 'Expense',
    }),
    /selected workspace/i
  );
  await assert.rejects(
    () => categories.saveSubcategory('ws1', 'cat-ws1', {
      id: 'temp-wrong-parent', categoryId: 'cat-ws2', name: 'Wrong', order: 2,
      isSystem: false, flowType: 'Expense',
    }),
    /selected category/i
  );
});

test('transactions accept same-workspace and legacy ws1 categories but reject cross-workspace references', async () => {
  const legacy = await transactions.saveTransaction('ws1', {
    ...(baseTransaction('new-legacy', 'ws1', 'acc-1', 'cat-legacy', 'sub-legacy') as unknown as Transaction),
    id: undefined,
  });
  assert.equal(legacy.categoryId, 'cat-legacy');
  await assert.rejects(
    () => transactions.saveTransaction('ws1', {
      ...(baseTransaction('new-cross', 'ws1', 'acc-1', 'cat-ws2', 'sub-ws2') as unknown as Transaction),
      id: undefined,
    }),
    /Category not found in the selected workspace/i
  );
  await assert.rejects(
    () => transactions.saveTransaction('ws1', {
      ...(baseTransaction('new-cross-sub', 'ws1', 'acc-1', 'cat-ws1', 'sub-ws2') as unknown as Transaction),
      id: undefined,
    }),
    /Subcategory does not belong/i
  );
});

test('rules validate category and subcategory ownership', async () => {
  const accepted = await rules.saveRule('ws1', {
    workspaceId: 'ws1', match: { descriptionContains: 'coffee' },
    action: { categoryId: 'cat-ws1', subcategoryId: 'sub-ws1' }, createdAt: new Date(now),
  });
  assert.equal(accepted.workspaceId, 'ws1');
  await assert.rejects(
    () => rules.saveRule('ws1', {
      workspaceId: 'ws1', match: {}, action: { categoryId: 'cat-ws2', subcategoryId: 'sub-ws2' }, createdAt: new Date(now),
    }),
    /Category not found in the selected workspace/i
  );
});

test('budgets validate category and subcategory ownership', async () => {
  const line = await budgets.saveBudgetLine('ws1', 2026, {
    budgetId: 'ignored', type: 'Expense', categoryId: 'cat-ws1', subcategoryId: 'sub-ws1',
    totalSample: 10, monthlyAverage: 10, annualBudget: 120, percentageOfType: 100,
  });
  assert.equal(line.categoryId, 'cat-ws1');
  await assert.rejects(
    () => budgets.saveBudgetLine('ws1', 2026, {
      budgetId: 'ignored', type: 'Expense', categoryId: 'cat-ws2', subcategoryId: 'sub-ws2',
      totalSample: 10, monthlyAverage: 10, annualBudget: 120, percentageOfType: 100,
    }),
    /Category not found in the selected workspace/i
  );
});

test('starter template is workspace-neutral and produces distinct editable runtime IDs', () => {
  assert.equal(DEFAULT_CATEGORY_TEMPLATE.some((entry) => 'workspaceId' in entry), false);
  const ws1 = instantiateDefaultCategoryTemplate('ws1');
  const ws2 = instantiateDefaultCategoryTemplate('ws2');
  assert.equal(ws1[0].workspaceId, 'ws1');
  assert.equal(ws2[0].workspaceId, 'ws2');
  assert.notEqual(ws1[0].id, ws2[0].id);
  assert.notEqual(ws1[0].subcategories[0].id, ws2[0].subcategories[0].id);
  ws1[0].name = 'Renamed starter';
  assert.equal(ws1[0].name, 'Renamed starter');
});

test('canonical bootstrap categories remain deterministic and ws1-owned', () => {
  const housing = DEFAULT_SYSTEM_CATEGORIES.find((category) => category.id === 'cat_housing');
  assert.equal(housing?.workspaceId, 'ws1');
  assert.equal((housing?.subcategories as Record<string, unknown>[])[0].workspaceId, 'ws1');
});

test('complete-state validation accepts legacy and new ownership but rejects workspace mismatches', () => {
  const valid = fixture();
  assert.doesNotThrow(() => storeState.validateCompleteStoreSet(valid as any));
  const invalid = fixture();
  invalid.transactions[0] = baseTransaction('tx-cross', 'ws2', 'acc-2', 'cat-ws1', 'sub-ws1');
  assert.throws(
    () => storeState.validateCompleteStoreSet(invalid as any),
    /category belongs to a different workspace/i
  );
});

test('a backup containing legacy unscoped ws1 categories remains previewable', async () => {
  const generated = await backup.createBackup('everything', { dataDirectory, now: () => new Date(now) });
  const preview = await restore.previewRestore(JSON.stringify(generated), { dataDirectory, operationsDirectory });
  assert.equal(preview.validationResult, 'valid');
  assert.equal(preview.scope, 'everything');
});
