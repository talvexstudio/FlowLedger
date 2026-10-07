import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { POST as restorePreviewPost } from '@/app/api/data-management/restore/preview/route';
import { POST as restorePost } from '@/app/api/data-management/restore/route';
import {
  calculateStoreChecksum,
  canonicalizeStoreRecords,
  createBackup,
  type FlowLedgerBackup,
} from './backup';
import { executeDataReset, previewDataReset } from './data-reset';
import { instantiateDefaultCategoryTemplate } from '../default-category-template';
import { previewRestore, restoreBackup } from './restore';
import { RestoreError } from './restore-errors';
import { PERSISTED_STORE_KEYS, PERSISTED_STORES, type PersistedStoreKey } from './store-manifest';
import {
  backupScopeDescription,
  canUseBackupScope,
  canUseDataReset,
  dataResetTargetLabel,
} from './ui-copy';

const roots: string[] = [];
const now = '2026-10-07T12:00:00.000Z';

test.after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const taxonomy = (workspaceId: string, prefix: string) => instantiateDefaultCategoryTemplate(workspaceId, {
  categoryId: (key) => `${prefix}-cat-${key}`,
  subcategoryId: (key, categoryKey) => `${prefix}-sub-${categoryKey}-${key}`,
}) as unknown as Record<string, unknown>[];

const multiWorkspaceStores = (marker = 'source'): Record<PersistedStoreKey, Record<string, unknown>[]> => {
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
      { id: 'acc-ws1', workspaceId: 'ws1', name: `Personal ${marker}`, type: 'bank', currency: 'EUR', institution: 'Bank', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
      { id: 'acc-ws2', workspaceId: 'ws2', name: `Business ${marker}`, type: 'bank', currency: 'GBP', institution: 'Bank', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
    ],
    categories: [...ws1Categories, ...ws2Categories],
    imports: [
      { id: `imp-ws1-${marker}`, workspaceId: 'ws1', accountId: 'acc-ws1', createdAt: now, fileName: 'personal.csv', sourceType: 'CSV', template: 'Manual', transactionCount: 1 },
      { id: `imp-ws2-${marker}`, workspaceId: 'ws2', accountId: 'acc-ws2', createdAt: now, fileName: 'business.csv', sourceType: 'CSV', template: 'Manual', transactionCount: 1 },
    ],
    importTemplates: [
      { id: 'tpl-ws1', workspaceId: 'ws1', name: `Personal ${marker}`, sourceType: 'CSV', headerSignature: ['Date'], mapping: { dateField: 'Date', descriptionField: 'Description', amountField: 'Amount' }, defaultAccountId: 'acc-ws1', createdAt: now, updatedAt: now },
      { id: 'tpl-ws2', workspaceId: 'ws2', name: `Business ${marker}`, sourceType: 'CSV', headerSignature: ['Date'], mapping: { dateField: 'Date', descriptionField: 'Description', amountField: 'Amount' }, defaultAccountId: 'acc-ws2', createdAt: now, updatedAt: now },
    ],
    budgets: [
      { id: 'budget-ws1', workspaceId: 'ws1', year: 2026, createdFromSampleMonths: 3, samplePeriodFrom: '2026-01', samplePeriodTo: '2026-12', createdAt: now, updatedAt: now },
      { id: 'budget-ws2', workspaceId: 'ws2', year: 2026, createdFromSampleMonths: 3, samplePeriodFrom: '2026-01', samplePeriodTo: '2026-12', createdAt: now, updatedAt: now },
    ],
    rules: [
      { id: 'rule-ws1', workspaceId: 'ws1', match: { descriptionContains: 'Personal' }, action: { categoryId: ws1Category.id, subcategoryId: ws1Subcategory.id, type: 'Expense' }, createdAt: now, updatedAt: now },
      { id: 'rule-ws2', workspaceId: 'ws2', match: { descriptionContains: 'Business' }, action: { categoryId: ws2Category.id, subcategoryId: ws2Subcategory.id, type: 'Expense' }, createdAt: now, updatedAt: now },
    ],
    transactions: [
      { id: `tx-ws1-${marker}`, workspaceId: 'ws1', accountId: 'acc-ws1', date: '2026-10-01', description: `Personal ${marker}`, rawDescription: 'PERSONAL', amountOriginal: -10, currencyOriginal: 'EUR', amountBase: -10, type: 'Expense', categoryId: ws1Category.id, subcategoryId: ws1Subcategory.id, importId: `imp-ws1-${marker}`, needsReview: false, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false, createdAt: now, updatedAt: now },
      { id: `tx-ws2-${marker}`, workspaceId: 'ws2', accountId: 'acc-ws2', date: '2026-10-02', description: `Business ${marker}`, rawDescription: 'BUSINESS', amountOriginal: -20, currencyOriginal: 'GBP', amountBase: -20, type: 'Expense', categoryId: ws2Category.id, subcategoryId: ws2Subcategory.id, importId: `imp-ws2-${marker}`, needsReview: false, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false, createdAt: now, updatedAt: now },
    ],
  };
};

