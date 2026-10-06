import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { POST as deletePost } from '@/app/api/data-management/transactions/delete/route';
import { POST as previewPost } from '@/app/api/data-management/transactions/delete/preview/route';
import {
  clampTransactionPage,
  incompleteLinkedPairMessage,
  nextSelectionAfterBulkDelete,
} from '@/components/transactions/data-table';
import { createBackup } from './backup';
import { withDataLock } from './data-lock';
import { executeDataReset } from './data-reset';
import { DEFAULT_SYSTEM_CATEGORIES, DEFAULT_WORKSPACES } from './default-data';
import { listImportHistory } from './import-history';
import { RestoreError } from './restore-errors';
import { recoverPendingRestores } from './restore-recovery';
import { restoreBackup } from './restore';
import { PERSISTED_STORE_KEYS, PERSISTED_STORES, type PersistedStoreKey } from './store-manifest';
import {
  executeTransactionBulkDelete,
  previewTransactionBulkDelete,
} from './transaction-bulk-delete';

type RecordValue = Record<string, unknown>;
type StoreFixture = Record<PersistedStoreKey, RecordValue[]>;

const roots: string[] = [];
const now = '2026-10-06T12:00:00.000Z';

test.after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const transaction = (id: string, workspaceId: string, accountId: string, overrides: RecordValue = {}): RecordValue => ({
  id,
  workspaceId,
  accountId,
  date: '2026-10-01',
  description: `Transaction ${id}`,
  rawDescription: '',
  amountOriginal: -10,
  currencyOriginal: 'EUR',
  amountBase: -10,
  type: 'Expense',
  needsReview: false,
  isInternalTransfer: false,
  isPotentialDuplicate: false,
  isInconsistent: false,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const fixtureStores = (): StoreFixture => ({
  workspaces: [
    ...structuredClone(DEFAULT_WORKSPACES) as RecordValue[],
    { id: 'ws2', name: 'Other', baseCurrency: 'EUR', ownerUserId: 'local', createdAt: now, updatedAt: now },
  ],
  accounts: [
    { id: 'acc-a', workspaceId: 'ws1', name: 'Checking', type: 'bank', currency: 'EUR', institution: 'Bank', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
    { id: 'acc-b', workspaceId: 'ws1', name: 'Cash', type: 'cash', currency: 'EUR', institution: 'Cash', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
    { id: 'acc-other', workspaceId: 'ws2', name: 'Other', type: 'bank', currency: 'EUR', institution: 'Bank', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
  ],
  categories: structuredClone(DEFAULT_SYSTEM_CATEGORIES) as RecordValue[],
  imports: [
    { id: 'imp-a', workspaceId: 'ws1', accountId: 'acc-a', createdAt: now, fileName: 'a.csv', sourceType: 'CSV', template: 'Manual', transactionCount: 999 },
    { id: 'imp-b', workspaceId: 'ws1', accountId: 'acc-b', createdAt: now, fileName: 'b.csv', sourceType: 'CSV', template: 'Manual', transactionCount: 1 },
    { id: 'imp-other', workspaceId: 'ws2', accountId: 'acc-other', createdAt: now, fileName: 'other.csv', sourceType: 'CSV', template: 'Manual', transactionCount: 1 },
  ],
  importTemplates: [],
  budgets: [],
  rules: [],
  transactions: [
    transaction('tx-a', 'ws1', 'acc-a', { importId: 'imp-a' }),
    transaction('tx-b', 'ws1', 'acc-a', {
      importId: 'imp-a',
      amountOriginal: -20,
      amountBase: -20,
      isPotentialDuplicate: true,
      potentialDuplicateMatch: {
        transactionId: 'tx-a', date: '2026-10-01', description: 'Historical match', amountBase: -10,
      },
    }),
    transaction('tx-manual', 'ws1', 'acc-b', { amountOriginal: 40, amountBase: 40, type: 'Income' }),
    transaction('tx-other', 'ws2', 'acc-other', { importId: 'imp-other' }),
  ],
});

const addLinkedPair = (
  stores: StoreFixture,
  prefix: string,
  sourceImportId?: string,
  counterpartImportId?: string
) => {
  const outId = `${prefix}-out`;
  const inId = `${prefix}-in`;
  stores.transactions.push(
    transaction(outId, 'ws1', 'acc-a', {
      ...(sourceImportId ? { importId: sourceImportId } : {}),
      type: 'InternalTransfer', isInternalTransfer: true, internalDirection: 'Out',
      destinationAccountId: 'acc-b', linkedTransactionId: inId,
      amountOriginal: -75, amountBase: -75,
    }),
    transaction(inId, 'ws1', 'acc-b', {
      ...(counterpartImportId ? { importId: counterpartImportId } : {}),
      type: 'InternalTransfer', isInternalTransfer: true, internalDirection: 'In',
      destinationAccountId: 'acc-a', linkedTransactionId: outId,
      amountOriginal: 75, amountBase: 75,
    })
  );
  return { outId, inId };
};

const makeDirectories = (stores = fixtureStores()) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-bulk-delete-'));
  roots.push(root);
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  fs.mkdirSync(dataDirectory, { recursive: true });
  for (const key of PERSISTED_STORE_KEYS) {
    fs.writeFileSync(path.join(dataDirectory, PERSISTED_STORES[key].filename), JSON.stringify(stores[key], null, 2), 'utf-8');
  }
  return { dataDirectory, operationsDirectory };
};

const readStores = (dataDirectory: string): StoreFixture => Object.fromEntries(
  PERSISTED_STORE_KEYS.map((key) => [
    key,
    JSON.parse(fs.readFileSync(path.join(dataDirectory, PERSISTED_STORES[key].filename), 'utf-8')),
  ])
) as StoreFixture;

const readBytes = (dataDirectory: string) => Object.fromEntries(
  PERSISTED_STORE_KEYS.map((key) => [key, fs.readFileSync(path.join(dataDirectory, PERSISTED_STORES[key].filename))])
) as Record<PersistedStoreKey, Buffer>;

const assertAllBytesEqual = (before: Record<PersistedStoreKey, Buffer>, dataDirectory: string) => {
  const after = readBytes(dataDirectory);
  for (const key of PERSISTED_STORE_KEYS) assert.equal(after[key].equals(before[key]), true, key);
};

test('empty selection is rejected and duplicate IDs are de-duplicated', async () => {
  const paths = makeDirectories();
  await assert.rejects(
    () => previewTransactionBulkDelete('ws1', [], paths),
    (error: unknown) => error instanceof RestoreError && error.code === 'INVALID_OPERATION'
  );
  const preview = await previewTransactionBulkDelete('ws1', ['tx-a', 'tx-a'], paths);
  assert.equal(preview.selectedTransactionCount, 1);
  assert.equal(preview.transactionsToDelete, 1);
});

test('unknown IDs and IDs outside the current data scope are rejected', async () => {
  const paths = makeDirectories();
  for (const id of ['missing', 'tx-other']) {
    await assert.rejects(
      () => previewTransactionBulkDelete('ws1', [id], paths),
      (error: unknown) => error instanceof RestoreError && error.code === 'INVALID_OPERATION'
    );
  }
});

test('preview is read-only and reports safe counts, affected imports, and zero-linked imports', async () => {
  const paths = makeDirectories();
  const before = readBytes(paths.dataDirectory);
  const preview = await previewTransactionBulkDelete('ws1', ['tx-a', 'tx-b'], paths);
  assert.deepEqual(preview, {
    selectedTransactionCount: 2,
    transactionsToDelete: 2,
    remainingTransactionCount: 1,
    completeLinkedPairCount: 0,
    incompleteLinkedPairCount: 0,
    affectedImportSessionCount: 1,
    zeroLinkedImportSessionCount: 1,
    allowed: true,
  });
  assertAllBytesEqual(before, paths.dataDirectory);
});

test('single and multiple explicit selections delete exactly those transactions atomically', async () => {
  const singlePaths = makeDirectories();
  await executeTransactionBulkDelete('ws1', ['tx-manual'], true, singlePaths);
  assert.deepEqual(readStores(singlePaths.dataDirectory).transactions.map((record) => record.id), ['tx-a', 'tx-b', 'tx-other']);

  const multiplePaths = makeDirectories();
  const before = readStores(multiplePaths.dataDirectory);
  const beforeBytes = readBytes(multiplePaths.dataDirectory);
  const result = await executeTransactionBulkDelete('ws1', ['tx-a', 'tx-manual'], true, multiplePaths);
  assert.equal(result.deletedTransactions, 2);
  const after = readStores(multiplePaths.dataDirectory);
  assert.deepEqual(after.transactions.map((record) => record.id), ['tx-b', 'tx-other']);
  assert.deepEqual(after.transactions.find((record) => record.id === 'tx-b'), before.transactions.find((record) => record.id === 'tx-b'));
  assert.deepEqual(after.imports, before.imports);
  for (const key of ['workspaces', 'accounts', 'categories', 'imports', 'importTemplates', 'budgets', 'rules'] as const) {
    assert.equal(fs.readFileSync(path.join(multiplePaths.dataDirectory, PERSISTED_STORES[key].filename)).equals(beforeBytes[key]), true, key);
  }
});

test('half-linked pair blocks deletion and the deletion set never auto-expands', async () => {
  const stores = fixtureStores();
  const pair = addLinkedPair(stores, 'pair');
  const paths = makeDirectories(stores);
  const before = readBytes(paths.dataDirectory);
  const preview = await previewTransactionBulkDelete('ws1', [pair.outId], paths);
  assert.equal(preview.allowed, false);
  assert.equal(preview.incompleteLinkedPairCount, 1);
  assert.equal(preview.transactionsToDelete, 1);
  await assert.rejects(
    () => executeTransactionBulkDelete('ws1', [pair.outId], true, paths),
    (error: unknown) => error instanceof RestoreError && error.code === 'REFERENTIAL_INTEGRITY_FAILURE'
  );
  assertAllBytesEqual(before, paths.dataDirectory);
});

test('both legs and multiple complete linked pairs can be deleted together', async () => {
  const stores = fixtureStores();
  const first = addLinkedPair(stores, 'first');
  const second = addLinkedPair(stores, 'second');
  const paths = makeDirectories(stores);
  const ids = [first.outId, first.inId, second.outId, second.inId];
  const preview = await previewTransactionBulkDelete('ws1', ids, paths);
  assert.equal(preview.allowed, true);
  assert.equal(preview.completeLinkedPairCount, 2);
  await executeTransactionBulkDelete('ws1', ids, true, paths);
  const remainingIds = readStores(paths.dataDirectory).transactions.map((record) => record.id);
  assert.equal(ids.some((id) => remainingIds.includes(id)), false);
});

test('mixed complete and incomplete linked pairs block the whole operation', async () => {
  const stores = fixtureStores();
  const complete = addLinkedPair(stores, 'complete');
  const incomplete = addLinkedPair(stores, 'incomplete');
  const paths = makeDirectories(stores);
  const before = readBytes(paths.dataDirectory);
  const ids = [complete.outId, complete.inId, incomplete.outId];
  const preview = await previewTransactionBulkDelete('ws1', ids, paths);
  assert.equal(preview.completeLinkedPairCount, 1);
  assert.equal(preview.incompleteLinkedPairCount, 1);
  assert.equal(preview.allowed, false);
  await assert.rejects(() => executeTransactionBulkDelete('ws1', ids, true, paths));
  assertAllBytesEqual(before, paths.dataDirectory);
});

test('import sessions remain, stale transactionCount is ignored, and zero-linked sessions are valid', async () => {
  const paths = makeDirectories();
  const preview = await previewTransactionBulkDelete('ws1', ['tx-a', 'tx-b'], paths);
  assert.equal(preview.affectedImportSessionCount, 1);
  assert.equal(preview.zeroLinkedImportSessionCount, 1);
  await executeTransactionBulkDelete('ws1', ['tx-a', 'tx-b'], true, paths);
  const stores = readStores(paths.dataDirectory);
  assert.equal(stores.imports.find((record) => record.id === 'imp-a')?.transactionCount, 999);
  assert.equal(stores.imports.some((record) => record.id === 'imp-a'), true);
  const importHistory = await listImportHistory('ws1', paths);
  assert.equal(importHistory.find((record) => record.id === 'imp-a')?.linkedTransactionCount, 0);
});

test('duplicate match context is soft history while hard linkedTransactionId integrity remains validated', async () => {
  const paths = makeDirectories();
  await executeTransactionBulkDelete('ws1', ['tx-a'], true, paths);
  const remaining = readStores(paths.dataDirectory).transactions.find((record) => record.id === 'tx-b')!;
  assert.equal((remaining.potentialDuplicateMatch as RecordValue).transactionId, 'tx-a');
});

test('explicit confirmation is required', async () => {
  const paths = makeDirectories();
  const before = readBytes(paths.dataDirectory);
  await assert.rejects(
    () => executeTransactionBulkDelete('ws1', ['tx-a'], false, paths),
    (error: unknown) => error instanceof RestoreError && error.code === 'INVALID_OPERATION'
  );
  assertAllBytesEqual(before, paths.dataDirectory);
});

test('replacement failure rolls back the byte-equivalent original transaction store', async () => {
  const paths = makeDirectories();
  const before = readBytes(paths.dataDirectory);
  await assert.rejects(
    () => executeTransactionBulkDelete('ws1', ['tx-a'], true, {
      ...paths,
      hooks: { afterReplace: () => { throw new Error('Injected replacement failure'); } },
    }),
    (error: unknown) => error instanceof RestoreError && error.code === 'DATA_OPERATION_FAILURE'
  );
  assertAllBytesEqual(before, paths.dataDirectory);
});

test('rollback failure preserves artifacts and the transaction-delete journal recovers safely', async () => {
  const paths = makeDirectories();
  const before = readBytes(paths.dataDirectory);
  await assert.rejects(
    () => executeTransactionBulkDelete('ws1', ['tx-a'], true, {
      ...paths,
      hooks: {
        afterReplace: () => { throw new Error('Injected replacement failure'); },
        beforeRollback: () => { throw new Error('Injected rollback failure'); },
      },
    }),
    (error: unknown) => error instanceof RestoreError && error.code === 'ROLLBACK_FAILURE'
  );
  assert.ok(fs.readdirSync(paths.operationsDirectory).length > 0);
  await recoverPendingRestores(paths);
  assertAllBytesEqual(before, paths.dataDirectory);
  assert.deepEqual(fs.readdirSync(paths.operationsDirectory), []);
});

test('successful deletion cleans artifacts and the shared lock serializes the operation', async () => {
  const paths = makeDirectories();
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const holder = withDataLock(async () => { entered(); await gate; });
  await enteredPromise;
  let resolved = false;
  const deletion = executeTransactionBulkDelete('ws1', ['tx-a'], true, paths).then((result) => {
    resolved = true;
    return result;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(resolved, false);
  release();
  await holder;
  assert.equal((await deletion).deletedTransactions, 1);
  assert.deepEqual(fs.existsSync(paths.operationsDirectory) ? fs.readdirSync(paths.operationsDirectory) : [], []);
  assert.equal(fs.readdirSync(paths.dataDirectory).some((name) => name.includes('.stage') || name.includes('.tmp')), false);
});

const withApiDirectories = async <T>(paths: { dataDirectory: string; operationsDirectory: string }, task: () => Promise<T>) => {
  const previousData = process.env.FLOWLEDGER_DATA_DIR;
  const previousOperations = process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR;
  process.env.FLOWLEDGER_DATA_DIR = paths.dataDirectory;
  process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR = paths.operationsDirectory;
  try {
    return await task();
  } finally {
    if (previousData === undefined) delete process.env.FLOWLEDGER_DATA_DIR;
    else process.env.FLOWLEDGER_DATA_DIR = previousData;
    if (previousOperations === undefined) delete process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR;
    else process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR = previousOperations;
  }
};

const jsonRequest = (url: string, body: RecordValue) => new Request(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

test('API preview returns safe counts and API execution returns a non-sensitive summary', async () => {
  const paths = makeDirectories();
  const before = readBytes(paths.dataDirectory);
  const previewResponse = await withApiDirectories(paths, () => previewPost(jsonRequest(
    'http://localhost/api/data-management/transactions/delete/preview',
    { workspaceId: 'ws1', transactionIds: ['tx-a'] }
  )));
  assert.equal(previewResponse.status, 200);
  const previewBody = await previewResponse.json();
  assert.equal(previewBody.preview.transactionsToDelete, 1);
  assert.equal(JSON.stringify(previewBody).includes('Transaction tx-a'), false);
  assertAllBytesEqual(before, paths.dataDirectory);

  const response = await withApiDirectories(paths, () => deletePost(jsonRequest(
    'http://localhost/api/data-management/transactions/delete',
    { workspaceId: 'ws1', transactionIds: ['tx-a'], confirmDelete: true }
  )));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.deletedTransactions, 1);
  assert.equal(JSON.stringify(body).includes('Transaction tx-a'), false);
});

test('UI state helpers clear selection only after success, clamp empty pages, and expose blocked-pair copy', () => {
  assert.deepEqual(nextSelectionAfterBulkDelete(['tx-a'], true), []);
  assert.deepEqual(nextSelectionAfterBulkDelete(['tx-a'], false), ['tx-a']);
  assert.equal(clampTransactionPage(3, 2), 2);
  assert.equal(clampTransactionPage(2, 0), 1);
  assert.equal(incompleteLinkedPairMessage(1),
    '1 linked transfer pair is incomplete. Select both transfer transactions before deleting.');
});

test('Activity backup, Activity restore, Clear Activity, and Import History remain compatible', async () => {
  const paths = makeDirectories();
  const backup = await createBackup('activity', { ...paths, now: () => new Date(now) });
  assert.deepEqual(backup.includedStores, ['imports', 'transactions']);
  await executeTransactionBulkDelete('ws1', ['tx-a'], true, paths);
  await restoreBackup(JSON.stringify(backup), paths);
  assert.equal(readStores(paths.dataDirectory).transactions.some((record) => record.id === 'tx-a'), true);
  assert.equal((await listImportHistory('ws1', paths)).find((record) => record.id === 'imp-a')?.linkedTransactionCount, 2);
  await executeDataReset('clear_activity', true, paths);
  assert.deepEqual(readStores(paths.dataDirectory).transactions, []);
});
