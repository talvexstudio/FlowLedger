import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { POST as previewPost } from '@/app/api/data-management/restore/preview/route';
import { POST as restorePost } from '@/app/api/data-management/restore/route';
import {
  calculateStoreChecksum,
  canonicalizeStoreRecords,
  createBackup,
  type FlowLedgerBackup,
} from './backup';
import { DEFAULT_SYSTEM_CATEGORIES, DEFAULT_WORKSPACES } from './default-data';
import { RestoreError, type RestoreErrorCode } from './restore-errors';
import {
  getDataManagementPaths,
  recoverPendingRestores,
  writeRestoreJournal,
  type RestoreJournal,
} from './restore-recovery';
import { previewRestore, RESTORE_WRITE_ORDER, restoreBackup } from './restore';
import { parseAndValidateRestoreBackup, validateRestoreBackup } from './restore-validation';
import {
  BACKUP_SCOPE_STORES,
  LEGACY_FINANCIAL_ACTIVITY_STORES,
  PERSISTED_STORE_KEYS,
  PERSISTED_STORES,
  type BackupScope,
  type PersistedStoreKey,
} from './store-manifest';

const temporaryRoots: string[] = [];
const now = '2026-10-05T12:00:00.000Z';

const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-restore-'));
  temporaryRoots.push(root);
  return root;
};

test.after(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
});

const transaction = (overrides: Record<string, unknown> = {}) => ({
  id: 'tx-a', workspaceId: 'ws1', accountId: 'acc-a', date: '2026-10-01',
  description: 'SECRET RESTORE DESCRIPTION', rawDescription: 'SECRET RAW',
  amountOriginal: -10, currencyOriginal: 'EUR', amountBase: -10, type: 'Expense',
  categoryId: 'cat_restaurants', subcategoryId: 'sub_cafes', importId: 'imp-a',
  needsReview: false, isInternalTransfer: false, isPotentialDuplicate: false,
  isInconsistent: false, createdAt: now, updatedAt: now, ...overrides,
});

const fixtureStores = (label = 'Source'): Record<PersistedStoreKey, Record<string, unknown>[]> => ({
  workspaces: structuredClone(DEFAULT_WORKSPACES).map((workspace) => ({ ...workspace, name: `${label} Workspace` })),
  accounts: [{
    id: 'acc-a', workspaceId: 'ws1', name: `${label} Account`, type: 'bank', currency: 'EUR',
    institution: 'Bank', openingBalance: 10, archived: false, createdAt: now, updatedAt: now,
  }, {
    id: 'acc-b', workspaceId: 'ws1', name: `${label} Counterpart`, type: 'cash', currency: 'EUR',
    institution: 'Cash', openingBalance: 0, archived: false, createdAt: now, updatedAt: now,
  }],
  categories: structuredClone(DEFAULT_SYSTEM_CATEGORIES) as Record<string, unknown>[],
  imports: [{
    id: 'imp-a', workspaceId: 'ws1', accountId: 'acc-a', createdAt: now,
    fileName: 'statement.csv', sourceType: 'CSV', template: 'Manual mapping', transactionCount: 1,
    updatedAt: now,
  }],
  importTemplates: [{
    id: 'tpl-a', workspaceId: 'ws1', name: `${label} Template`, sourceType: 'CSV',
    headerSignature: ['Date', 'Description', 'Amount'],
    mapping: { dateField: 'Date', descriptionField: 'Description', amountField: 'Amount' },
    defaultAccountId: 'acc-a', createdAt: now, updatedAt: now,
  }],
  budgets: [{
    id: 'budget-a', workspaceId: 'ws1', year: 2026, createdFromSampleMonths: 3,
    samplePeriodFrom: '2026-01', samplePeriodTo: '2026-12', createdAt: now, updatedAt: now,
  }, {
    id: 'budget-line-a', recordType: 'line', workspaceId: 'ws1', year: 2026,
    budgetId: 'budget-a', type: 'Expense', categoryId: 'cat_restaurants',
    subcategoryId: 'sub_cafes', userAdjustedMonthly: 100, createdAt: now, updatedAt: now,
  }],
  rules: [{
    id: 'rule-a', workspaceId: 'ws1', match: { descriptionContains: 'Coffee', accountId: 'acc-a' },
    action: { categoryId: 'cat_restaurants', subcategoryId: 'sub_cafes', type: 'Expense' },
    createdFromTransactionId: 'legacy-soft-reference', createdAt: now, updatedAt: now,
  }],
  transactions: [transaction()],
});