const makePaths = (stores = multiWorkspaceStores()) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-workspace-data-'));
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

const workspaceRecords = (records: Record<string, unknown>[], workspaceId: string) =>
  records.filter((record) => record.workspaceId === workspaceId);

const assertSameRecords = (
  actual: Record<string, unknown>[],
  expected: Record<string, unknown>[]
) => assert.deepEqual(canonicalizeStoreRecords(actual), canonicalizeStoreRecords(expected));

const makeBackup = async (scope: 'activity' | 'financial_data' | 'everything', workspaceId?: string, marker = 'source') => {
  const paths = makePaths(multiWorkspaceStores(marker));
  return createBackup(scope, { ...paths, workspaceId, now: () => new Date(now) });
};

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

const restoreRequest = (json: string, execute = false) => {
  const form = new FormData();
  form.append('file', new File([json], 'workspace-backup.json', { type: 'application/json' }));
  if (execute) {
    form.append('confirmReplaceAll', 'true');
    form.append('recreateMissingWorkspace', 'true');
    form.append('recreatedWorkspaceName', 'API Recreated');
  }
  return new Request('http://localhost/api/data-management/restore', { method: 'POST', body: form });
};

test('Activity and Financial Data exports contain only the selected workspace with recreation metadata', async () => {
  for (const workspaceId of ['ws1', 'ws2']) {
    const activity = await makeBackup('activity', workspaceId);
    assert.deepEqual(activity.data.imports?.map((record) => record.workspaceId), [workspaceId]);
    assert.deepEqual(activity.data.transactions?.map((record) => record.workspaceId), [workspaceId]);
    assert.deepEqual(activity.workspaceSelection, {
      mode: 'selected',
      ids: [workspaceId],
      sourceWorkspaceId: workspaceId,
      sourceWorkspaceName: workspaceId === 'ws1' ? 'My Finances' : 'Business',
      sourceWorkspaceBaseCurrency: workspaceId === 'ws1' ? 'EUR' : 'GBP',
    });

    const financial = await makeBackup('financial_data', workspaceId);
    for (const key of financial.includedStores) {
      assert.ok(financial.data[key]!.every((record) => record.workspaceId === workspaceId));
    }
  }
});

test('Everything remains global and scoped backup requires a selected workspace', async () => {
  const everything = await makeBackup('everything');
  assert.deepEqual(everything.data.workspaces?.map((record) => record.id), ['ws1', 'ws2']);
  assert.equal(everything.data.transactions?.length, 2);
  assert.deepEqual(everything.workspaceSelection, { mode: 'all', ids: ['ws1', 'ws2'] });
  const paths = makePaths();
  await assert.rejects(() => createBackup('activity', paths), /Select a workspace/);
  await assert.rejects(() => createBackup('financial_data', paths), /Select a workspace/);
});

test('Activity restore replaces only source activity and preserves both setup and the other workspace', async () => {
  const backup = await makeBackup('activity', 'ws1', 'restored');
  const paths = makePaths(multiWorkspaceStores('current'));
  const before = readStores(paths.dataDirectory);
  await restoreBackup(JSON.stringify(backup), paths);
  const after = readStores(paths.dataDirectory);
  assert.deepEqual(workspaceRecords(after.imports, 'ws1'), backup.data.imports);
  assert.deepEqual(workspaceRecords(after.transactions, 'ws1'), backup.data.transactions);
  assert.deepEqual(workspaceRecords(after.imports, 'ws2'), workspaceRecords(before.imports, 'ws2'));
  assert.deepEqual(workspaceRecords(after.transactions, 'ws2'), workspaceRecords(before.transactions, 'ws2'));
  for (const key of ['accounts', 'categories', 'importTemplates', 'budgets', 'rules'] as const) {
    assert.deepEqual(after[key], before[key]);
  }
});

