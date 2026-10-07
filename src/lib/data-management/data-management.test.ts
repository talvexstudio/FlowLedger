import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { POST as backupPost } from '@/app/api/data-management/backup/route';
import {
  calculateStoreChecksum,
  canonicalizeStoreRecords,
  createBackup,
  type BackupRecord,
} from './backup';
import { withDataLock } from './data-lock';
import {
  DEFAULT_DATA_VERSION,
  DEFAULT_SYSTEM_CATEGORIES,
  DEFAULT_WORKSPACES,
} from './default-data';
import {
  BACKUP_SCOPE_STORES,
  DATA_SCOPE_DEFINITIONS,
  PERSISTED_STORE_KEYS,
  PERSISTED_STORES,
  type PersistedStoreKey,
} from './store-manifest';
import {
  buildTemporaryFilePath,
  createJsonStore,
  JsonStoreReadError,
} from '../services/json-store';

const createdDirectories: string[] = [];

const makeTempDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-data-management-'));
  createdDirectories.push(directory);
  return directory;
};

test.after(() => {
  for (const directory of createdDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const now = '2026-10-05T12:00:00.000Z';

const fixtureStores = (): Record<PersistedStoreKey, Record<string, unknown>[]> => ({
  workspaces: structuredClone(DEFAULT_WORKSPACES) as Record<string, unknown>[],
  accounts: [{
    id: 'acc-a', workspaceId: 'ws1', name: 'Account A', type: 'bank', currency: 'EUR',
    institution: 'Bank', openingBalance: 10, archived: false, createdAt: now, updatedAt: now,
  }],
  categories: structuredClone(DEFAULT_SYSTEM_CATEGORIES) as Record<string, unknown>[],
  imports: [{
    id: 'imp-a', workspaceId: 'ws1', accountId: 'acc-a', createdAt: now,
    fileName: 'statement.csv', sourceType: 'CSV', template: 'Manual mapping', transactionCount: 1,
    updatedAt: now,
  }],
  importTemplates: [{
    id: 'tpl-a', workspaceId: 'ws1', name: 'Template', sourceType: 'CSV',
    headerSignature: ['Date', 'Description', 'Amount'],
    mapping: { dateField: 'Date', descriptionField: 'Description', amountField: 'Amount' },
    defaultAccountId: 'acc-a', createdAt: now, updatedAt: now,
  }],
  budgets: [{
    id: 'budget-a', workspaceId: 'ws1', year: 2026, createdFromSampleMonths: 3,
    samplePeriodFrom: '2026-01', samplePeriodTo: '2026-12', createdAt: now, updatedAt: now,
  }],
  rules: [{
    id: 'rule-a', workspaceId: 'ws1', match: { descriptionContains: 'Coffee' },
    action: { categoryId: 'cat_restaurants', subcategoryId: 'sub_cafes', type: 'Expense' },
    createdAt: now, updatedAt: now,
  }],
  transactions: [{
    id: 'tx-b', workspaceId: 'ws1', accountId: 'acc-a', date: '2026-10-02',
    description: 'Second', rawDescription: 'SECOND', amountOriginal: -2, currencyOriginal: 'EUR',
    amountBase: -2, type: 'Expense', categoryId: 'cat_restaurants', subcategoryId: 'sub_cafes',
    importId: 'imp-a', needsReview: false, isInternalTransfer: false,
    isPotentialDuplicate: false, isInconsistent: false, createdAt: now, updatedAt: now,
  }, {
    id: 'tx-a', workspaceId: 'ws1', accountId: 'acc-a', date: '2026-10-01',
    description: 'First', rawDescription: 'FIRST', amountOriginal: -1, currencyOriginal: 'EUR',
    amountBase: -1, type: 'Expense', categoryId: 'cat_restaurants', subcategoryId: 'sub_cafes',
    importId: 'imp-a', needsReview: false, isInternalTransfer: false,
    isPotentialDuplicate: false, isInconsistent: false, createdAt: now, updatedAt: now,
  }],
});

const writeFixtureStores = (directory: string, stores = fixtureStores()) => {
  fs.mkdirSync(directory, { recursive: true });
  for (const key of PERSISTED_STORE_KEYS) {
    fs.writeFileSync(
      path.join(directory, PERSISTED_STORES[key].filename),
      JSON.stringify(stores[key], null, 2),
      'utf-8'
    );
  }
};

test('manifest contains exactly the eight canonical stores and schema versions', () => {
  assert.deepEqual(PERSISTED_STORE_KEYS, [
    'workspaces', 'accounts', 'categories', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions',
  ]);
  assert.deepEqual(
    PERSISTED_STORE_KEYS.map((key) => PERSISTED_STORES[key].filename),
    ['workspaces.json', 'accounts.json', 'categories.json', 'imports.json', 'import-templates.json', 'budgets.json', 'rules.json', 'transactions.json']
  );
  assert.ok(PERSISTED_STORE_KEYS.every((key) => PERSISTED_STORES[key].schemaVersion === 1));
});

test('backup scopes contain exactly their required stores', () => {
  assert.deepEqual(BACKUP_SCOPE_STORES.activity, ['imports', 'transactions']);
  assert.deepEqual(BACKUP_SCOPE_STORES.financial_data, [
    'accounts', 'categories', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions',
  ]);
  assert.deepEqual(BACKUP_SCOPE_STORES.everything, PERSISTED_STORE_KEYS);
  assert.deepEqual(
    Object.values(DATA_SCOPE_DEFINITIONS).map(({ key, label, description }) => ({ key, label, description })),
    [
      { key: 'activity', label: 'Activity', description: 'Transactions and import history' },
      { key: 'financial_data', label: 'Financial Data', description: 'Accounts, categories, transactions, imports, import templates, budgets, and rules' },
      { key: 'everything', label: 'Everything', description: 'All FlowLedger data, including workspaces' },
    ]
  );
});

test('backup ordering, checksums, counts, metadata, and workspace IDs are deterministic', async () => {
  const directory = makeTempDirectory();
  writeFixtureStores(directory);
  const options = { dataDirectory: directory, now: () => new Date(now) };
  const first = await createBackup('everything', options);

  const stores = fixtureStores();
  stores.transactions.reverse();
  writeFixtureStores(directory, stores);
  const second = await createBackup('everything', options);

  assert.deepEqual(first.data, second.data);
  assert.deepEqual(first.storeManifest, second.storeManifest);
  assert.deepEqual(first.data.transactions?.map((record) => record.id), ['tx-a', 'tx-b']);
  assert.equal(first.storeManifest.find((entry) => entry.key === 'transactions')?.recordCount, 2);
  assert.equal(first.backupFormatVersion, 1);
  assert.equal(first.flowLedgerVersion, '0.1.0');
  assert.equal(first.minimumCompatibleFlowLedgerVersion, '0.1.0');
  assert.equal(first.containsSensitiveFinancialData, true);
  assert.deepEqual(first.workspaceSelection, { mode: 'all', ids: ['ws1'] });
  assert.deepEqual(first.includedStores, [...PERSISTED_STORE_KEYS]);
  assert.ok(first.storeManifest.every((entry) => entry.schemaVersion === 1));
  assert.deepEqual(Object.keys(first.data), [...PERSISTED_STORE_KEYS]);
});

test('checksum is stable for the same canonical records', () => {
  const records = canonicalizeStoreRecords([{ id: 'b', value: 2 }, { value: 1, id: 'a' }]);
  const reordered = canonicalizeStoreRecords([{ id: 'a', value: 1 }, { id: 'b', value: 2 }]);
  assert.equal(calculateStoreChecksum(records), calculateStoreChecksum(reordered));
  assert.match(calculateStoreChecksum(records), /^[a-f0-9]{64}$/);
});

test('malformed JSON and missing canonical stores fail backup explicitly', async () => {
  const malformedDirectory = makeTempDirectory();
  writeFixtureStores(malformedDirectory);
  fs.writeFileSync(path.join(malformedDirectory, 'accounts.json'), '{broken', 'utf-8');
  await assert.rejects(createBackup('everything', { dataDirectory: malformedDirectory }), /accounts\.json/);

  const missingDirectory = makeTempDirectory();
  writeFixtureStores(missingDirectory);
  fs.rmSync(path.join(missingDirectory, 'rules.json'));
  await assert.rejects(createBackup('everything', { dataDirectory: missingDirectory }), /rules\.json/);
});

test('invalid top-level shape and missing required record fields fail backup explicitly', async () => {
  const shapeDirectory = makeTempDirectory();
  writeFixtureStores(shapeDirectory);
  fs.writeFileSync(path.join(shapeDirectory, 'accounts.json'), '{}', 'utf-8');
  await assert.rejects(createBackup('financial_data', { dataDirectory: shapeDirectory }), /accounts\.json/);

  const recordDirectory = makeTempDirectory();
  writeFixtureStores(recordDirectory);
  fs.writeFileSync(path.join(recordDirectory, 'accounts.json'), JSON.stringify([{ id: 'broken' }]), 'utf-8');
  await assert.rejects(createBackup('financial_data', { dataDirectory: recordDirectory }), /accounts\.json/);
});

test('unknown backup scope is rejected', async () => {
  const directory = makeTempDirectory();
  writeFixtureStores(directory);
  await assert.rejects(
    createBackup('unknown' as never, { dataDirectory: directory }),
    /Unsupported backup scope/
  );
});

test('malformed JSON no longer becomes an empty ordinary collection', async () => {
  const directory = makeTempDirectory();
  writeFixtureStores(directory);
  fs.writeFileSync(path.join(directory, 'accounts.json'), '[invalid', 'utf-8');
  const store = createJsonStore({ dataDirectory: directory });
  await assert.rejects(store.collection('workspaces/ws1/accounts').get(), JsonStoreReadError);
});

test('ordinary JSON writes and reads still work and leave no temporary files', async () => {
  const directory = makeTempDirectory();
  writeFixtureStores(directory);
  const store = createJsonStore({ dataDirectory: directory });
  await Promise.all([
    store.collection('workspaces/ws1/accounts').doc('acc-b').set({
      name: 'B', type: 'cash', currency: 'EUR', institution: 'Cash', openingBalance: 0, archived: false,
    }),
    store.collection('workspaces/ws1/accounts').doc('acc-c').set({
      name: 'C', type: 'cash', currency: 'EUR', institution: 'Cash', openingBalance: 0, archived: false,
    }),
  ]);
  const snapshot = await store.collection('workspaces/ws1/accounts').get();
  assert.deepEqual(snapshot.docs.map((document) => document.id).sort(), ['acc-a', 'acc-b', 'acc-c']);
  assert.equal(fs.readdirSync(directory).some((name) => name.endsWith('.tmp')), false);
});

test('temporary filenames are unique for the same target', () => {
  const target = path.join(makeTempDirectory(), 'accounts.json');
  const first = buildTemporaryFilePath(target);
  const second = buildTemporaryFilePath(target);
  assert.notEqual(first, second);
  assert.equal(path.dirname(first), path.dirname(target));
  assert.equal(path.dirname(second), path.dirname(target));
});

test('shared lock serializes conflicting operations', async () => {
  const events: string[] = [];
  let releaseFirst!: () => void;
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const first = withDataLock(async () => {
    events.push('first-start');
    await gate;
    events.push('first-end');
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = withDataLock(() => { events.push('second'); });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first-start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'first-end', 'second']);
});

test('backup read waits for and captures one coherent locked snapshot', async () => {
  const directory = makeTempDirectory();
  const stores = fixtureStores();
  writeFixtureStores(directory, stores);
  let writerStarted!: () => void;
  const started = new Promise<void>((resolve) => { writerStarted = resolve; });

  const writer = withDataLock(async () => {
    writerStarted();
    await new Promise<void>((resolve) => setTimeout(resolve, 15));
    stores.accounts[0].name = 'Updated account';
    stores.transactions[0].description = 'Updated transaction';
    writeFixtureStores(directory, stores);
  });
  await started;
  const backupPromise = createBackup('financial_data', { dataDirectory: directory, now: () => new Date(now) });
  const [, backup] = await Promise.all([writer, backupPromise]);
  assert.equal(backup.data.accounts?.[0].name, 'Updated account');
  assert.equal(
    backup.data.transactions?.find((record) => record.id === 'tx-b')?.description,
    'Updated transaction'
  );
});

test('authoritative defaults contain ws1 and its complete editable starter taxonomy', () => {
  assert.equal(DEFAULT_DATA_VERSION, 2);
  assert.equal(DEFAULT_WORKSPACES.length, 1);
  assert.equal(DEFAULT_WORKSPACES[0].id, 'ws1');
  assert.equal(DEFAULT_SYSTEM_CATEGORIES.length, 17);
  const subcategories = DEFAULT_SYSTEM_CATEGORIES.flatMap((category) => category.subcategories as BackupRecord[]);
  assert.equal(subcategories.length, 60);
  assert.ok(DEFAULT_SYSTEM_CATEGORIES.every((category) => category.isSystem === true));
  assert.ok(subcategories.every((subcategory) => subcategory.isSystem === true));
  assert.ok(DEFAULT_SYSTEM_CATEGORIES.every((category) => category.workspaceId === 'ws1'));
  assert.ok(subcategories.every((subcategory) => subcategory.workspaceId === 'ws1'));
  assert.equal(DEFAULT_SYSTEM_CATEGORIES.some((category) => category.isCustom === true), false);
  assert.equal(subcategories.some((subcategory) => subcategory.isCustom === true), false);
});

test('backup API returns downloadable JSON and writes no backup artifact under data', async () => {
  const directory = makeTempDirectory();
  writeFixtureStores(directory);
  const filesBefore = fs.readdirSync(directory).sort();
  const previousDirectory = process.env.FLOWLEDGER_DATA_DIR;
  process.env.FLOWLEDGER_DATA_DIR = directory;
  try {
    const response = await backupPost(new Request('http://localhost/api/data-management/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'activity' }),
    }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type') ?? '', /^application\/json/);
    assert.match(
      response.headers.get('Content-Disposition') ?? '',
      /^attachment; filename="flowledger-backup-.*-activity\.json"$/
    );
    const body = await response.json();
    assert.equal(body.scope, 'activity');
    assert.deepEqual(body.includedStores, [...BACKUP_SCOPE_STORES.activity]);
    assert.deepEqual(Object.keys(body.data), [...BACKUP_SCOPE_STORES.activity]);
    assert.deepEqual(fs.readdirSync(directory).sort(), filesBefore);
  } finally {
    if (previousDirectory === undefined) delete process.env.FLOWLEDGER_DATA_DIR;
    else process.env.FLOWLEDGER_DATA_DIR = previousDirectory;
  }
});

test('backup API rejects an unknown scope', async () => {
  const response = await backupPost(new Request('http://localhost/api/data-management/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: 'workspace_only' }),
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Unsupported backup scope.' });
});

test('legacy financial_activity is restore-only and cannot be created by the backup API', async () => {
  const response = await backupPost(new Request('http://localhost/api/data-management/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: 'financial_activity' }),
  }));
  assert.equal(response.status, 400);
});

test('all three new scopes emit matching counts and checksums for exactly their stores', async () => {
  const directory = makeTempDirectory();
  writeFixtureStores(directory);
  for (const scope of ['activity', 'financial_data', 'everything'] as const) {
    const backup = await createBackup(scope, { dataDirectory: directory, now: () => new Date(now) });
    assert.deepEqual(backup.includedStores, [...BACKUP_SCOPE_STORES[scope]]);
    assert.deepEqual(Object.keys(backup.data), [...BACKUP_SCOPE_STORES[scope]]);
    for (const entry of backup.storeManifest) {
      const records = backup.data[entry.key]!;
      assert.equal(entry.recordCount, records.length);
      assert.equal(entry.sha256, calculateStoreChecksum(records));
    }
  }
});
