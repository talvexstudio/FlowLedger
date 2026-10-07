import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { POST as previewPost } from '@/app/api/data-management/workspaces/delete/preview/route';
import { POST as deletePost } from '@/app/api/data-management/workspaces/delete/route';
import { instantiateDefaultCategoryTemplate } from '../default-category-template';
import { applyWorkspaceDeletion } from '../workspace-client-state';
import { resolveQueuedWorkspaceDialog } from '../workspace-menu-state';
import { getWorkspaceSelectorLabel, resolveWorkspaceId } from '../workspace-selection';
import { canonicalizeStoreRecords, createBackup } from './backup';
import { executeDataReset } from './data-reset';
import { RestoreError } from './restore-errors';
import { recoverPendingRestores } from './restore-recovery';
import { PERSISTED_STORE_KEYS, PERSISTED_STORES, type PersistedStoreKey } from './store-manifest';
import {
  deleteWorkspace,
  LAST_WORKSPACE_DELETE_MESSAGE,
  previewWorkspaceDeletion,
  WorkspaceDeletionError,
} from './workspace-deletion';
import {
  canSubmitWorkspaceDeletion,
  workspaceDeletionBackupRequest,
} from './workspace-deletion-ui';

const roots: string[] = [];
const now = '2026-10-07T15:00:00.000Z';

test.after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const taxonomy = (workspaceId: string, prefix: string) => instantiateDefaultCategoryTemplate(workspaceId, {
  categoryId: (key) => `${prefix}-cat-${key}`,
  subcategoryId: (key, categoryKey) => `${prefix}-sub-${categoryKey}-${key}`,
}) as unknown as Record<string, unknown>[];