const linkedFixtureStores = () => {
  const stores = fixtureStores();
  stores.transactions = [
    transaction({
      id: 'tx-out', accountId: 'acc-a', amountOriginal: -50, amountBase: -50,
      type: 'InternalTransfer', categoryId: undefined, subcategoryId: undefined,
      isInternalTransfer: true, internalDirection: 'Out', destinationAccountId: 'acc-b',
      linkedTransactionId: 'tx-in',
    }),
    transaction({
      id: 'tx-in', accountId: 'acc-b', amountOriginal: 50, amountBase: 50,
      type: 'InternalTransfer', categoryId: undefined, subcategoryId: undefined,
      isInternalTransfer: true, internalDirection: 'In', destinationAccountId: 'acc-a',
      linkedTransactionId: 'tx-out',
    }),
  ];
  stores.imports[0].transactionCount = 2;
  return stores;
};

const writeStores = (directory: string, stores: Record<PersistedStoreKey, Record<string, unknown>[]>) => {
  fs.mkdirSync(directory, { recursive: true });
  for (const key of PERSISTED_STORE_KEYS) {
    fs.writeFileSync(path.join(directory, PERSISTED_STORES[key].filename), JSON.stringify(stores[key], null, 2), 'utf-8');
  }
};

const readStores = (directory: string) => Object.fromEntries(
  PERSISTED_STORE_KEYS.map((key) => [
    key,
    JSON.parse(fs.readFileSync(path.join(directory, PERSISTED_STORES[key].filename), 'utf-8')),
  ])
) as Record<PersistedStoreKey, Record<string, unknown>[]>;

const readStoreBytes = (directory: string) => Object.fromEntries(
  PERSISTED_STORE_KEYS.map((key) => [
    key,
    fs.readFileSync(path.join(directory, PERSISTED_STORES[key].filename)),
  ])
) as Record<PersistedStoreKey, Buffer>;

const createFixtureBackup = async (
  scope: BackupScope = 'everything',
  stores = fixtureStores()
) => {
  const root = makeRoot();
  const source = path.join(root, 'source');
  const operations = path.join(root, 'source-operations');
  writeStores(source, stores);
  return createBackup(scope, {
    dataDirectory: source,
    operationsDirectory: operations,
    workspaceId: scope === 'everything' ? undefined : 'ws1',
    now: () => new Date(now),
  });
};

const createLegacyFixtureBackup = async (stores = fixtureStores()) => {
  const complete = await createFixtureBackup('everything', stores);
  return {
    ...complete,
    scope: 'financial_activity' as const,
    includedStores: [...LEGACY_FINANCIAL_ACTIVITY_STORES],
    storeManifest: complete.storeManifest.filter((entry) =>
      LEGACY_FINANCIAL_ACTIVITY_STORES.includes(entry.key as typeof LEGACY_FINANCIAL_ACTIVITY_STORES[number])
    ),
    data: Object.fromEntries(LEGACY_FINANCIAL_ACTIVITY_STORES.map((key) => [key, complete.data[key]])),
  };
};

const cloneBackup = (backup: FlowLedgerBackup) => structuredClone(backup) as FlowLedgerBackup;

const refreshStoreManifest = (backup: FlowLedgerBackup, key: PersistedStoreKey) => {
  const records = canonicalizeStoreRecords(backup.data[key] as Record<string, unknown>[]);
  backup.data[key] = records;
  const entry = backup.storeManifest.find((candidate) => candidate.key === key)!;
  entry.recordCount = records.length;
  entry.sha256 = calculateStoreChecksum(records);
};

