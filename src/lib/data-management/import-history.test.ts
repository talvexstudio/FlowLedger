import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GET as historyGet, POST as historyPost } from '@/app/api/data-management/import-history/route';
import { POST as historyPreviewPost } from '@/app/api/data-management/import-history/preview/route';
import { createBackup } from './backup';
import { withDataLock } from './data-lock';
import { executeDataReset } from './data-reset';
import { DEFAULT_SYSTEM_CATEGORIES, DEFAULT_WORKSPACES } from './default-data';
import {
  executeImportHistoryAction,
  listImportHistory,
  previewImportHistoryAction,
} from './import-history';
import { IMPORT_HISTORY_ACTION_OPTIONS } from './import-history-types';
import { RestoreError } from './restore-errors';
import { recoverPendingRestores } from './restore-recovery';
import { restoreBackup } from './restore';
import { PERSISTED_STORE_KEYS, PERSISTED_STORES, type PersistedStoreKey } from './store-manifest';

type RecordValue = Record<string, unknown>;
type StoreFixture = Record<PersistedStoreKey, RecordValue[]>;

const roots: string[] = [];
const now = '2026-10-06T10:00:00.000Z';

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
    { id: 'ws2', name: 'Workspace Two', baseCurrency: 'EUR', ownerUserId: 'local', createdAt: now, updatedAt: now },
  ],
  accounts: [
    { id: 'acc-a', workspaceId: 'ws1', name: 'Checking', type: 'bank', currency: 'EUR', institution: 'Bank A', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
    { id: 'acc-b', workspaceId: 'ws1', name: 'Cash', type: 'cash', currency: 'EUR', institution: 'Cash', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
    { id: 'acc-c', workspaceId: 'ws2', name: 'Other Workspace Account', type: 'bank', currency: 'EUR', institution: 'Bank B', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
  ],
  categories: structuredClone(DEFAULT_SYSTEM_CATEGORIES) as RecordValue[],
  imports: [
    { id: 'imp-a', workspaceId: 'ws1', accountId: 'acc-a', createdAt: now, fileName: 'statement-a.csv', sourceType: 'CSV', template: 'Manual mapping', transactionCount: 999 },
    { id: 'imp-zero', workspaceId: 'ws1', accountId: 'acc-b', createdAt: '2026-09-01T10:00:00.000Z', fileName: 'empty.xlsx', sourceType: 'XLSX', template: 'Spreadsheet', transactionCount: 14 },
    { id: 'imp-other', workspaceId: 'ws2', accountId: 'acc-c', createdAt: now, fileName: 'other.pdf', sourceType: 'PDF', template: 'CGD', transactionCount: 1 },
  ],
  importTemplates: [],
  budgets: [],
  rules: [],
  transactions: [
    transaction('tx-a', 'ws1', 'acc-a', { importId: 'imp-a' }),
    transaction('tx-b', 'ws1', 'acc-a', { importId: 'imp-a', amountOriginal: -20, amountBase: -20 }),
    transaction('tx-manual', 'ws1', 'acc-b', { amountOriginal: 50, amountBase: 50, type: 'Income' }),
    transaction('tx-other', 'ws2', 'acc-c', { importId: 'imp-other' }),
  ],
});

const addLinkedPair = (
  stores: StoreFixture,
  sourceImportId: string | undefined,
  counterpartImportId: string | undefined
) => {
  const source = transaction('tx-transfer-out', 'ws1', 'acc-a', {
    ...(sourceImportId ? { importId: sourceImportId } : {}),
    type: 'InternalTransfer',
    isInternalTransfer: true,
    internalDirection: 'Out',
    destinationAccountId: 'acc-b',
    linkedTransactionId: 'tx-transfer-in',
    amountOriginal: -75,
    amountBase: -75,
  });
  const counterpart = transaction('tx-transfer-in', 'ws1', 'acc-b', {
    ...(counterpartImportId ? { importId: counterpartImportId } : {}),
    type: 'InternalTransfer',
    isInternalTransfer: true,
    internalDirection: 'In',
    destinationAccountId: 'acc-a',
    linkedTransactionId: 'tx-transfer-out',
    amountOriginal: 75,
    amountBase: 75,
  });
  stores.transactions.push(source, counterpart);
};

const makeDirectories = (stores = fixtureStores()) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-import-history-'));
  roots.push(root);
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  fs.mkdirSync(dataDirectory, { recursive: true });
  for (const key of PERSISTED_STORE_KEYS) {
    fs.writeFileSync(
      path.join(dataDirectory, PERSISTED_STORES[key].filename),
      JSON.stringify(stores[key], null, 2),
      'utf-8'
    );
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
  PERSISTED_STORE_KEYS.map((key) => [
    key,
    fs.readFileSync(path.join(dataDirectory, PERSISTED_STORES[key].filename)),
  ])
) as Record<PersistedStoreKey, Buffer>;

const assertAllBytesEqual = (before: Record<PersistedStoreKey, Buffer>, dataDirectory: string) => {
  const after = readBytes(dataDirectory);
  for (const key of PERSISTED_STORE_KEYS) assert.equal(after[key].equals(before[key]), true, key);
};

test('list is workspace-scoped and derives current counts instead of stale transactionCount metadata', async () => {
  const paths = makeDirectories();
  const imports = await listImportHistory('ws1', paths);
  assert.deepEqual(imports.map((item) => item.id), ['imp-a', 'imp-zero']);
  assert.equal(imports[0].linkedTransactionCount, 2);
  assert.equal(imports[0].historicalTransactionCount, 999);
  assert.equal(imports[0].accountName, 'Checking');
  assert.equal('workspaceName' in imports[0], false);
  assert.equal(imports[1].linkedTransactionCount, 0);
  assert.equal(imports.some((item) => item.id === 'imp-other'), false);
});

test('single previews are read-only and report actual impact, preserved transactions, and zero-linked sessions', async () => {
  const paths = makeDirectories();
  const before = readBytes(paths.dataDirectory);
  const deletePreview = await previewImportHistoryAction('ws1', 'delete_with_transactions', 'imp-a', paths);
  assert.equal(deletePreview.linkedTransactionCount, 2);
  assert.equal(deletePreview.transactionsToDelete, 2);
  assert.equal(deletePreview.transactionsToPreserve, 1);
  assert.equal(deletePreview.importSessionCount, 1);
  assert.equal(deletePreview.allowed, true);
  const emptyPreview = await previewImportHistoryAction('ws1', 'delete_with_transactions', 'imp-zero', paths);
  assert.equal(emptyPreview.transactionsToDelete, 0);
  assert.equal(emptyPreview.allowed, true);
  assertAllBytesEqual(before, paths.dataDirectory);
});

test('Delete import and transactions removes exactly the authoritative importId set', async () => {
  const paths = makeDirectories();
  const beforeBytes = readBytes(paths.dataDirectory);
  const result = await executeImportHistoryAction('ws1', 'delete_with_transactions', 'imp-a', true, paths);
  assert.equal(result.deletedTransactions, 2);
  const after = readStores(paths.dataDirectory);
  assert.equal(after.imports.some((item) => item.id === 'imp-a'), false);
  assert.deepEqual(after.transactions.map((item) => item.id), ['tx-manual', 'tx-other']);
  assert.equal(after.imports.some((item) => item.id === 'imp-zero'), true);
  assert.equal(after.imports.some((item) => item.id === 'imp-other'), true);
  for (const key of ['workspaces', 'accounts', 'categories', 'importTemplates', 'budgets', 'rules'] as const) {
    assert.equal(fs.readFileSync(path.join(paths.dataDirectory, PERSISTED_STORES[key].filename)).equals(beforeBytes[key]), true, key);
  }
});

test('Delete import blocks a linked pair that crosses the import boundary and does not auto-expand deletion', async () => {
  const stores = fixtureStores();
  addLinkedPair(stores, 'imp-a', undefined);
  const paths = makeDirectories(stores);
  const before = readBytes(paths.dataDirectory);
  const preview = await previewImportHistoryAction('ws1', 'delete_with_transactions', 'imp-a', paths);
  assert.equal(preview.allowed, false);
  assert.equal(preview.blockedLinkedPairCount, 1);
  await assert.rejects(
    () => executeImportHistoryAction('ws1', 'delete_with_transactions', 'imp-a', true, paths),
    (error: unknown) => error instanceof RestoreError && error.code === 'REFERENTIAL_INTEGRITY_FAILURE'
  );
  assertAllBytesEqual(before, paths.dataDirectory);
});

test('Delete import allows a complete linked pair when both legs share the selected import', async () => {
  const stores = fixtureStores();
  addLinkedPair(stores, 'imp-a', 'imp-a');
  const paths = makeDirectories(stores);
  const preview = await previewImportHistoryAction('ws1', 'delete_with_transactions', 'imp-a', paths);
  assert.equal(preview.allowed, true);
  assert.equal(preview.transactionsToDelete, 4);
  await executeImportHistoryAction('ws1', 'delete_with_transactions', 'imp-a', true, paths);
  const after = readStores(paths.dataDirectory);
  assert.equal(after.transactions.some((item) => String(item.id).startsWith('tx-transfer')), false);
  assert.deepEqual(after.transactions.map((item) => item.id), ['tx-manual', 'tx-other']);
});

test('Delete all imported transactions is workspace-scoped, preserves manual transactions, and accepts selected pairs', async () => {
  const stores = fixtureStores();
  stores.imports.push({ id: 'imp-b', workspaceId: 'ws1', accountId: 'acc-b', createdAt: now, fileName: 'statement-b.csv', sourceType: 'CSV', template: 'Manual mapping', transactionCount: 1 });
  addLinkedPair(stores, 'imp-a', 'imp-b');
  const paths = makeDirectories(stores);
  const preview = await previewImportHistoryAction('ws1', 'delete_all_with_transactions', undefined, paths);
  assert.equal(preview.allowed, true);
  assert.equal(preview.transactionsToDelete, 4);
  await executeImportHistoryAction('ws1', 'delete_all_with_transactions', undefined, true, paths);
  const after = readStores(paths.dataDirectory);
  assert.deepEqual(after.imports.map((item) => item.id), ['imp-other']);
  assert.deepEqual(after.transactions.map((item) => item.id), ['tx-manual', 'tx-other']);
  assert.equal(after.transactions.find((item) => item.id === 'tx-other')?.importId, 'imp-other');
});

test('Delete all imported transactions blocks a linked pair with a manual counterpart', async () => {
  const stores = fixtureStores();
  addLinkedPair(stores, 'imp-a', undefined);
  const paths = makeDirectories(stores);
  const before = readBytes(paths.dataDirectory);
  const preview = await previewImportHistoryAction('ws1', 'delete_all_with_transactions', undefined, paths);
  assert.equal(preview.allowed, false);
  assert.equal(preview.blockedLinkedPairCount, 1);
  await assert.rejects(
    () => executeImportHistoryAction('ws1', 'delete_all_with_transactions', undefined, true, paths),
    (error: unknown) => error instanceof RestoreError && error.code === 'REFERENTIAL_INTEGRITY_FAILURE'
  );
  assertAllBytesEqual(before, paths.dataDirectory);
});

test('zero-linked deletion succeeds, explicit confirmation is required, and cross-workspace IDs are rejected', async () => {
  const paths = makeDirectories();
  await assert.rejects(
    () => executeImportHistoryAction('ws1', 'delete_with_transactions', 'imp-a', false, paths),
    (error: unknown) => error instanceof RestoreError && error.code === 'INVALID_OPERATION'
  );
  await assert.rejects(
    () => previewImportHistoryAction('ws1', 'delete_with_transactions', 'imp-other', paths),
    (error: unknown) => error instanceof RestoreError && error.code === 'INVALID_OPERATION'
  );
  const result = await executeImportHistoryAction('ws1', 'delete_with_transactions', 'imp-zero', true, paths);
  assert.equal(result.deletedTransactions, 0);
  assert.equal(readStores(paths.dataDirectory).imports.some((item) => item.id === 'imp-zero'), false);
});

test('an invalid current store set is rejected without mutation instead of being silently repaired', async () => {
  const stores = fixtureStores();
  stores.transactions[0].importId = 'missing-import';
  const paths = makeDirectories(stores);
  const before = readBytes(paths.dataDirectory);
  await assert.rejects(
    () => previewImportHistoryAction('ws1', 'delete_with_transactions', 'imp-a', paths),
    (error: unknown) => error instanceof RestoreError && error.code === 'DATA_OPERATION_FAILURE'
  );
  assertAllBytesEqual(before, paths.dataDirectory);
});

test('import-history reads use the shared global data lock', async () => {
  const paths = makeDirectories();
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const holder = withDataLock(async () => { entered(); await gate; });
  await enteredPromise;

  let resolved = false;
  const listing = listImportHistory('ws1', paths).then((value) => {
    resolved = true;
    return value;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(resolved, false);
  release();
  await holder;
  assert.equal((await listing).length, 2);
});

for (const [label, failureIndex] of [['first', 0], ['final', 1]] as const) {
  test(`${label}-store import-history replacement failure rolls back byte-equivalent originals`, async () => {
    const paths = makeDirectories();
    const before = readBytes(paths.dataDirectory);
    await assert.rejects(
      () => executeImportHistoryAction('ws1', 'delete_with_transactions', 'imp-a', true, {
        ...paths,
        hooks: { afterReplace: (_key, index) => {
          if (index === failureIndex) throw new Error(`Injected ${label} failure`);
        } },
      }),
      (error: unknown) => error instanceof RestoreError && error.code === 'DATA_OPERATION_FAILURE'
    );
    assertAllBytesEqual(before, paths.dataDirectory);
    assert.deepEqual(fs.existsSync(paths.operationsDirectory) ? fs.readdirSync(paths.operationsDirectory) : [], []);
  });
}

test('rollback failure preserves artifacts and unfinished import-history journal recovers safely', async () => {
  const paths = makeDirectories();
  const before = readBytes(paths.dataDirectory);
  await assert.rejects(
    () => executeImportHistoryAction('ws1', 'delete_with_transactions', 'imp-a', true, {
      ...paths,
      hooks: {
        afterReplace: (_key, index) => { if (index === 0) throw new Error('Injected replacement failure'); },
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

test('successful import-history operation cleans journals, snapshots, and staged files', async () => {
  const paths = makeDirectories();
  await executeImportHistoryAction('ws1', 'delete_with_transactions', 'imp-a', true, paths);
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

test('API list and preview return metadata/counts without transaction descriptions or mutation', async () => {
  const paths = makeDirectories();
  const before = readBytes(paths.dataDirectory);
  const listResponse = await withApiDirectories(paths, () => historyGet(
    new Request('http://localhost/api/data-management/import-history?workspaceId=ws1')
  ));
  assert.equal(listResponse.status, 200);
  const listBody = await listResponse.json();
  assert.equal(listBody.imports[0].linkedTransactionCount, 2);
  assert.equal('workspaceName' in listBody.imports[0], false);
  assert.equal(JSON.stringify(listBody).includes('Transaction tx-a'), false);

  const previewResponse = await withApiDirectories(paths, () => historyPreviewPost(jsonRequest(
    'http://localhost/api/data-management/import-history/preview',
    { workspaceId: 'ws1', action: 'delete_with_transactions', importId: 'imp-a' }
  )));
  assert.equal(previewResponse.status, 200);
  const previewBody = await previewResponse.json();
  assert.equal(previewBody.preview.transactionsToDelete, 2);
  assert.equal(JSON.stringify(previewBody).includes('Transaction tx-a'), false);
  assertAllBytesEqual(before, paths.dataDirectory);
});

test('API rejects removed actions, enforces confirmation, and applies a confirmed deletion', async () => {
  const paths = makeDirectories();
  for (const action of ['remove_history', 'remove_all_history']) {
    const removedAction = await withApiDirectories(paths, () => historyPreviewPost(jsonRequest(
      'http://localhost/api/data-management/import-history/preview',
      { workspaceId: 'ws1', action, importId: 'imp-a' }
    )));
    assert.equal(removedAction.status, 400);
    assert.equal((await removedAction.json()).error.code, 'INVALID_OPERATION');
  }
  const unconfirmed = await withApiDirectories(paths, () => historyPost(jsonRequest(
    'http://localhost/api/data-management/import-history',
    { workspaceId: 'ws1', action: 'delete_with_transactions', importId: 'imp-a', confirmed: false }
  )));
  assert.equal(unconfirmed.status, 400);
  const confirmed = await withApiDirectories(paths, () => historyPost(jsonRequest(
    'http://localhost/api/data-management/import-history',
    { workspaceId: 'ws1', action: 'delete_with_transactions', importId: 'imp-a', confirmed: true }
  )));
  assert.equal(confirmed.status, 200);
  assert.equal((await confirmed.json()).result.deletedTransactions, 2);
});

test('Activity backup/restore and every reset operation remain compatible', async () => {
  for (const operation of ['clear_activity', 'reset_financial', 'factory_reset'] as const) {
    const paths = makeDirectories();
    const backup = await createBackup('activity', { ...paths, now: () => new Date(now) });
    assert.deepEqual(backup.includedStores, ['imports', 'transactions']);
    await executeDataReset(operation, true, paths);
    if (operation === 'clear_activity') {
      await restoreBackup(JSON.stringify(backup), paths);
      const restored = readStores(paths.dataDirectory);
      assert.equal(restored.imports.length, 3);
      assert.equal(restored.transactions.length, 4);
    }
  }
});

test('Import History exposes only deletion actions with workspace-neutral copy', () => {
  assert.deepEqual(Object.keys(IMPORT_HISTORY_ACTION_OPTIONS), [
    'delete_with_transactions',
    'delete_all_with_transactions',
  ]);
  assert.equal(IMPORT_HISTORY_ACTION_OPTIONS.delete_with_transactions.allImports, false);
  assert.equal(IMPORT_HISTORY_ACTION_OPTIONS.delete_all_with_transactions.allImports, true);
  assert.equal(IMPORT_HISTORY_ACTION_OPTIONS.delete_all_with_transactions.label, 'Delete all imported transactions');
  assert.equal(IMPORT_HISTORY_ACTION_OPTIONS.delete_all_with_transactions.confirmation,
    'I understand that all imported transactions and their import sessions will be removed. Manual transactions will be preserved.');
  assert.equal(JSON.stringify(IMPORT_HISTORY_ACTION_OPTIONS).includes('workspace'), false);
});
