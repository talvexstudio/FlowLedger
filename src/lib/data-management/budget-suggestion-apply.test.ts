import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyBudgetSuggestions,
  BudgetSuggestionApplyError,
  buildBudgetSuggestionApplyState,
  type BudgetSuggestionApplyInput,
} from './budget-suggestion-apply';
import { PERSISTED_STORE_KEYS, PERSISTED_STORES } from './store-manifest';
import { readCompleteStoreSet, validateCompleteStoreSet } from './store-state';
import type { CompleteStoreSet } from './store-replacement';

const now = '2026-10-01T00:00:00.000Z';

const category = (id: string, workspaceId: string, type: 'expense' | 'income' | 'both') => ({
  id, workspaceId, name: id, type, order: 1, isSystem: false, subcategories: [],
});
const header = (id: string, workspaceId: string, year: number) => ({
  id, workspaceId, year, createdFromSampleMonths: 0,
  samplePeriodFrom: `${year}-01`, samplePeriodTo: `${year}-12`, createdAt: now,
});
const line = (
  id: string, workspaceId: string, budgetId: string, year: number,
  month: number | undefined, categoryId: string, amount: number
) => ({
  id, workspaceId, recordType: 'line', budgetId, year, ...(month === undefined ? {} : { month }),
  type: 'Expense', categoryId, subcategoryId: '', totalSample: 0, monthlyAverage: amount,
  annualBudget: amount * 12, percentageOfType: 0, userAdjustedMonthly: amount,
  createdAt: now, updatedAt: now,
});

const fixture = (): CompleteStoreSet => ({
  workspaces: [
    { id: 'ws1', ownerUserId: 'local', name: 'Personal', baseCurrency: 'EUR', createdAt: now, updatedAt: now },
    { id: 'ws2', ownerUserId: 'local', name: 'Business', baseCurrency: 'EUR', createdAt: now, updatedAt: now },
  ],
  accounts: [{ id: 'acc-1', workspaceId: 'ws1', name: 'Bank', type: 'bank', currency: 'EUR', institution: 'Bank', openingBalance: 0, archived: false }],
  categories: [
    category('cat-a', 'ws1', 'expense'), category('cat-b', 'ws1', 'both'),
    category('cat-c', 'ws1', 'expense'), category('cat-income', 'ws1', 'income'),
    category('cat-ws2', 'ws2', 'expense'),
  ],
  imports: [], importTemplates: [], rules: [],
  budgets: [
    header('budget-ws1-2026', 'ws1', 2026), header('budget-ws2-2026', 'ws2', 2026),
    line('target-a', 'ws1', 'budget-ws1-2026', 2026, 10, 'cat-a', 200),
    line('other-month', 'ws1', 'budget-ws1-2026', 2026, 11, 'cat-b', 75),
    line('other-workspace', 'ws2', 'budget-ws2-2026', 2026, 10, 'cat-ws2', 500),
  ],
  transactions: [{
    id: 'tx-1', workspaceId: 'ws1', accountId: 'acc-1', date: '2026-08-01T00:00:00.000Z',
    description: 'Fixture', rawDescription: 'FIXTURE', amountOriginal: -25, currencyOriginal: 'EUR',
    amountBase: -25, type: 'Expense', categoryId: 'cat-a', needsReview: false,
    isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false,
    createdAt: now, updatedAt: now,
  }],
} as CompleteStoreSet);

const input = (): BudgetSuggestionApplyInput => ({
  workspaceId: 'ws1', targetYear: 2026, targetMonth: 10,
  entries: [{ categoryId: 'cat-a', amount: 250 }, { categoryId: 'cat-b', amount: 80 }],
});

const amountFor = (state: CompleteStoreSet, workspaceId: string, month: number, categoryId: string) => (
  state.budgets.find((record) => record.recordType === 'line' && record.workspaceId === workspaceId &&
    record.year === 2026 && record.month === month && record.categoryId === categoryId)?.userAdjustedMonthly
);
const idFactory = () => {
  let index = 0;
  return () => `generated-${++index}`;
};

test('apply creates selected month-specific budgets, explicitly replaces selected existing targets, and preserves all else', () => {
  const current = fixture();
  const transactionsBefore = structuredClone(current.transactions);
  const otherWorkspaceBefore = structuredClone(current.budgets.filter((record) => record.workspaceId === 'ws2'));
  const { resulting, result } = buildBudgetSuggestionApplyState(current, input(), {
    now: () => new Date(now), idFactory: idFactory(),
  });

  assert.equal(result.appliedCount, 2);
  assert.equal(result.createdCount, 1);
  assert.equal(result.replacedCount, 1);
  assert.equal(amountFor(resulting, 'ws1', 10, 'cat-a'), 250);
  assert.equal(amountFor(resulting, 'ws1', 10, 'cat-b'), 80);
  assert.equal(amountFor(resulting, 'ws1', 11, 'cat-b'), 75);
  assert.deepEqual(resulting.budgets.filter((record) => record.workspaceId === 'ws2'), otherWorkspaceBefore);
  assert.deepEqual(resulting.transactions, transactionsBefore);
  assert.doesNotThrow(() => validateCompleteStoreSet(resulting));
});

