import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { POST as resetPost } from '@/app/api/data-management/reset/route';
import { POST as resetPreviewPost } from '@/app/api/data-management/reset/preview/route';
import { createBackup } from './backup';
import { executeDataReset, previewDataReset, type DataResetOperation } from './data-reset';
import { withDataLock } from './data-lock';
import { DEFAULT_SYSTEM_CATEGORIES, DEFAULT_WORKSPACES } from './default-data';
import { RestoreError } from './restore-errors';
import { recoverPendingRestores } from './restore-recovery';
import { restoreBackup } from './restore';
import { STORE_REPLACEMENT_ORDER } from './store-replacement';
import { PERSISTED_STORE_KEYS, PERSISTED_STORES, type PersistedStoreKey } from './store-manifest';
import { CLEAR_RESET_SECTION_TITLE, formatCount, RESET_OPTIONS } from './ui-copy';

const temporaryRoots: string[] = [];
const now = '2026-10-05T12:00:00.000Z';

const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-reset-'));
  temporaryRoots.push(root);
  return root;
};

test.after(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
});

const fixtureStores = (): Record<PersistedStoreKey, Record<string, unknown>[]> => {
  const categories = structuredClone(DEFAULT_SYSTEM_CATEGORIES) as Record<string, unknown>[];
  const housing = categories.find((category) => category.id === 'cat_housing')!;
  (housing.subcategories as Record<string, unknown>[]).push({
    id: 'sub_custom-home', categoryId: 'cat_housing', name: 'Custom home', order: 99,
    isSystem: false, isActive: true, flowType: 'Expense',
  });
  categories.push({
    id: 'cat_custom', name: 'Custom category', type: 'expense', order: 99,
    isSystem: false, isActive: true,
    subcategories: [{
      id: 'sub_custom', categoryId: 'cat_custom', name: 'Custom subcategory', order: 1,
      isSystem: false, isActive: true, flowType: 'Expense',
    }],
  });

  return {
    workspaces: [
      ...structuredClone(DEFAULT_WORKSPACES) as Record<string, unknown>[],
      { id: 'ws2', name: 'Second workspace', baseCurrency: 'EUR', ownerUserId: 'local', createdAt: now, updatedAt: now },
    ],
    accounts: [{
      id: 'acc-a', workspaceId: 'ws1', name: 'Account A', type: 'bank', currency: 'EUR',
      institution: 'Bank', openingBalance: 10, archived: false, createdAt: now, updatedAt: now,
    }],
    categories,
    imports: [{
      id: 'imp-a', workspaceId: 'ws1', accountId: 'acc-a', createdAt: now,
      fileName: 'private-statement.csv', sourceType: 'CSV', template: 'Manual mapping', transactionCount: 2,
      updatedAt: now,
    }],
    importTemplates: [{
      id: 'tpl-a', workspaceId: 'ws1', name: 'Bank template', sourceType: 'CSV',
      headerSignature: ['Date', 'Description', 'Amount'],
      mapping: { dateField: 'Date', descriptionField: 'Description', amountField: 'Amount' },
      defaultAccountId: 'acc-a', createdAt: now, updatedAt: now,
    }],
    budgets: [{
      id: 'budget-a', workspaceId: 'ws1', year: 2026, createdFromSampleMonths: 3,
      samplePeriodFrom: '2026-01', samplePeriodTo: '2026-12', createdAt: now, updatedAt: now,
    }],
    rules: [{
      id: 'rule-a', workspaceId: 'ws1', match: { descriptionContains: 'Coffee', accountId: 'acc-a' },
      action: { categoryId: 'cat_housing', subcategoryId: 'sub_rent', type: 'Expense' },
      createdFromTransactionId: 'tx-a', createdAt: now, updatedAt: now,
    }],
    transactions: [{
      id: 'tx-a', workspaceId: 'ws1', accountId: 'acc-a', date: '2026-10-01',
      description: 'Private transaction A', amountOriginal: -10, currencyOriginal: 'EUR', amountBase: -10,
      type: 'Expense', categoryId: 'cat_housing', subcategoryId: 'sub_rent', importId: 'imp-a',
      needsReview: false, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false,
      createdAt: now, updatedAt: now,
    }, {
      id: 'tx-b', workspaceId: 'ws1', accountId: 'acc-a', date: '2026-10-02',
      description: 'Private transaction B', amountOriginal: -20, currencyOriginal: 'EUR', amountBase: -20,
      type: 'Expense', categoryId: 'cat_custom', subcategoryId: 'sub_custom', importId: 'imp-a',
      needsReview: true, isInternalTransfer: false, isPotentialDuplicate: true, isInconsistent: false,
      createdAt: now, updatedAt: now,
    }],
  };
};