const expectCode = async (operation: () => unknown | Promise<unknown>, code: RestoreErrorCode) => {
  await assert.rejects(
    async () => { await operation(); },
    (error: unknown) => error instanceof RestoreError && error.code === code
  );
};

const backupJson = (backup: unknown) => JSON.stringify(backup);

test('everything, scoped, and legacy backups produce accurate metadata-only previews', async () => {
  const everything = await createFixtureBackup('everything');
  const everythingPreview = await previewRestore(backupJson(everything), {
    dataDirectory: makeRoot(), operationsDirectory: makeRoot(),
  });
  assert.equal(everythingPreview.scope, 'everything');
  assert.equal(everythingPreview.counts.transactions, 1);
  assert.deepEqual(everythingPreview.includedStores, [...BACKUP_SCOPE_STORES.everything]);
  assert.deepEqual(everythingPreview.storesToClear, []);
  assert.equal(JSON.stringify(everythingPreview).includes('SECRET RESTORE DESCRIPTION'), false);

  const currentRoot = makeRoot();
  const currentData = path.join(currentRoot, 'data');
  const currentOperations = path.join(currentRoot, 'operations');
  writeStores(currentData, fixtureStores('Current'));

  const activity = await createFixtureBackup('activity');
  const activityPreview = await previewRestore(backupJson(activity), {
    dataDirectory: currentData, operationsDirectory: currentOperations,
  });
  assert.equal(activityPreview.scope, 'activity');
  assert.equal(activityPreview.scopeLabel, 'Activity');
  assert.deepEqual(activityPreview.includedStores, [...BACKUP_SCOPE_STORES.activity]);
  assert.deepEqual(activityPreview.preservedStores, ['workspaces', 'accounts', 'categories', 'importTemplates', 'budgets', 'rules']);
  assert.deepEqual(activityPreview.storesToClear, []);

  const financial = await createFixtureBackup('financial_data');
  const financialPreview = await previewRestore(backupJson(financial), {
    dataDirectory: currentData, operationsDirectory: currentOperations,
  });
  assert.equal(financialPreview.scopeLabel, 'Financial Data');
  assert.deepEqual(financialPreview.preservedStores, ['workspaces']);

  const legacy = await createLegacyFixtureBackup();
  const legacyPreview = await previewRestore(backupJson(legacy), {
    dataDirectory: makeRoot(), operationsDirectory: makeRoot(),
  });
  assert.equal(legacyPreview.scope, 'financial_activity');
  assert.equal(legacyPreview.scopeLabel, 'Legacy Financial activity');
  assert.equal(legacyPreview.isLegacy, true);
  assert.deepEqual(legacyPreview.includedStores, [...LEGACY_FINANCIAL_ACTIVITY_STORES]);
  assert.deepEqual(legacyPreview.storesToClear, ['importTemplates', 'budgets', 'rules']);
  assert.equal(JSON.stringify(legacyPreview).includes('SECRET RESTORE DESCRIPTION'), false);
});

test('malformed JSON, malformed metadata, and unknown scope are blocked', async () => {
  await expectCode(() => Promise.resolve(parseAndValidateRestoreBackup('{broken')), 'INVALID_BACKUP');
  const source = await createFixtureBackup();
  const malformed = cloneBackup(source);
  delete (malformed as unknown as Record<string, unknown>).flowLedgerVersion;
  await expectCode(() => Promise.resolve(validateRestoreBackup(malformed)), 'INVALID_BACKUP');
  const unknownScope = cloneBackup(source);
  (unknownScope as unknown as Record<string, unknown>).scope = 'workspace_only';
  await expectCode(() => Promise.resolve(validateRestoreBackup(unknownScope)), 'INVALID_BACKUP');
});

test('newer and unsupported older backup formats are blocked while newer app version alone is allowed', async () => {
  const source = await createFixtureBackup();
  const newer = cloneBackup(source);
  newer.backupFormatVersion = 2;
  await expectCode(() => Promise.resolve(validateRestoreBackup(newer)), 'UNSUPPORTED_VERSION');
  const older = cloneBackup(source);
  older.backupFormatVersion = 0;
  await expectCode(() => Promise.resolve(validateRestoreBackup(older)), 'UNSUPPORTED_VERSION');
  const newerApp = cloneBackup(source);
  newerApp.flowLedgerVersion = '99.0.0';
  assert.equal(validateRestoreBackup(newerApp).flowLedgerVersion, '99.0.0');
});