test('unselected target categories remain untouched', () => {
  const current = fixture();
  current.budgets.push(line('target-c', 'ws1', 'budget-ws1-2026', 2026, 10, 'cat-c', 60));
  const { resulting } = buildBudgetSuggestionApplyState(current, {
    ...input(), entries: [{ categoryId: 'cat-b', amount: 90 }],
  }, { now: () => new Date(now), idFactory: idFactory() });
  assert.equal(amountFor(resulting, 'ws1', 10, 'cat-a'), 200);
  assert.equal(amountFor(resulting, 'ws1', 10, 'cat-c'), 60);
});

test('apply persists nearest-cent values and preserves manually entered cents exactly', () => {
  const current = fixture();
  const { resulting } = buildBudgetSuggestionApplyState(current, {
    ...input(),
    entries: [
      { categoryId: 'cat-a', amount: 3192.685 },
      { categoryId: 'cat-b', amount: 123.45 },
      { categoryId: 'cat-c', amount: 33.675 },
    ],
  }, { now: () => new Date(now), idFactory: idFactory() });

  assert.equal(amountFor(resulting, 'ws1', 10, 'cat-a'), 3192.69);
  assert.equal(amountFor(resulting, 'ws1', 10, 'cat-b'), 123.45);
  assert.equal(amountFor(resulting, 'ws1', 10, 'cat-c'), 33.68);
});

test('workspace and category validation rejects income-only and cross-workspace references', () => {
  const current = fixture();
  for (const categoryId of ['cat-income', 'cat-ws2']) {
    assert.throws(
      () => buildBudgetSuggestionApplyState(current, {
        ...input(), entries: [{ categoryId, amount: 50 }],
      }),
      (error: unknown) => error instanceof BudgetSuggestionApplyError && error.status === 409
    );
  }
});

test('legacy monthless lines remain readable by being materialized before a monthly apply', () => {
  const current = fixture();
  current.budgets.push(line('legacy-c', 'ws1', 'budget-ws1-2026', 2026, undefined, 'cat-c', 45));
  const { resulting } = buildBudgetSuggestionApplyState(current, {
    ...input(), entries: [{ categoryId: 'cat-b', amount: 90 }],
  }, { now: () => new Date(now), idFactory: idFactory() });

  assert.equal(resulting.budgets.some((record) => record.id === 'legacy-c'), false);
  assert.equal(
    resulting.budgets.filter((record) => record.recordType === 'line' && record.workspaceId === 'ws1' && record.categoryId === 'cat-c').length,
    12
  );
  assert.equal(amountFor(resulting, 'ws1', 10, 'cat-c'), 45);
  assert.doesNotThrow(() => validateCompleteStoreSet(resulting));
});

const withTempStores = async (run: (paths: { dataDirectory: string; operationsDirectory: string }) => Promise<void>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-budget-suggestions-'));
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  fs.mkdirSync(dataDirectory, { recursive: true });
  const state = fixture();
  for (const key of PERSISTED_STORE_KEYS) {
    fs.writeFileSync(path.join(dataDirectory, PERSISTED_STORES[key].filename), JSON.stringify(state[key], null, 2));
  }
  try {
    await run({ dataDirectory, operationsDirectory });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('atomic apply changes only budgets and cleans recovery artifacts', async () => withTempStores(async (paths) => {
  const transactionsBefore = fs.readFileSync(path.join(paths.dataDirectory, 'transactions.json'));
  const result = await applyBudgetSuggestions(input(), {
    ...paths, now: () => new Date(now), idFactory: idFactory(),
  });
  const state = readCompleteStoreSet(paths.dataDirectory);
  assert.equal(result.appliedCount, 2);
  assert.equal(amountFor(state, 'ws1', 10, 'cat-a'), 250);
  assert.deepEqual(fs.readFileSync(path.join(paths.dataDirectory, 'transactions.json')), transactionsBefore);
  assert.equal(fs.existsSync(paths.operationsDirectory) ? fs.readdirSync(paths.operationsDirectory).length : 0, 0);
}));

test('simulated write failure rolls the target budget store back byte-for-byte', async () => withTempStores(async (paths) => {
  const before = fs.readFileSync(path.join(paths.dataDirectory, 'budgets.json'));
  await assert.rejects(
    () => applyBudgetSuggestions(input(), {
      ...paths,
      now: () => new Date(now),
      idFactory: idFactory(),
      hooks: { beforeReplace: () => { throw new Error('simulated write failure'); } },
    }),
    /Original budgets were restored successfully/i
  );
  assert.deepEqual(fs.readFileSync(path.join(paths.dataDirectory, 'budgets.json')), before);
  assert.doesNotThrow(() => readCompleteStoreSet(paths.dataDirectory));
}));
