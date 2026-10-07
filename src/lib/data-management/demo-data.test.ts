import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/seed/route';
import { instantiateDefaultCategoryTemplate } from '../default-category-template';
import { DEFAULT_BOOTSTRAP_CATEGORIES, DEFAULT_WORKSPACES } from './default-data';
import { seedDemoData } from './demo-data';
import {
  PERSISTED_STORE_KEYS,
  PERSISTED_STORES,
  type PersistedStoreKey,
} from './store-manifest';
import { readCompleteStoreSet, validateCompleteStoreSet } from './store-state';

const roots: string[] = [];
const now = new Date('2026-10-07T15:00:00.000Z');

test.after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const generatedCategories = instantiateDefaultCategoryTemplate('ws2', {
  categoryId: (key) => `ws2-category-${key}`,
  subcategoryId: (key, categoryKey) => `ws2-subcategory-${categoryKey}-${key}`,
});

const fixtureStores = (): Record<PersistedStoreKey, Record<string, unknown>[]> => ({
  workspaces: [
    ...structuredClone(DEFAULT_WORKSPACES) as Record<string, unknown>[],
    {
      id: 'ws2', ownerUserId: 'local', name: 'Business', baseCurrency: 'EUR',
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    },
  ],
  accounts: [],
  categories: [
    ...structuredClone(DEFAULT_BOOTSTRAP_CATEGORIES) as Record<string, unknown>[],
    ...structuredClone(generatedCategories) as unknown as Record<string, unknown>[],
  ],
  imports: [],
  importTemplates: [],
  budgets: [],
  rules: [],
  transactions: [],
});

const makeDirectories = (stores = fixtureStores()) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-demo-data-'));
  roots.push(root);
  const dataDirectory = path.join(root, 'data');
  const operationsDirectory = path.join(root, 'operations');
  fs.mkdirSync(dataDirectory, { recursive: true });
  for (const key of PERSISTED_STORE_KEYS) {
    fs.writeFileSync(
      path.join(dataDirectory, PERSISTED_STORES[key].filename),
      JSON.stringify(stores[key], null, 2),
      'utf8'
    );
  }
  return { dataDirectory, operationsDirectory };
};

const options = (paths: ReturnType<typeof makeDirectories>) => ({
  ...paths,
  now: () => now,
  random: () => 0.5,
});

const readStore = (dataDirectory: string, key: PersistedStoreKey) => JSON.parse(
  fs.readFileSync(path.join(dataDirectory, PERSISTED_STORES[key].filename), 'utf8')
) as Record<string, unknown>[];

test('demo data seeds canonical ws1 without category references and validates', async () => {
  const paths = makeDirectories();
  const result = await seedDemoData('ws1', false, options(paths));
  const complete = readCompleteStoreSet(paths.dataDirectory);
  const transactions = complete.transactions.filter((record) => record.workspaceId === 'ws1');

  assert.deepEqual({ accounts: result.accounts, transactions: result.transactions }, {
    accounts: 3,
    transactions: 12,
  });
  assert.equal(transactions.length, 12);
  assert.ok(transactions.every((record) => !('categoryId' in record) && !('subcategoryId' in record)));
  assert.ok(transactions.every((record) => record.needsReview === true));
  assert.doesNotThrow(() => validateCompleteStoreSet(complete));
});

test('generated-category workspace reproducer now seeds valid isolated records', async () => {
  const paths = makeDirectories();
  const canonicalCategoryIds = new Set(
    (DEFAULT_BOOTSTRAP_CATEGORIES as Record<string, unknown>[]).map((record) => record.id)
  );
  assert.ok(generatedCategories.every((category) => !canonicalCategoryIds.has(category.id)));

  await seedDemoData('ws2', false, options(paths));
  const complete = readCompleteStoreSet(paths.dataDirectory);
  const accounts = complete.accounts.filter((record) => record.workspaceId === 'ws2');
  const transactions = complete.transactions.filter((record) => record.workspaceId === 'ws2');
  const accountIds = new Set(accounts.map((record) => record.id));

  assert.equal(accounts.length, 3);
  assert.equal(transactions.length, 12);
  assert.ok(transactions.every((record) => accountIds.has(record.accountId)));
  assert.ok(transactions.every((record) => !('categoryId' in record) && !('subcategoryId' in record)));
  assert.doesNotThrow(() => validateCompleteStoreSet(complete));
});

test('two workspaces receive globally distinct demo IDs without cross-workspace references', async () => {
  const paths = makeDirectories();
  await seedDemoData('ws1', false, options(paths));
  await seedDemoData('ws2', false, options(paths));
  const complete = readCompleteStoreSet(paths.dataDirectory);
  const ids = [...complete.accounts, ...complete.transactions].map((record) => record.id);

  assert.equal(new Set(ids).size, ids.length);
  for (const transaction of complete.transactions) {
    const account = complete.accounts.find((record) => record.id === transaction.accountId);
    assert.equal(account?.workspaceId, transaction.workspaceId);
  }
  assert.doesNotThrow(() => validateCompleteStoreSet(complete));
});

