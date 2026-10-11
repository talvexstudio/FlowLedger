import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BudgetCopyError,
  buildBudgetCopyState,
  copyBudgets,
  listBudgetCopySources,
  previewBudgetCopy,
  type BudgetCopyInput,
} from './budget-copy';
import { PERSISTED_STORE_KEYS, PERSISTED_STORES } from './store-manifest';
import { readCompleteStoreSet, validateCompleteStoreSet } from './store-state';
import type { CompleteStoreSet } from './store-replacement';

const now = '2026-10-01T00:00:00.000Z';

const category = (id: string, workspaceId: string, type: 'expense' | 'income' | 'both') => ({
  id,
  workspaceId,
  name: id,
  type,
  order: 1,
  isSystem: false,
  subcategories: [],
});

const header = (id: string, workspaceId: string, year: number) => ({
  id,
  workspaceId,
  year,
  createdFromSampleMonths: 0,
  samplePeriodFrom: `${year}-01`,
  samplePeriodTo: `${year}-12`,
  createdAt: now,
});

const budgetLine = (
  id: string,
  workspaceId: string,
  budgetId: string,
  year: number,
  month: number,
  categoryId: string,
  amount: number
) => ({
  id,
  workspaceId,
  recordType: 'line',
  budgetId,
  year,
  month,
  type: 'Expense',
  categoryId,
  subcategoryId: '',
  totalSample: 0,
  monthlyAverage: amount,
  annualBudget: amount * 12,
  percentageOfType: 0,
  userAdjustedMonthly: amount,
  createdAt: now,
  updatedAt: now,
});

const fixture = (): CompleteStoreSet => ({
  workspaces: [
    { id: 'ws1', ownerUserId: 'local', name: 'Personal', baseCurrency: 'EUR', createdAt: now, updatedAt: now },
    { id: 'ws2', ownerUserId: 'local', name: 'Business', baseCurrency: 'EUR', createdAt: now, updatedAt: now },
  ],
  accounts: [
    { id: 'acc-1', workspaceId: 'ws1', name: 'Bank', type: 'bank', currency: 'EUR', institution: 'Bank', openingBalance: 0, archived: false },
  ],
  categories: [
    category('cat-a', 'ws1', 'expense'),
    category('cat-b', 'ws1', 'both'),
    category('cat-c', 'ws1', 'expense'),
    category('cat-income', 'ws1', 'income'),
    category('cat-ws2', 'ws2', 'expense'),
  ],
  imports: [],
  importTemplates: [],
  budgets: [
    header('budget-ws1-2026', 'ws1', 2026),
    header('budget-ws2-2026', 'ws2', 2026),
    budgetLine('source-a', 'ws1', 'budget-ws1-2026', 2026, 9, 'cat-a', 100),
    budgetLine('source-b', 'ws1', 'budget-ws1-2026', 2026, 9, 'cat-b', 50),
    budgetLine('source-income', 'ws1', 'budget-ws1-2026', 2026, 9, 'cat-income', 999),
    budgetLine('target-a', 'ws1', 'budget-ws1-2026', 2026, 10, 'cat-a', 200),
    budgetLine('target-c', 'ws1', 'budget-ws1-2026', 2026, 10, 'cat-c', 75),
    budgetLine('ws2-source', 'ws2', 'budget-ws2-2026', 2026, 9, 'cat-ws2', 500),
  ],
  rules: [],
  transactions: [
    {
      id: 'tx-actual', workspaceId: 'ws1', accountId: 'acc-1', date: '2026-10-10T10:00:00.000Z',
      description: 'Fixture', rawDescription: 'FIXTURE', amountOriginal: -25, currencyOriginal: 'EUR',
      amountBase: -25, type: 'Expense', categoryId: 'cat-a', needsReview: false,
      isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false,
      createdAt: now, updatedAt: now,
    },
  ],
} as CompleteStoreSet);

const input = (mode: 'fill_empty' | 'replace', targetMonth = 10): BudgetCopyInput => ({
  workspaceId: 'ws1',
  sourceYear: 2026,
  sourceMonth: 9,
  targetYear: 2026,
  targetMonth,
  mode,
});

const amountFor = (state: CompleteStoreSet, month: number, categoryId: string) => (
  state.budgets.find((record) => (
    record.recordType === 'line' && record.workspaceId === 'ws1' &&
    record.year === 2026 && record.month === month && record.categoryId === categoryId
  ))?.userAdjustedMonthly
);

const idFactory = () => {
  let index = 0;
  return () => `generated-budget-${++index}`;
};

test('fill-empty copies missing budgets, preserves existing targets, and skips income-only categories', () => {
  const current = fixture();
  const { resulting, preview } = buildBudgetCopyState(current, input('fill_empty'), {
    now: () => new Date(now),
    idFactory: idFactory(),
  });

  assert.equal(preview.budgetsToCopy, 1);
  assert.equal(preview.existingTargetBudgetsPreserved, 2);
  assert.equal(preview.skippedSourceBudgets, 1);
  assert.equal(amountFor(resulting, 10, 'cat-a'), 200);
  assert.equal(amountFor(resulting, 10, 'cat-b'), 50);
  assert.equal(amountFor(resulting, 10, 'cat-c'), 75);
  assert.equal(amountFor(resulting, 10, 'cat-income'), undefined);
  assert.doesNotThrow(() => validateCompleteStoreSet(resulting));
});