test('unsupported store schema, count mismatch, and checksum mismatch have distinct errors', async () => {
  const source = await createFixtureBackup();
  const schema = cloneBackup(source);
  schema.storeManifest[0].schemaVersion = 2;
  await expectCode(() => Promise.resolve(validateRestoreBackup(schema)), 'UNSUPPORTED_STORE_SCHEMA');
  const count = cloneBackup(source);
  count.storeManifest.find((entry) => entry.key === 'accounts')!.recordCount += 1;
  await expectCode(() => Promise.resolve(validateRestoreBackup(count)), 'COUNT_MISMATCH');
  const hash = cloneBackup(source);
  hash.storeManifest.find((entry) => entry.key === 'accounts')!.sha256 = '0'.repeat(64);
  await expectCode(() => Promise.resolve(validateRestoreBackup(hash)), 'HASH_MISMATCH');
});

test('exact membership rejects missing included, missing payload, and unknown stores', async () => {
  const source = await createFixtureBackup();
  const missingIncluded = cloneBackup(source);
  missingIncluded.includedStores = missingIncluded.includedStores.filter((key) => key !== 'transactions');
  await expectCode(() => Promise.resolve(validateRestoreBackup(missingIncluded)), 'INVALID_BACKUP');
  const missingPayload = cloneBackup(source);
  delete missingPayload.data.transactions;
  await expectCode(() => Promise.resolve(validateRestoreBackup(missingPayload)), 'INVALID_BACKUP');
  const unknown = cloneBackup(source) as FlowLedgerBackup & { data: Record<string, unknown> };
  unknown.data.unknownStore = [];
  await expectCode(() => Promise.resolve(validateRestoreBackup(unknown)), 'INVALID_BACKUP');
});

test('dangling workspace and account references are blocked', async () => {
  const source = await createFixtureBackup();
  const workspace = cloneBackup(source);
  workspace.data.accounts![0].workspaceId = 'missing-workspace';
  workspace.workspaceSelection.ids = ['missing-workspace', 'ws1'];
  refreshStoreManifest(workspace, 'accounts');
  await expectCode(() => Promise.resolve(validateRestoreBackup(workspace)), 'REFERENTIAL_INTEGRITY_FAILURE');

  const account = cloneBackup(source);
  account.data.transactions![0].accountId = 'missing-account';
  refreshStoreManifest(account, 'transactions');
  await expectCode(() => Promise.resolve(validateRestoreBackup(account)), 'REFERENTIAL_INTEGRITY_FAILURE');
});

test('dangling category and invalid category/subcategory pairing are blocked', async () => {
  const source = await createFixtureBackup();
  const category = cloneBackup(source);
  category.data.transactions![0].categoryId = 'missing-category';
  refreshStoreManifest(category, 'transactions');
  await expectCode(() => Promise.resolve(validateRestoreBackup(category)), 'REFERENTIAL_INTEGRITY_FAILURE');

  const subcategory = cloneBackup(source);
  subcategory.data.transactions![0].categoryId = 'cat_housing';
  subcategory.data.transactions![0].subcategoryId = 'sub_cafes';
  refreshStoreManifest(subcategory, 'transactions');
  await expectCode(() => Promise.resolve(validateRestoreBackup(subcategory)), 'REFERENTIAL_INTEGRITY_FAILURE');
});

test('dangling import, destination account, and linked transaction references are blocked', async () => {
  const source = await createFixtureBackup();
  for (const [field, value] of [
    ['importId', 'missing-import'],
    ['destinationAccountId', 'missing-account'],
    ['linkedTransactionId', 'missing-transaction'],
  ] as const) {
    const backup = cloneBackup(source);
    backup.data.transactions![0][field] = value;
    refreshStoreManifest(backup, 'transactions');
    await expectCode(() => Promise.resolve(validateRestoreBackup(backup)), 'REFERENTIAL_INTEGRITY_FAILURE');
  }
});