test('demo InternalTransfer records form a valid reciprocal same-workspace pair', async () => {
  const paths = makeDirectories();
  await seedDemoData('ws2', false, options(paths));
  const complete = readCompleteStoreSet(paths.dataDirectory);
  const transfers = complete.transactions.filter((record) => record.type === 'InternalTransfer');

  assert.equal(transfers.length, 2);
  const [first, second] = transfers;
  assert.equal(first.linkedTransactionId, second.id);
  assert.equal(second.linkedTransactionId, first.id);
  assert.equal(first.destinationAccountId, second.accountId);
  assert.equal(second.destinationAccountId, first.accountId);
  assert.equal(Number(first.amountBase) + Number(second.amountBase), 0);
  assert.ok(transfers.every((record) => record.needsReview === true));
  assert.doesNotThrow(() => validateCompleteStoreSet(complete));
});

test('repeated seeding upserts deterministic demo records and clear mode preserves its UX', async () => {
  const stores = fixtureStores();
  stores.accounts.push({
    id: 'manual-account', workspaceId: 'ws2', name: 'Manual', type: 'cash', currency: 'EUR',
    institution: 'Manual', openingBalance: 0, archived: false,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  });
  stores.transactions.push({
    id: 'manual-transaction', workspaceId: 'ws2', accountId: 'manual-account',
    date: now.toISOString(), description: 'Manual', rawDescription: 'Manual', amountOriginal: 1,
    currencyOriginal: 'EUR', amountBase: 1, type: 'Income', needsReview: true,
    isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  });
  const paths = makeDirectories(stores);

  await seedDemoData('ws2', false, options(paths));
  await seedDemoData('ws2', false, options(paths));
  assert.equal(readStore(paths.dataDirectory, 'accounts').filter((record) => record.workspaceId === 'ws2').length, 4);
  assert.equal(readStore(paths.dataDirectory, 'transactions').filter((record) => record.workspaceId === 'ws2').length, 13);

  await seedDemoData('ws2', true, options(paths));
  assert.equal(readStore(paths.dataDirectory, 'accounts').filter((record) => record.workspaceId === 'ws2').length, 3);
  assert.equal(readStore(paths.dataDirectory, 'transactions').filter((record) => record.workspaceId === 'ws2').length, 12);
  assert.doesNotThrow(() => readCompleteStoreSet(paths.dataDirectory));
  assert.deepEqual(fs.existsSync(paths.operationsDirectory) ? fs.readdirSync(paths.operationsDirectory) : [], []);
});

test('complete-state validation blocks an unsafe clear before either store is replaced', async () => {
  const stores = fixtureStores();
  stores.accounts.push({
    id: 'referenced-account', workspaceId: 'ws2', name: 'Referenced', type: 'bank', currency: 'EUR',
    institution: 'Bank', openingBalance: 0, archived: false,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  });
  stores.imports.push({
    id: 'existing-import', workspaceId: 'ws2', accountId: 'referenced-account', fileName: 'fixture.csv',
    sourceType: 'CSV', template: 'Fixture', transactionCount: 0, createdAt: now.toISOString(),
  });
  const paths = makeDirectories(stores);
  const accountsBefore = fs.readFileSync(path.join(paths.dataDirectory, PERSISTED_STORES.accounts.filename));
  const transactionsBefore = fs.readFileSync(path.join(paths.dataDirectory, PERSISTED_STORES.transactions.filename));

  await assert.rejects(
    () => seedDemoData('ws2', true, options(paths)),
    /import references a missing account/i
  );
  assert.deepEqual(
    fs.readFileSync(path.join(paths.dataDirectory, PERSISTED_STORES.accounts.filename)),
    accountsBefore
  );
  assert.deepEqual(
    fs.readFileSync(path.join(paths.dataDirectory, PERSISTED_STORES.transactions.filename)),
    transactionsBefore
  );
  assert.equal(fs.existsSync(paths.operationsDirectory), false);
});

test('demo-data API keeps the existing success contract using temporary stores', async () => {
  const paths = makeDirectories();
  const previousData = process.env.FLOWLEDGER_DATA_DIR;
  const previousOperations = process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR;
  process.env.FLOWLEDGER_DATA_DIR = paths.dataDirectory;
  process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR = paths.operationsDirectory;
  try {
    const response = await POST(new NextRequest('http://local/api/seed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws2', clear: false }),
    }));
    const body = await response.json() as { ok: boolean; accounts: number; transactions: number };
    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true, accounts: 3, transactions: 12 });
    assert.doesNotThrow(() => readCompleteStoreSet(paths.dataDirectory));
  } finally {
    if (previousData === undefined) delete process.env.FLOWLEDGER_DATA_DIR;
    else process.env.FLOWLEDGER_DATA_DIR = previousData;
    if (previousOperations === undefined) delete process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR;
    else process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR = previousOperations;
  }
});