test('replace creates a true source plan and removes stale target budgets', () => {
  const current = fixture();
  const sourceBefore = structuredClone(current.budgets.filter((record) => record.month === 9));
  const transactionsBefore = structuredClone(current.transactions);
  const ws2Before = structuredClone(current.budgets.filter((record) => record.workspaceId === 'ws2'));
  const { resulting, preview } = buildBudgetCopyState(current, input('replace'), {
    now: () => new Date(now),
    idFactory: idFactory(),
  });

  assert.equal(preview.budgetsToCopy, 2);
  assert.equal(preview.targetBudgetsRemoved, 1);
  assert.equal(amountFor(resulting, 10, 'cat-a'), 100);
  assert.equal(amountFor(resulting, 10, 'cat-b'), 50);
  assert.equal(amountFor(resulting, 10, 'cat-c'), undefined);
  assert.deepEqual(resulting.budgets.filter((record) => record.month === 9), sourceBefore);
  assert.deepEqual(resulting.budgets.filter((record) => record.workspaceId === 'ws2'), ws2Before);
  assert.deepEqual(resulting.transactions, transactionsBefore);
  assert.doesNotThrow(() => validateCompleteStoreSet(resulting));
});

test('copying into an empty future month creates valid month-specific lines with fresh IDs', () => {
  const current = fixture();
  const { resulting, preview } = buildBudgetCopyState(current, input('fill_empty', 11), {
    now: () => new Date(now),
    idFactory: idFactory(),
  });
  const target = resulting.budgets.filter((record) => (
    record.recordType === 'line' && record.workspaceId === 'ws1' && record.month === 11
  ));

  assert.equal(preview.budgetsToCopy, 2);
  assert.deepEqual(target.map((record) => record.categoryId).sort(), ['cat-a', 'cat-b']);
  assert.ok(target.every((record) => !['source-a', 'source-b'].includes(String(record.id))));
  assert.ok(target.every((record) => record.budgetId === 'budget-ws1-2026'));
});

test('missing previous-month budgets fail safely without producing a result', async () => {
  const current = fixture();
  assert.throws(
    () => buildBudgetCopyState(current, { ...input('fill_empty'), sourceMonth: 8 }),
    (error: unknown) => error instanceof BudgetCopyError && /no budgets/i.test(error.message)
  );
});

const withTempStores = async (run: (paths: { dataDirectory: string; operationsDirectory: string }) => Promise<void>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-budget-copy-'));
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  fs.mkdirSync(dataDirectory, { recursive: true });
  const state = fixture();
  for (const key of PERSISTED_STORE_KEYS) {
    fs.writeFileSync(
      path.join(dataDirectory, PERSISTED_STORES[key].filename),
      JSON.stringify(state[key], null, 2)
    );
  }
  try {
    await run({ dataDirectory, operationsDirectory });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('source listing and preview are workspace-scoped and read-only', async () => withTempStores(async (paths) => {
  const before = fs.readFileSync(path.join(paths.dataDirectory, 'budgets.json'));
  const sources = await listBudgetCopySources('ws1', paths);
  const preview = await previewBudgetCopy(input('fill_empty'), paths);

  assert.ok(sources.some((source) => source.year === 2026 && source.month === 9));
  assert.equal(preview.budgetsToCopy, 1);
  assert.deepEqual(fs.readFileSync(path.join(paths.dataDirectory, 'budgets.json')), before);
}));

test('copy executes as one validated replacement and leaves actual transactions unchanged', async () => withTempStores(async (paths) => {
  const transactionsBefore = fs.readFileSync(path.join(paths.dataDirectory, 'transactions.json'));
  const result = await copyBudgets(input('replace'), {
    ...paths,
    now: () => new Date(now),
    idFactory: idFactory(),
  });
  const state = readCompleteStoreSet(paths.dataDirectory);

  assert.equal(result.budgetsToCopy, 2);
  assert.equal(amountFor(state, 10, 'cat-a'), 100);
  assert.equal(amountFor(state, 10, 'cat-b'), 50);
  assert.equal(amountFor(state, 10, 'cat-c'), undefined);
  assert.deepEqual(fs.readFileSync(path.join(paths.dataDirectory, 'transactions.json')), transactionsBefore);
  assert.equal(
    fs.existsSync(paths.operationsDirectory) ? fs.readdirSync(paths.operationsDirectory).length : 0,
    0
  );
}));

test('simulated replacement failure rolls the budget store back byte-for-byte', async () => withTempStores(async (paths) => {
  const before = fs.readFileSync(path.join(paths.dataDirectory, 'budgets.json'));
  await assert.rejects(
    () => copyBudgets(input('replace'), {
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