test('Financial Data restore replaces only source records and preserves workspace identity and ws2', async () => {
  const backup = await makeBackup('financial_data', 'ws1', 'restored');
  const paths = makePaths(multiWorkspaceStores('current'));
  const before = readStores(paths.dataDirectory);
  await restoreBackup(JSON.stringify(backup), paths);
  const after = readStores(paths.dataDirectory);
  assert.deepEqual(after.workspaces, before.workspaces);
  for (const key of ['accounts', 'categories', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions'] as const) {
    assertSameRecords(workspaceRecords(after[key], 'ws1'), backup.data[key] as Record<string, unknown>[]);
    assertSameRecords(workspaceRecords(after[key], 'ws2'), workspaceRecords(before[key], 'ws2'));
  }
});

test('missing Financial Data source previews recreation and recreates original ID, name, and currency atomically', async () => {
  const backup = await makeBackup('financial_data', 'ws1', 'restored');
  const current = multiWorkspaceStores('current');
  current.workspaces = current.workspaces.filter((workspace) => workspace.id !== 'ws1');
  for (const key of ['accounts', 'categories', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions'] as const) {
    current[key] = workspaceRecords(current[key], 'ws2');
  }
  const paths = makePaths(current);
  const preview = await previewRestore(JSON.stringify(backup), paths);
  assert.equal(preview.workspaceStatus, 'missing');
  assert.equal(preview.canRestore, false);
  assert.equal(preview.canRecreateWorkspace, true);
  assert.equal(preview.sourceWorkspaceName, 'My Finances');

  const result = await restoreBackup(JSON.stringify(backup), {
    ...paths,
    recreateMissingWorkspace: true,
    recreatedWorkspaceName: 'Restored Personal',
  });
  assert.equal(result.recreatedWorkspaceId, 'ws1');
  const restored = readStores(paths.dataDirectory);
  const workspace = restored.workspaces.find((record) => record.id === 'ws1')!;
  assert.equal(workspace.name, 'Restored Personal');
  assert.equal(workspace.baseCurrency, 'EUR');
  assert.equal(workspaceRecords(restored.transactions, 'ws1').length, 1);
  assert.equal(workspaceRecords(restored.transactions, 'ws2').length, 1);
});

test('recreation blocks ID conflicts and backups missing required workspace metadata', async () => {
  const backup = await makeBackup('financial_data', 'ws1');
  const paths = makePaths();
  await assert.rejects(
    () => restoreBackup(JSON.stringify(backup), { ...paths, recreateMissingWorkspace: true }),
    (error: unknown) => error instanceof RestoreError && error.code === 'WORKSPACE_ID_CONFLICT'
  );

  const malformed = structuredClone(backup) as FlowLedgerBackup;
  if (malformed.workspaceSelection.mode === 'selected') {
    delete (malformed.workspaceSelection as unknown as Record<string, unknown>).sourceWorkspaceBaseCurrency;
  }
  await assert.rejects(
    () => previewRestore(JSON.stringify(malformed), paths),
    (error: unknown) => error instanceof RestoreError && error.code === 'INVALID_BACKUP'
  );
});

test('restore APIs preview and execute explicit missing-workspace recreation', async () => {
  const backup = await makeBackup('financial_data', 'ws1', 'api-restored');
  const current = multiWorkspaceStores('current');
  current.workspaces = current.workspaces.filter((workspace) => workspace.id !== 'ws1');
  for (const key of ['accounts', 'categories', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions'] as const) {
    current[key] = workspaceRecords(current[key], 'ws2');
  }
  const paths = makePaths(current);
  const previewResponse = await withApiPaths(paths, () => restorePreviewPost(restoreRequest(JSON.stringify(backup))));
  assert.equal(previewResponse.status, 200);
  const previewBody = await previewResponse.json();
  assert.equal(previewBody.preview.workspaceStatus, 'missing');
  assert.equal(previewBody.preview.canRecreateWorkspace, true);

  const restoreResponse = await withApiPaths(paths, () => restorePost(restoreRequest(JSON.stringify(backup), true)));
  assert.equal(restoreResponse.status, 200);
  assert.equal((await restoreResponse.json()).result.recreatedWorkspaceId, 'ws1');
  assert.equal(readStores(paths.dataDirectory).workspaces.find((workspace) => workspace.id === 'ws1')?.name, 'API Recreated');
});

test('missing Activity workspace reports when omitted setup makes safe recreation impossible', async () => {
  const backup = await makeBackup('activity', 'ws1');
  const current = multiWorkspaceStores('current');
  current.workspaces = current.workspaces.filter((workspace) => workspace.id !== 'ws1');
  for (const key of ['accounts', 'categories', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions'] as const) {
    current[key] = workspaceRecords(current[key], 'ws2');
  }
  const paths = makePaths(current);
  const preview = await previewRestore(JSON.stringify(backup), paths);
  assert.equal(preview.workspaceStatus, 'missing');
  assert.equal(preview.canRecreateWorkspace, false);
  assert.match(preview.recreationBlockReason ?? '', /cannot be recreated safely/i);
});

test('pre-workspace mode-all scoped backups retain global replacement semantics', async () => {
  const backup = await makeBackup('activity', 'ws1', 'legacy') as FlowLedgerBackup;
  backup.workspaceSelection = { mode: 'all', ids: ['ws1'] };
  const paths = makePaths(multiWorkspaceStores('current'));
  const preview = await previewRestore(JSON.stringify(backup), paths);
  assert.equal(preview.isLegacy, true);
  assert.equal(preview.scopeLabel, 'Legacy global Activity');
  await restoreBackup(JSON.stringify(backup), paths);
  const restored = readStores(paths.dataDirectory);
  assert.equal(workspaceRecords(restored.transactions, 'ws2').length, 0);
  assert.deepEqual(restored.transactions, backup.data.transactions);
});

test('Clear Activity affects only the selected workspace and preview uses local counts', async () => {
  const paths = makePaths();
  const preview = await previewDataReset('clear_activity', { ...paths, workspaceId: 'ws2' });
  assert.equal(preview.workspaceName, 'Business');
  assert.equal(preview.currentCounts.transactions, 1);
  assert.equal(preview.workspaceMode, 'selected');
  await executeDataReset('clear_activity', true, { ...paths, workspaceId: 'ws2' });
  const stores = readStores(paths.dataDirectory);
  assert.equal(workspaceRecords(stores.transactions, 'ws2').length, 0);
  assert.equal(workspaceRecords(stores.imports, 'ws2').length, 0);
  assert.equal(workspaceRecords(stores.transactions, 'ws1').length, 1);
  assert.equal(workspaceRecords(stores.accounts, 'ws2').length, 1);
});

test('Reset Financial Data preserves selected workspace identity and all other workspace records', async () => {
  const paths = makePaths();
  const before = readStores(paths.dataDirectory);
  await executeDataReset('reset_financial', true, {
    ...paths,
    workspaceId: 'ws2',
    categoryIdFactory: {
      categoryId: (key) => `reset-cat-${key}`,
      subcategoryId: (key, categoryKey) => `reset-sub-${categoryKey}-${key}`,
    },
  });
  const after = readStores(paths.dataDirectory);
  assert.deepEqual(after.workspaces, before.workspaces);
  for (const key of ['accounts', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions'] as const) {
    assert.equal(workspaceRecords(after[key], 'ws2').length, 0);
    assertSameRecords(workspaceRecords(after[key], 'ws1'), workspaceRecords(before[key], 'ws1'));
  }
  const resetCategories = workspaceRecords(after.categories, 'ws2');
  assert.equal(resetCategories.length, 17);
  assert.ok(resetCategories.every((category) => String(category.id).startsWith('reset-cat-')));
  assertSameRecords(workspaceRecords(after.categories, 'ws1'), workspaceRecords(before.categories, 'ws1'));
});

test('Factory Reset remains global and deterministic', async () => {
  const paths = makePaths();
  await executeDataReset('factory_reset', true, paths);
  const stores = readStores(paths.dataDirectory);
  assert.deepEqual(stores.workspaces.map((workspace) => workspace.id), ['ws1']);
  assert.equal(stores.categories.length, 17);
  for (const key of ['accounts', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions'] as const) {
    assert.deepEqual(stores[key], []);
  }
});

test('scoped reset requires a workspace while global operations remain available', async () => {
  const paths = makePaths();
  await assert.rejects(() => previewDataReset('clear_activity', paths), /Select a workspace/);
  await assert.rejects(() => previewDataReset('reset_financial', paths), /Select a workspace/);
  assert.equal((await previewDataReset('factory_reset', paths)).workspaceMode, 'all');
  const everything = await createBackup('everything', paths);
  assert.equal(everything.workspaceSelection.mode, 'all');
});

test('selected backup checksums remain based on exact scoped payload', async () => {
  const backup = await makeBackup('financial_data', 'ws2');
  for (const entry of backup.storeManifest) {
    const records = canonicalizeStoreRecords(backup.data[entry.key] as Record<string, unknown>[]);
    assert.equal(entry.recordCount, records.length);
    assert.equal(entry.sha256, calculateStoreChecksum(records));
  }
});

test('UI scope helpers disable workspace operations without selection and name their impact', () => {
  assert.equal(canUseBackupScope('activity', null), false);
  assert.equal(canUseBackupScope('financial_data', null), false);
  assert.equal(canUseBackupScope('everything', null), true);
  assert.equal(canUseDataReset('clear_activity', null), false);
  assert.equal(canUseDataReset('reset_financial', null), false);
  assert.equal(canUseDataReset('factory_reset', null), true);
  assert.equal(backupScopeDescription('activity', 'Business'), 'Transactions and import history in Business');
  assert.match(backupScopeDescription('financial_data', 'Business'), /in Business$/);
  assert.equal(dataResetTargetLabel('clear_activity', 'Business'), 'Current workspace: Business');
  assert.equal(dataResetTargetLabel('factory_reset'), 'All workspaces');
});