const writeStores = (directory: string, stores = fixtureStores()) => {
  fs.mkdirSync(directory, { recursive: true });
  for (const key of PERSISTED_STORE_KEYS) {
    fs.writeFileSync(path.join(directory, PERSISTED_STORES[key].filename), JSON.stringify(stores[key], null, 2), 'utf-8');
  }
};

const readStores = (directory: string) => Object.fromEntries(PERSISTED_STORE_KEYS.map((key) => [
  key,
  JSON.parse(fs.readFileSync(path.join(directory, PERSISTED_STORES[key].filename), 'utf-8')),
])) as Record<PersistedStoreKey, Record<string, unknown>[]>;

const readBytes = (directory: string) => Object.fromEntries(PERSISTED_STORE_KEYS.map((key) => [
  key,
  fs.readFileSync(path.join(directory, PERSISTED_STORES[key].filename)),
])) as Record<PersistedStoreKey, Buffer>;

const makeDirectories = () => {
  const root = makeRoot();
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  writeStores(dataDirectory);
  return { root, dataDirectory, operationsDirectory };
};

const assertDefaultCategories = (records: Record<string, unknown>[]) => {
  assert.deepEqual(records, structuredClone(DEFAULT_SYSTEM_CATEGORIES));
};

test('all three previews report current impact without mutating any store', async () => {
  for (const operation of ['clear_activity', 'reset_financial', 'factory_reset'] as const) {
    const { dataDirectory, operationsDirectory } = makeDirectories();
    const before = readBytes(dataDirectory);
    const preview = await previewDataReset(operation, {
      dataDirectory,
      operationsDirectory,
      ...(operation === 'factory_reset' ? {} : { workspaceId: 'ws1' }),
    });
    assert.equal(preview.currentCounts.transactions, 2);
    assert.equal(preview.currentCounts.imports, 1);
    assert.equal(preview.customCategoryCount, 1);
    assert.equal(preview.customSubcategoryCount, 2);
    const after = readBytes(dataDirectory);
    for (const key of PERSISTED_STORE_KEYS) assert.equal(after[key].equals(before[key]), true);
  }
});

test('Clear Activity clears transactions and imports while preserving every setup store byte-for-byte', async () => {
  const { dataDirectory, operationsDirectory } = makeDirectories();
  const before = readBytes(dataDirectory);
  const result = await executeDataReset('clear_activity', true, { dataDirectory, operationsDirectory, workspaceId: 'ws1' });
  assert.deepEqual(result.replacedStores, ['imports', 'transactions']);
  const stores = readStores(dataDirectory);
  assert.deepEqual(stores.imports, []);
  assert.deepEqual(stores.transactions, []);
  for (const key of ['workspaces', 'accounts', 'categories', 'importTemplates', 'budgets', 'rules'] as const) {
    assert.equal(fs.readFileSync(path.join(dataDirectory, PERSISTED_STORES[key].filename)).equals(before[key]), true);
  }
  assert.equal(stores.rules[0].createdFromTransactionId, 'tx-a');
});