const fixtureStores = (): Record<PersistedStoreKey, Record<string, unknown>[]> => {
  const ws1Categories = taxonomy('ws1', 'personal');
  const ws2Categories = taxonomy('ws2', 'business');
  const ws1Category = ws1Categories[0];
  const ws2Category = ws2Categories[0];
  const ws1Subcategory = (ws1Category.subcategories as Record<string, unknown>[])[0];
  const ws2Subcategory = (ws2Category.subcategories as Record<string, unknown>[])[0];
  return {
    workspaces: [
      { id: 'ws1', ownerUserId: 'local', name: 'My Finances', baseCurrency: 'EUR', createdAt: now, updatedAt: now },
      { id: 'ws2', ownerUserId: 'local', name: 'Business', baseCurrency: 'GBP', createdAt: now, updatedAt: now },
    ],
    accounts: [
      { id: 'acc-ws1', workspaceId: 'ws1', name: 'Personal', type: 'bank', currency: 'EUR', institution: 'Bank', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
      { id: 'acc-ws2-a', workspaceId: 'ws2', name: 'Business A', type: 'bank', currency: 'GBP', institution: 'Bank', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
      { id: 'acc-ws2-b', workspaceId: 'ws2', name: 'Business B', type: 'bank', currency: 'GBP', institution: 'Bank', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
    ],
    categories: [...ws1Categories, ...ws2Categories],
    imports: [
      { id: 'imp-ws1', workspaceId: 'ws1', accountId: 'acc-ws1', fileName: 'personal.csv', sourceType: 'CSV', template: 'Manual', transactionCount: 1, createdAt: now },
      { id: 'imp-ws2', workspaceId: 'ws2', accountId: 'acc-ws2-a', fileName: 'business.csv', sourceType: 'CSV', template: 'Manual', transactionCount: 99, createdAt: now },
    ],
    importTemplates: [
      { id: 'tpl-ws1', workspaceId: 'ws1', name: 'Personal template', sourceType: 'CSV', headerSignature: ['Date'], mapping: { dateField: 'Date' }, defaultAccountId: 'acc-ws1', createdAt: now },
      { id: 'tpl-ws2', workspaceId: 'ws2', name: 'Business template', sourceType: 'CSV', headerSignature: ['Date'], mapping: { dateField: 'Date' }, defaultAccountId: 'acc-ws2-a', createdAt: now },
    ],
    budgets: [
      { id: 'budget-ws1', workspaceId: 'ws1', year: 2026, createdFromSampleMonths: 3, samplePeriodFrom: '2026-01', samplePeriodTo: '2026-12', createdAt: now },
      { id: 'budget-ws2', workspaceId: 'ws2', year: 2026, createdFromSampleMonths: 3, samplePeriodFrom: '2026-01', samplePeriodTo: '2026-12', createdAt: now },
    ],
    rules: [
      { id: 'rule-ws1', workspaceId: 'ws1', match: { descriptionContains: 'Personal' }, action: { categoryId: ws1Category.id, subcategoryId: ws1Subcategory.id }, createdAt: now },
      { id: 'rule-ws2', workspaceId: 'ws2', match: { descriptionContains: 'Business' }, action: { categoryId: ws2Category.id, subcategoryId: ws2Subcategory.id }, createdAt: now },
    ],
    transactions: [
      { id: 'tx-ws1', workspaceId: 'ws1', accountId: 'acc-ws1', date: '2026-10-01', description: 'Private personal transaction', amountOriginal: -10, currencyOriginal: 'EUR', amountBase: -10, type: 'Expense', categoryId: ws1Category.id, subcategoryId: ws1Subcategory.id, importId: 'imp-ws1', needsReview: false, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false, createdAt: now, updatedAt: now },
      { id: 'tx-ws2-out', workspaceId: 'ws2', accountId: 'acc-ws2-a', destinationAccountId: 'acc-ws2-b', linkedTransactionId: 'tx-ws2-in', internalDirection: 'Out', date: '2026-10-02', description: 'Private business transfer out', amountOriginal: -50, currencyOriginal: 'GBP', amountBase: -50, type: 'InternalTransfer', importId: 'imp-ws2', needsReview: false, isInternalTransfer: true, isPotentialDuplicate: false, isInconsistent: false, createdAt: now, updatedAt: now },
      { id: 'tx-ws2-in', workspaceId: 'ws2', accountId: 'acc-ws2-b', destinationAccountId: 'acc-ws2-a', linkedTransactionId: 'tx-ws2-out', internalDirection: 'In', date: '2026-10-02', description: 'Private business transfer in', amountOriginal: 50, currencyOriginal: 'GBP', amountBase: 50, type: 'InternalTransfer', importId: 'imp-ws2', needsReview: false, isInternalTransfer: true, isPotentialDuplicate: false, isInconsistent: false, createdAt: now, updatedAt: now },
    ],
  };
};

const makePaths = (stores = fixtureStores()) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-workspace-delete-'));
  roots.push(root);
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  fs.mkdirSync(dataDirectory, { recursive: true });
  for (const key of PERSISTED_STORE_KEYS) {
    fs.writeFileSync(path.join(dataDirectory, PERSISTED_STORES[key].filename), JSON.stringify(stores[key], null, 2));
  }
  return { dataDirectory, operationsDirectory };
};

const readStores = (dataDirectory: string) => Object.fromEntries(PERSISTED_STORE_KEYS.map((key) => [
  key,
  JSON.parse(fs.readFileSync(path.join(dataDirectory, PERSISTED_STORES[key].filename), 'utf-8')),
])) as Record<PersistedStoreKey, Record<string, unknown>[]>;

const readBytes = (dataDirectory: string) => Object.fromEntries(PERSISTED_STORE_KEYS.map((key) => [
  key,
  fs.readFileSync(path.join(dataDirectory, PERSISTED_STORES[key].filename)),
])) as Record<PersistedStoreKey, Buffer>;

const owned = (records: Record<string, unknown>[], workspaceId: string) =>
  records.filter((record) => record.workspaceId === workspaceId);

const withApiPaths = async <T>(paths: ReturnType<typeof makePaths>, task: () => Promise<T>) => {
  const oldData = process.env.FLOWLEDGER_DATA_DIR;
  const oldOperations = process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR;
  process.env.FLOWLEDGER_DATA_DIR = paths.dataDirectory;
  process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR = paths.operationsDirectory;
  try {
    return await task();
  } finally {
    if (oldData === undefined) delete process.env.FLOWLEDGER_DATA_DIR;
    else process.env.FLOWLEDGER_DATA_DIR = oldData;
    if (oldOperations === undefined) delete process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR;
    else process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR = oldOperations;
  }
};

const request = (url: string, workspaceId: string, confirmed?: boolean) => new Request(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ workspaceId, confirmDelete: confirmed }),
});