test('valid reciprocal linked transfers are accepted and broken reciprocal pairs are blocked', async () => {
  const valid = await createFixtureBackup('everything', linkedFixtureStores());
  assert.equal(validateRestoreBackup(valid).data.transactions.length, 2);

  const broken = cloneBackup(valid);
  broken.data.transactions!.find((record) => record.id === 'tx-in')!.linkedTransactionId = undefined as never;
  refreshStoreManifest(broken, 'transactions');
  await expectCode(() => Promise.resolve(validateRestoreBackup(broken)), 'REFERENTIAL_INTEGRITY_FAILURE');
});

test('everything restore replaces all eight stores', async () => {
  const backup = await createFixtureBackup('everything', fixtureStores('Restored'));
  const root = makeRoot();
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  writeStores(dataDirectory, fixtureStores('Current'));

  const result = await restoreBackup(backupJson(backup), { dataDirectory, operationsDirectory });
  assert.equal(result.restored, true);
  assert.deepEqual(result.clearedStores, []);
  const restored = readStores(dataDirectory);
  for (const key of PERSISTED_STORE_KEYS) assert.deepEqual(restored[key], backup.data[key]);
});

test('legacy financial activity restore replaces its five stores and explicitly clears omitted stores', async () => {
  const backup = await createLegacyFixtureBackup(fixtureStores('Restored'));
  const root = makeRoot();
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  writeStores(dataDirectory, fixtureStores('Current'));

  const result = await restoreBackup(backupJson(backup), { dataDirectory, operationsDirectory });
  assert.deepEqual(result.clearedStores, ['importTemplates', 'budgets', 'rules']);
  const restored = readStores(dataDirectory);
  for (const key of LEGACY_FINANCIAL_ACTIVITY_STORES) assert.deepEqual(restored[key], backup.data[key]);
  assert.deepEqual(restored.importTemplates, []);
  assert.deepEqual(restored.budgets, []);
  assert.deepEqual(restored.rules, []);
});

test('Activity restore replaces only imports and transactions and preserves six stores byte-for-byte', async () => {
  const backup = await createFixtureBackup('activity', fixtureStores('Restored'));
  const root = makeRoot();
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  writeStores(dataDirectory, fixtureStores('Current'));
  const before = readStoreBytes(dataDirectory);

  const result = await restoreBackup(backupJson(backup), { dataDirectory, operationsDirectory });
  assert.deepEqual(result.restoredStores, ['imports', 'transactions']);
  assert.deepEqual(result.clearedStores, []);
  const restored = readStores(dataDirectory);
  assert.deepEqual(restored.imports, backup.data.imports);
  assert.deepEqual(restored.transactions, backup.data.transactions);
  for (const key of ['workspaces', 'accounts', 'categories', 'importTemplates', 'budgets', 'rules'] as const) {
    assert.equal(fs.readFileSync(path.join(dataDirectory, PERSISTED_STORES[key].filename)).equals(before[key]), true);
  }
});