test('Reset Financial Data preserves workspaces and restores only authoritative categories', async () => {
  const { dataDirectory, operationsDirectory } = makeDirectories();
  const before = readBytes(dataDirectory);
  const result = await executeDataReset('reset_financial', true, { dataDirectory, operationsDirectory, workspaceId: 'ws1' });
  assert.deepEqual(result.replacedStores, ['categories', 'accounts', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions']);
  const stores = readStores(dataDirectory);
  assert.equal(fs.readFileSync(path.join(dataDirectory, 'workspaces.json')).equals(before.workspaces), true);
  assert.equal(stores.workspaces.length, 2);
  assert.equal(stores.categories.length, DEFAULT_SYSTEM_CATEGORIES.length);
  assert.ok(stores.categories.every((category) => category.workspaceId === 'ws1'));
  assert.deepEqual(stores.categories.map((category) => category.name), DEFAULT_SYSTEM_CATEGORIES.map((category) => category.name));
  assert.ok(stores.categories.every((category) => !String(category.id).startsWith('cat_housing')));
  for (const key of ['accounts', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions'] as const) {
    assert.deepEqual(stores[key], []);
  }
});

test('Factory Reset produces exactly the canonical bootable default state', async () => {
  const { dataDirectory, operationsDirectory } = makeDirectories();
  const result = await executeDataReset('factory_reset', true, { dataDirectory, operationsDirectory });
  assert.deepEqual(result.replacedStores, STORE_REPLACEMENT_ORDER);
  const stores = readStores(dataDirectory);
  assert.deepEqual(stores.workspaces, structuredClone(DEFAULT_WORKSPACES));
  assertDefaultCategories(stores.categories);
  for (const key of ['accounts', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions'] as const) {
    assert.deepEqual(stores[key], []);
  }
});

test('explicit confirmation and known operation names are required', async () => {
  const { dataDirectory, operationsDirectory } = makeDirectories();
  const before = readBytes(dataDirectory);
  for (const [operation, confirmed] of [['clear_activity', false], ['unknown', true]] as const) {
    await assert.rejects(
      () => executeDataReset(operation, confirmed, { dataDirectory, operationsDirectory, workspaceId: 'ws1' }),
      (error: unknown) => error instanceof RestoreError && error.code === 'INVALID_OPERATION'
    );
  }
  const after = readBytes(dataDirectory);
  for (const key of PERSISTED_STORE_KEYS) assert.equal(after[key].equals(before[key]), true);
});

for (const [label, failureIndex] of [['first', 0], ['middle', 3], ['final', 7]] as const) {
  test(`destructive ${label}-replacement failure restores every original file byte-for-byte`, async () => {
    const { dataDirectory, operationsDirectory } = makeDirectories();
    const before = readBytes(dataDirectory);
    await assert.rejects(
      () => executeDataReset('factory_reset', true, {
        dataDirectory,
        operationsDirectory,
        hooks: { afterReplace: (_key, index) => {
          if (index === failureIndex) throw new Error(`Injected ${label} failure`);
        } },
      }),
      (error: unknown) => error instanceof RestoreError && error.code === 'DATA_OPERATION_FAILURE'
    );
    const after = readBytes(dataDirectory);
    for (const key of PERSISTED_STORE_KEYS) assert.equal(after[key].equals(before[key]), true);
    assert.deepEqual(fs.existsSync(operationsDirectory) ? fs.readdirSync(operationsDirectory) : [], []);
  });
}

test('rollback failure preserves artifacts and the next recovery restores original data', async () => {
  const { dataDirectory, operationsDirectory } = makeDirectories();
  const before = readBytes(dataDirectory);
  await assert.rejects(
    () => executeDataReset('factory_reset', true, {
      dataDirectory,
      operationsDirectory,
      hooks: {
        afterReplace: (_key, index) => { if (index === 2) throw new Error('Injected replacement failure'); },
        beforeRollback: () => { throw new Error('Injected rollback failure'); },
      },
    }),
    (error: unknown) => error instanceof RestoreError && error.code === 'ROLLBACK_FAILURE'
  );
  assert.ok(fs.readdirSync(operationsDirectory).length > 0);
  await recoverPendingRestores({ dataDirectory, operationsDirectory });
  const recovered = readBytes(dataDirectory);
  for (const key of PERSISTED_STORE_KEYS) assert.equal(recovered[key].equals(before[key]), true);
  assert.deepEqual(fs.readdirSync(operationsDirectory), []);
});

test('successful destructive operations remove snapshots, journals, and staged files', async () => {
  for (const operation of ['clear_activity', 'reset_financial', 'factory_reset'] as const) {
    const { dataDirectory, operationsDirectory } = makeDirectories();
    await executeDataReset(operation, true, {
      dataDirectory,
      operationsDirectory,
      ...(operation === 'factory_reset' ? {} : { workspaceId: 'ws1' }),
    });
    assert.deepEqual(fs.existsSync(operationsDirectory) ? fs.readdirSync(operationsDirectory) : [], []);
    assert.equal(fs.readdirSync(dataDirectory).some((name) => name.includes('.stage') || name.includes('.tmp')), false);
  }
});

test('the global lock serializes preview behind a conflicting operation', async () => {
  const { dataDirectory, operationsDirectory } = makeDirectories();
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const holder = withDataLock(async () => { entered(); await gate; });
  await enteredPromise;

  let previewResolved = false;
  const previewPromise = previewDataReset('clear_activity', { dataDirectory, operationsDirectory, workspaceId: 'ws1' })
    .then((preview) => { previewResolved = true; return preview; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(previewResolved, false);
  release();
  await holder;
  assert.equal((await previewPromise).currentCounts.transactions, 2);
});

const apiRequest = (url: string, operation: unknown, confirmed?: boolean) => new Request(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ operation, confirmed, workspaceId: 'ws1' }),
});

const withApiDirectories = async <T>(dataDirectory: string, operationsDirectory: string, task: () => Promise<T>) => {
  const previousData = process.env.FLOWLEDGER_DATA_DIR;
  const previousOperations = process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR;
  process.env.FLOWLEDGER_DATA_DIR = dataDirectory;
  process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR = operationsDirectory;
  try {
    return await task();
  } finally {
    if (previousData === undefined) delete process.env.FLOWLEDGER_DATA_DIR;
    else process.env.FLOWLEDGER_DATA_DIR = previousData;
    if (previousOperations === undefined) delete process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR;
    else process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR = previousOperations;
  }
};

test('preview API returns counts only and execution API enforces confirmation', async () => {
  const { dataDirectory, operationsDirectory } = makeDirectories();
  const before = readBytes(dataDirectory);
  const previewResponse = await withApiDirectories(dataDirectory, operationsDirectory, () =>
    resetPreviewPost(apiRequest('http://localhost/api/data-management/reset/preview', 'clear_activity'))
  );
  assert.equal(previewResponse.status, 200);
  const previewBody = await previewResponse.json();
  assert.equal(previewBody.preview.currentCounts.transactions, 2);
  assert.equal(JSON.stringify(previewBody).includes('Private transaction'), false);
  for (const key of PERSISTED_STORE_KEYS) {
    assert.equal(fs.readFileSync(path.join(dataDirectory, PERSISTED_STORES[key].filename)).equals(before[key]), true);
  }

  const unconfirmed = await withApiDirectories(dataDirectory, operationsDirectory, () =>
    resetPost(apiRequest('http://localhost/api/data-management/reset', 'clear_activity', false))
  );
  assert.equal(unconfirmed.status, 400);
  assert.equal((await unconfirmed.json()).error.code, 'INVALID_OPERATION');

  const confirmed = await withApiDirectories(dataDirectory, operationsDirectory, () =>
    resetPost(apiRequest('http://localhost/api/data-management/reset', 'clear_activity', true))
  );
  assert.equal(confirmed.status, 200);
  assert.equal((await confirmed.json()).result.completed, true);
  assert.deepEqual(readStores(dataDirectory).transactions, []);
});

test('backup export and replace-all restore still work after a destructive operation', async () => {
  const { dataDirectory, operationsDirectory } = makeDirectories();
  const backup = await createBackup('everything', { dataDirectory, operationsDirectory, now: () => new Date(now) });
  await executeDataReset('factory_reset', true, { dataDirectory, operationsDirectory });
  await restoreBackup(JSON.stringify(backup), { dataDirectory, operationsDirectory });
  const restored = readStores(dataDirectory);
  assert.equal(restored.transactions.length, 2);
  assert.equal(restored.workspaces.length, 2);
  const reExported = await createBackup('everything', { dataDirectory, operationsDirectory, now: () => new Date(now) });
  assert.equal(reExported.storeManifest.length, 8);
});

test('reset operation input type covers exactly the three supported operations', () => {
  const operations: DataResetOperation[] = ['clear_activity', 'reset_financial', 'factory_reset'];
  assert.equal(new Set(operations).size, 3);
});

test('destructive operations pair directly with their canonical backup scopes', async () => {
  const expected = {
    clear_activity: 'activity',
    reset_financial: 'financial_data',
    factory_reset: 'everything',
  } as const;
  for (const operation of Object.keys(expected) as DataResetOperation[]) {
    const { dataDirectory, operationsDirectory } = makeDirectories();
    const preview = await previewDataReset(operation, {
      dataDirectory,
      operationsDirectory,
      ...(operation === 'factory_reset' ? {} : { workspaceId: 'ws1' }),
    });
    assert.equal(preview.backupScope, expected[operation]);
  }
});

test('Clear & Reset copy and count grammar use canonical names and pluralization', () => {
  assert.equal(CLEAR_RESET_SECTION_TITLE, 'Clear & Reset Data');
  assert.equal(RESET_OPTIONS.clear_activity.title, 'Clear Activity');
  assert.equal(formatCount(1, 'workspace'), '1 workspace');
  assert.equal(formatCount(2, 'workspace'), '2 workspaces');
  assert.equal(formatCount(1, 'import template'), '1 import template');
  assert.equal(formatCount(1, 'budget record'), '1 budget record');
  assert.equal(formatCount(1, 'custom category', 'custom categories'), '1 custom category');
  assert.equal(formatCount(1, 'custom subcategory', 'custom subcategories'), '1 custom subcategory');
});