test('preview reports actual safe counts without exposing payloads or mutating stores', async () => {
  const paths = makePaths();
  const before = readBytes(paths.dataDirectory);
  const preview = await previewWorkspaceDeletion('ws2', paths);
  assert.equal(preview.workspaceName, 'Business');
  assert.equal(preview.workspaceBaseCurrency, 'GBP');
  assert.equal(preview.workspaceCountBefore, 2);
  assert.equal(preview.workspaceCountAfter, 1);
  assert.equal(preview.accountsCount, 2);
  assert.equal(preview.categoriesCount, 17);
  assert.equal(preview.subcategoriesCount, 60);
  assert.equal(preview.importsCount, 1);
  assert.equal(preview.importTemplatesCount, 1);
  assert.equal(preview.budgetsCount, 1);
  assert.equal(preview.rulesCount, 1);
  assert.equal(preview.transactionsCount, 2);
  assert.equal(preview.suggestedNextWorkspaceId, 'ws1');
  assert.equal(JSON.stringify(preview).includes('Private'), false);
  const after = readBytes(paths.dataDirectory);
  for (const key of PERSISTED_STORE_KEYS) assert.equal(after[key].equals(before[key]), true);
});

test('deletion removes every ws2-owned record and preserves ws1 including valid transfer deletion', async () => {
  const paths = makePaths();
  const before = readStores(paths.dataDirectory);
  const result = await deleteWorkspace('ws2', true, paths);
  const after = readStores(paths.dataDirectory);
  assert.equal(result.nextSelectedWorkspaceId, 'ws1');
  assert.deepEqual(after.workspaces.map((workspace) => workspace.id), ['ws1']);
  for (const key of ['accounts', 'categories', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions'] as const) {
    assert.equal(owned(after[key], 'ws2').length, 0);
    assert.deepEqual(
      canonicalizeStoreRecords(after[key]),
      canonicalizeStoreRecords(owned(before[key], 'ws1'))
    );
  }
  assert.deepEqual(fs.existsSync(paths.operationsDirectory) ? fs.readdirSync(paths.operationsDirectory) : [], []);
  assert.equal(fs.readdirSync(paths.dataDirectory).some((name) => name.includes('.stage') || name.includes('.tmp')), false);
});

test('last workspace preview blocks and execution rechecks the guard and confirmation', async () => {
  const stores = fixtureStores();
  stores.workspaces = stores.workspaces.filter((workspace) => workspace.id === 'ws1');
  for (const key of ['accounts', 'categories', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions'] as const) {
    stores[key] = owned(stores[key], 'ws1');
  }
  const paths = makePaths(stores);
  const preview = await previewWorkspaceDeletion('ws1', paths);
  assert.equal(preview.canDelete, false);
  assert.equal(preview.blockingReason, LAST_WORKSPACE_DELETE_MESSAGE);
  await assert.rejects(
    () => deleteWorkspace('ws1', true, paths),
    (error: unknown) => error instanceof WorkspaceDeletionError && error.code === 'LAST_WORKSPACE'
  );
  await assert.rejects(
    () => deleteWorkspace('ws1', false, paths),
    (error: unknown) => error instanceof WorkspaceDeletionError && error.code === 'INVALID_REQUEST'
  );
});

test('missing workspace is rejected and the first remaining workspace is deterministic', async () => {
  const paths = makePaths();
  await assert.rejects(
    () => previewWorkspaceDeletion('missing', paths),
    (error: unknown) => error instanceof WorkspaceDeletionError && error.status === 404
  );
  assert.equal((await previewWorkspaceDeletion('ws1', paths)).suggestedNextWorkspaceId, 'ws2');
});

test('legacy unscoped categories are deleted only with ws1', async () => {
  const deletingWs1 = fixtureStores();
  deletingWs1.categories = deletingWs1.categories.map((category) => {
    if (category.workspaceId !== 'ws1') return category;
    const legacy = structuredClone(category);
    delete legacy.workspaceId;
    legacy.subcategories = (legacy.subcategories as Record<string, unknown>[]).map((subcategory) => {
      const copy = { ...subcategory };
      delete copy.workspaceId;
      return copy;
    });
    return legacy;
  });
  const ws1Paths = makePaths(deletingWs1);
  assert.equal((await previewWorkspaceDeletion('ws1', ws1Paths)).categoriesCount, 17);
  await deleteWorkspace('ws1', true, ws1Paths);
  assert.equal(readStores(ws1Paths.dataDirectory).categories.some((category) => category.workspaceId === undefined), false);

  const ws2Paths = makePaths(deletingWs1);
  await deleteWorkspace('ws2', true, ws2Paths);
  assert.equal(readStores(ws2Paths.dataDirectory).categories.filter((category) => category.workspaceId === undefined).length, 17);
});

test('invalid cross-workspace references and linked pairs block before mutation', async () => {
  const cases = [
    (stores: ReturnType<typeof fixtureStores>) => {
      stores.importTemplates.find((record) => record.id === 'tpl-ws1')!.defaultAccountId = 'acc-ws2-a';
    },
    (stores: ReturnType<typeof fixtureStores>) => {
      stores.transactions.find((record) => record.id === 'tx-ws2-out')!.linkedTransactionId = 'tx-ws1';
    },
  ];
  for (const corrupt of cases) {
    const stores = fixtureStores();
    corrupt(stores);
    const paths = makePaths(stores);
    const before = readBytes(paths.dataDirectory);
    await assert.rejects(
      () => deleteWorkspace('ws2', true, paths),
      (error: unknown) => error instanceof RestoreError && error.code === 'DATA_OPERATION_FAILURE'
    );
    const after = readBytes(paths.dataDirectory);
    for (const key of PERSISTED_STORE_KEYS) assert.equal(after[key].equals(before[key]), true);
  }
});

test('replacement failure rolls all stores back byte-for-byte', async () => {
  const paths = makePaths();
  const before = readBytes(paths.dataDirectory);
  await assert.rejects(
    () => deleteWorkspace('ws2', true, {
      ...paths,
      hooks: { afterReplace: (_key, index) => {
        if (index === 4) throw new Error('Injected replacement failure');
      } },
    }),
    (error: unknown) => error instanceof RestoreError && error.code === 'DATA_OPERATION_FAILURE'
  );
  const after = readBytes(paths.dataDirectory);
  for (const key of PERSISTED_STORE_KEYS) assert.equal(after[key].equals(before[key]), true);
});

test('rollback failure preserves recovery artifacts and standard recovery restores originals', async () => {
  const paths = makePaths();
  const before = readBytes(paths.dataDirectory);
  await assert.rejects(
    () => deleteWorkspace('ws2', true, {
      ...paths,
      hooks: {
        afterReplace: (_key, index) => { if (index === 3) throw new Error('Injected failure'); },
        beforeRollback: () => { throw new Error('Injected rollback failure'); },
      },
    }),
    (error: unknown) => error instanceof RestoreError && error.code === 'ROLLBACK_FAILURE'
  );
  assert.ok(fs.readdirSync(paths.operationsDirectory).length > 0);
  await recoverPendingRestores(paths);
  const after = readBytes(paths.dataDirectory);
  for (const key of PERSISTED_STORE_KEYS) assert.equal(after[key].equals(before[key]), true);
  assert.deepEqual(fs.readdirSync(paths.operationsDirectory), []);
});

test('preview and execution APIs are structured, safe, and confirmation-protected', async () => {
  const paths = makePaths();
  const previewResponse = await withApiPaths(paths, () => previewPost(
    request('http://localhost/api/data-management/workspaces/delete/preview', 'ws2')
  ));
  assert.equal(previewResponse.status, 200);
  const previewBody = await previewResponse.json();
  assert.equal(previewBody.preview.transactionsCount, 2);
  assert.equal(JSON.stringify(previewBody).includes('Private'), false);

  const denied = await withApiPaths(paths, () => deletePost(
    request('http://localhost/api/data-management/workspaces/delete', 'ws2', false)
  ));
  assert.equal(denied.status, 400);
  assert.equal((await denied.json()).error.code, 'INVALID_REQUEST');

  const response = await withApiPaths(paths, () => deletePost(
    request('http://localhost/api/data-management/workspaces/delete', 'ws2', true)
  ));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.deletedWorkspaceId, 'ws2');
});

test('client transition removes deleted selection, persists a valid next ID, and preserves non-target selection', () => {
  const workspaces = fixtureStores().workspaces.map((record) => ({
    ...record,
    createdAt: new Date(record.createdAt as string),
    updatedAt: new Date(record.updatedAt as string),
  })) as any;
  const result = { deletedWorkspaceId: 'ws2', nextSelectedWorkspaceId: 'ws1' };
  assert.deepEqual(applyWorkspaceDeletion(workspaces, 'ws2', result), {
    workspaces: [workspaces[0]], selectedWorkspaceId: 'ws1', selectionChanged: true,
  });
  assert.deepEqual(applyWorkspaceDeletion(workspaces, 'ws1', result), {
    workspaces: [workspaces[0]], selectedWorkspaceId: 'ws1', selectionChanged: false,
  });

  const deletedSelection = applyWorkspaceDeletion(workspaces, 'ws2', result);
  assert.equal(resolveWorkspaceId(deletedSelection.workspaces, deletedSelection.selectedWorkspaceId), 'ws1');
  assert.equal(
    getWorkspaceSelectorLabel(deletedSelection.workspaces, deletedSelection.selectedWorkspaceId, false),
    'My Finances'
  );
});

test('workspace dialogs wait for the dropdown to close before mounting', () => {
  for (const action of ['create', 'rename', 'delete'] as const) {
    assert.equal(resolveQueuedWorkspaceDialog(true, action), null);
    assert.equal(resolveQueuedWorkspaceDialog(false, action), action);
  }
  assert.equal(resolveQueuedWorkspaceDialog(false, null), null);
});

test('delete UI helpers require preview confirmation and target Financial Data for the deleted workspace', async () => {
  const paths = makePaths();
  const preview = await previewWorkspaceDeletion('ws2', paths);
  assert.equal(canSubmitWorkspaceDeletion(preview, false, false), false);
  assert.equal(canSubmitWorkspaceDeletion(preview, true, false), true);
  assert.equal(canSubmitWorkspaceDeletion(preview, true, true), false);
  assert.deepEqual(workspaceDeletionBackupRequest('ws2'), {
    scope: 'financial_data', workspaceId: 'ws2',
  });
  const backup = await createBackup('financial_data', { ...paths, workspaceId: 'ws2' });
  assert.equal(backup.workspaceSelection.mode, 'selected');
  assert.deepEqual(backup.workspaceSelection.ids, ['ws2']);
});

test('Factory Reset semantics remain available independently of workspace deletion', async () => {
  const paths = makePaths();
  await executeDataReset('factory_reset', true, paths);
  const stores = readStores(paths.dataDirectory);
  assert.deepEqual(stores.workspaces.map((workspace) => workspace.id), ['ws1']);
});