test('Activity restore blocks missing preserved workspace, account, category, and transfer dependencies', async () => {
  const backup = await createFixtureBackup('activity');

  const missingWorkspace = fixtureStores('Current');
  missingWorkspace.workspaces[0].id = 'ws2';
  for (const key of ['accounts', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions'] as const) {
    for (const record of missingWorkspace[key]) record.workspaceId = 'ws2';
  }

  const missingAccount = fixtureStores('Current');
  missingAccount.accounts = missingAccount.accounts.filter((account) => account.id !== 'acc-a');
  missingAccount.imports = [];
  missingAccount.transactions = [];
  missingAccount.importTemplates = [];
  missingAccount.rules = [];

  const missingCategory = fixtureStores('Current');
  missingCategory.categories = missingCategory.categories.filter((category) => category.id !== 'cat_restaurants');
  missingCategory.imports = [];
  missingCategory.transactions = [];
  missingCategory.rules = [];
  missingCategory.budgets = [];

  for (const stores of [missingWorkspace, missingAccount, missingCategory]) {
    const root = makeRoot();
    const dataDirectory = path.join(root, 'data');
    const operationsDirectory = path.join(root, 'operations');
    writeStores(dataDirectory, stores);
    await expectCode(
      () => previewRestore(backupJson(backup), { dataDirectory, operationsDirectory }),
      'REFERENTIAL_INTEGRITY_FAILURE'
    );
    await expectCode(
      () => restoreBackup(backupJson(backup), { dataDirectory, operationsDirectory }),
      'REFERENTIAL_INTEGRITY_FAILURE'
    );
  }

  const brokenTransfer = await createFixtureBackup('activity', linkedFixtureStores());
  brokenTransfer.data.transactions![0].linkedTransactionId = 'missing-transfer';
  refreshStoreManifest(brokenTransfer, 'transactions');
  const root = makeRoot();
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  writeStores(dataDirectory, fixtureStores('Current'));
  await expectCode(
    () => restoreBackup(backupJson(brokenTransfer), { dataDirectory, operationsDirectory }),
    'REFERENTIAL_INTEGRITY_FAILURE'
  );

  const invalidSubcategory = await createFixtureBackup('activity');
  invalidSubcategory.data.transactions![0].categoryId = 'cat_housing';
  invalidSubcategory.data.transactions![0].subcategoryId = 'sub_cafes';
  refreshStoreManifest(invalidSubcategory, 'transactions');
  await expectCode(
    () => previewRestore(backupJson(invalidSubcategory), { dataDirectory, operationsDirectory }),
    'REFERENTIAL_INTEGRITY_FAILURE'
  );
});

test('Financial Data restore replaces seven stores and preserves workspaces byte-for-byte', async () => {
  const backup = await createFixtureBackup('financial_data', fixtureStores('Restored'));
  const root = makeRoot();
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  writeStores(dataDirectory, fixtureStores('Current'));
  const workspaceBytes = fs.readFileSync(path.join(dataDirectory, 'workspaces.json'));

  const result = await restoreBackup(backupJson(backup), { dataDirectory, operationsDirectory });
  assert.deepEqual(result.restoredStores, ['categories', 'accounts', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions']);
  assert.equal(fs.readFileSync(path.join(dataDirectory, 'workspaces.json')).equals(workspaceBytes), true);
  const restored = readStores(dataDirectory);
  for (const key of BACKUP_SCOPE_STORES.financial_data) assert.deepEqual(restored[key], backup.data[key]);
});

test('Financial Data restore blocks workspace IDs absent from current preserved workspaces', async () => {
  const backup = await createFixtureBackup('financial_data');
  const current = fixtureStores('Current');
  current.workspaces[0].id = 'ws2';
  for (const key of ['accounts', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions'] as const) {
    for (const record of current[key]) record.workspaceId = 'ws2';
  }
  const root = makeRoot();
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  writeStores(dataDirectory, current);
  await expectCode(
    () => restoreBackup(backupJson(backup), { dataDirectory, operationsDirectory }),
    'REFERENTIAL_INTEGRITY_FAILURE'
  );
});

test('snapshot and uniquely named stage files exist before deterministic replacement, then clean up', async () => {
  const backup = await createFixtureBackup();
  const root = makeRoot();
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  writeStores(dataDirectory, fixtureStores('Current'));
  const observedOrder: PersistedStoreKey[] = [];
  let inspected = false;

  await restoreBackup(backupJson(backup), {
    dataDirectory,
    operationsDirectory,
    hooks: {
      beforeReplace: (key, index, context) => {
        observedOrder.push(key);
        if (index !== 0) return;
        inspected = true;
        assert.ok(PERSISTED_STORE_KEYS.every((storeKey) =>
          fs.existsSync(path.join(context.snapshotDirectory, PERSISTED_STORES[storeKey].filename))
        ));
        assert.equal(new Set(Object.values(context.stagedPaths)).size, PERSISTED_STORE_KEYS.length);
        assert.ok(Object.values(context.stagedPaths).every((stagedPath) => fs.existsSync(stagedPath)));
      },
    },
  });

  assert.equal(inspected, true);
  assert.deepEqual(observedOrder, RESTORE_WRITE_ORDER);
  assert.deepEqual(fs.existsSync(operationsDirectory) ? fs.readdirSync(operationsDirectory) : [], []);
  assert.equal(fs.readdirSync(dataDirectory).some((name) => name.includes('.stage')), false);
});

for (const [label, failureIndex] of [['first', 0], ['middle', 3], ['final', 7]] as const) {
  test(`failure during ${label} store replacement rolls back byte-equivalent original data`, async () => {
    const backup = await createFixtureBackup('everything', fixtureStores('Restored'));
    const root = makeRoot();
    const dataDirectory = path.join(root, 'data');
    const operationsDirectory = path.join(root, 'operations');
    writeStores(dataDirectory, fixtureStores('Current'));
    const before = readStoreBytes(dataDirectory);

    await expectCode(() => restoreBackup(backupJson(backup), {
      dataDirectory,
      operationsDirectory,
      hooks: {
        afterReplace: (_key, index) => {
          if (index === failureIndex) throw new Error(`Injected ${label} replacement failure`);
        },
      },
    }), 'RESTORE_EXECUTION_FAILURE');

    const after = readStoreBytes(dataDirectory);
    for (const key of PERSISTED_STORE_KEYS) assert.equal(after[key].equals(before[key]), true);
    assert.deepEqual(fs.existsSync(operationsDirectory) ? fs.readdirSync(operationsDirectory) : [], []);
  });
}

test('rollback failure is distinguished and preserves artifacts for later recovery', async () => {
  const backup = await createFixtureBackup('everything', fixtureStores('Restored'));
  const root = makeRoot();
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  writeStores(dataDirectory, fixtureStores('Current'));
  const before = readStoreBytes(dataDirectory);

  await expectCode(() => restoreBackup(backupJson(backup), {
    dataDirectory,
    operationsDirectory,
    hooks: {
      afterReplace: (_key, index) => {
        if (index === 2) throw new Error('Injected replacement failure');
      },
      beforeRollback: () => { throw new Error('Injected rollback failure'); },
    },
  }), 'ROLLBACK_FAILURE');

  assert.ok(fs.readdirSync(operationsDirectory).length > 0);
  await recoverPendingRestores({ dataDirectory, operationsDirectory });
  const recovered = readStoreBytes(dataDirectory);
  for (const key of PERSISTED_STORE_KEYS) assert.equal(recovered[key].equals(before[key]), true);
  assert.deepEqual(fs.readdirSync(operationsDirectory), []);
});

test('incomplete journal deterministically restores the saved snapshot', async () => {
  const root = makeRoot();
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  const operationDirectory = path.join(operationsDirectory, 'restore-incomplete');
  const snapshotDirectory = path.join(operationDirectory, 'snapshot');
  writeStores(dataDirectory, fixtureStores('Original'));
  fs.mkdirSync(snapshotDirectory, { recursive: true });
  const original = readStoreBytes(dataDirectory);
  for (const key of PERSISTED_STORE_KEYS) {
    fs.copyFileSync(
      path.join(dataDirectory, PERSISTED_STORES[key].filename),
      path.join(snapshotDirectory, PERSISTED_STORES[key].filename)
    );
  }
  fs.writeFileSync(path.join(dataDirectory, 'workspaces.json'), '[]', 'utf-8');
  const stagedName = '.unfinished-accounts.stage';
  fs.writeFileSync(path.join(dataDirectory, stagedName), '[]', 'utf-8');
  const journal: RestoreJournal = {
    journalVersion: 1,
    operationId: 'incomplete',
    createdAt: now,
    state: 'replacing',
    targetStores: [...RESTORE_WRITE_ORDER],
    snapshotDirectory: 'snapshot',
    stagedFiles: { accounts: stagedName },
    originalPresence: Object.fromEntries(PERSISTED_STORE_KEYS.map((key) => [key, true])) as Record<PersistedStoreKey, boolean>,
    replacedStores: ['workspaces'],
  };
  writeRestoreJournal(operationDirectory, journal);

  await recoverPendingRestores({ dataDirectory, operationsDirectory });
  const recovered = readStoreBytes(dataDirectory);
  for (const key of PERSISTED_STORE_KEYS) assert.equal(recovered[key].equals(original[key]), true);
  assert.equal(fs.existsSync(operationDirectory), false);
  assert.equal(fs.existsSync(path.join(dataDirectory, stagedName)), false);
});

test('preview validation never mutates current stores', async () => {
  const backup = await createFixtureBackup();
  const root = makeRoot();
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  writeStores(dataDirectory, fixtureStores('Current'));
  const before = readStoreBytes(dataDirectory);
  await previewRestore(backupJson(backup), { dataDirectory, operationsDirectory });
  const after = readStoreBytes(dataDirectory);
  for (const key of PERSISTED_STORE_KEYS) assert.equal(after[key].equals(before[key]), true);
});

const uploadRequest = (url: string, json: string, confirm = false) => {
  const form = new FormData();
  form.append('file', new File([json], 'flowledger-backup.json', { type: 'application/json' }));
  if (confirm) form.append('confirmReplaceAll', 'true');
  return new Request(url, { method: 'POST', body: form });
};

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

test('preview API returns metadata only', async () => {
  const backup = await createFixtureBackup();
  const root = makeRoot();
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  writeStores(dataDirectory, fixtureStores('Current'));
  const response = await withApiDirectories(dataDirectory, operationsDirectory, () =>
    previewPost(uploadRequest('http://localhost/api/data-management/restore/preview', backupJson(backup)))
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.preview.counts.transactions, 1);
  assert.equal(JSON.stringify(body).includes('SECRET RESTORE DESCRIPTION'), false);
});

test('restore API rejects invalid backup without mutation', async () => {
  const root = makeRoot();
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  writeStores(dataDirectory, fixtureStores('Current'));
  const before = readStoreBytes(dataDirectory);
  const response = await withApiDirectories(dataDirectory, operationsDirectory, () =>
    restorePost(uploadRequest('http://localhost/api/data-management/restore', '{broken', true))
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_BACKUP');
  const after = readStoreBytes(dataDirectory);
  for (const key of PERSISTED_STORE_KEYS) assert.equal(after[key].equals(before[key]), true);
});

test('restore API requires confirmation and succeeds with a valid fixture without logging payload contents', async () => {
  const backup = await createFixtureBackup('everything', fixtureStores('Restored'));
  const root = makeRoot();
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  writeStores(dataDirectory, fixtureStores('Current'));

  const unconfirmed = await withApiDirectories(dataDirectory, operationsDirectory, () =>
    restorePost(uploadRequest('http://localhost/api/data-management/restore', backupJson(backup)))
  );
  assert.equal(unconfirmed.status, 400);

  const logged: unknown[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values: unknown[]) => { logged.push(...values); };
  console.error = (...values: unknown[]) => { logged.push(...values); };
  try {
    const response = await withApiDirectories(dataDirectory, operationsDirectory, () =>
      restorePost(uploadRequest('http://localhost/api/data-management/restore', backupJson(backup), true))
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.restored, true);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  assert.equal(JSON.stringify(logged).includes('SECRET RESTORE DESCRIPTION'), false);
  assert.equal((readStores(dataDirectory).workspaces[0].name as string), 'Restored Workspace');
});

test('backup export and ordinary storage remain usable after restore', async () => {
  const backup = await createFixtureBackup('everything', fixtureStores('Restored'));
  const root = makeRoot();
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  writeStores(dataDirectory, fixtureStores('Current'));
  await restoreBackup(backupJson(backup), { dataDirectory, operationsDirectory });
  const exported = await createBackup('everything', { dataDirectory, operationsDirectory, now: () => new Date(now) });
  assert.equal(exported.storeManifest.length, 8);
  assert.equal(exported.data.workspaces?.[0].name, 'Restored Workspace');
  assert.deepEqual(getDataManagementPaths({ dataDirectory, operationsDirectory }), { dataDirectory, operationsDirectory });
});
