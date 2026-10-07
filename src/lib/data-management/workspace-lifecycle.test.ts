import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { PATCH, POST } from '@/app/api/workspaces/route';
import { DEFAULT_BOOTSTRAP_CATEGORIES, DEFAULT_WORKSPACES } from './default-data';
import { recoverPendingRestores } from './restore-recovery';
import { PERSISTED_STORE_KEYS, PERSISTED_STORES, type PersistedStoreKey } from './store-manifest';
import {
  createWorkspace,
  renameWorkspace,
  WorkspaceLifecycleError,
} from './workspace-lifecycle';
import {
  appendCreatedWorkspace,
  replaceRenamedWorkspace,
} from '../workspace-client-state';
import {
  canCopyWorkspaceCategories,
  type CreateWorkspaceInput,
} from '../workspace-lifecycle-types';
import { persistWorkspaceId, readPersistedWorkspaceId } from '../workspace-selection';
import type { Workspace } from '../types';

const roots: string[] = [];
const now = '2026-10-07T10:00:00.000Z';

test.after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

const fixtureStores = (): Record<PersistedStoreKey, Record<string, unknown>[]> => ({
  workspaces: structuredClone(DEFAULT_WORKSPACES) as Record<string, unknown>[],
  accounts: [],
  categories: structuredClone(DEFAULT_BOOTSTRAP_CATEGORIES) as Record<string, unknown>[],
  imports: [],
  importTemplates: [],
  budgets: [],
  rules: [],
  transactions: [],
});

const makeDirectories = (stores = fixtureStores()) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-workspace-lifecycle-'));
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

const readStore = (dataDirectory: string, key: PersistedStoreKey) => JSON.parse(
  fs.readFileSync(path.join(dataDirectory, PERSISTED_STORES[key].filename), 'utf-8')
) as Record<string, unknown>[];

const fileBytes = (dataDirectory: string, key: PersistedStoreKey) => fs.readFileSync(
  path.join(dataDirectory, PERSISTED_STORES[key].filename)
);

const deterministicIds = {
  categoryId: (key: string) => `new-cat-${key}`,
  subcategoryId: (key: string, categoryKey: string) => `new-sub-${categoryKey}-${key}`,
};

const options = (paths: ReturnType<typeof makeDirectories>) => ({
  ...paths,
  now: () => new Date(now),
  workspaceIdFactory: () => 'ws2',
  categoryIdFactory: deterministicIds,
});

test('default category creation uses globally distinct runtime IDs and EUR by default', async () => {
  const paths = makeDirectories();
  const result = await createWorkspace({
    name: '  Business  ',
    categoryMode: 'default',
  }, 'local', options(paths));

  assert.equal(result.workspace.id, 'ws2');
  assert.equal(result.workspace.name, 'Business');
  assert.equal(result.workspace.baseCurrency, 'EUR');
  assert.equal(result.categoryCount, DEFAULT_BOOTSTRAP_CATEGORIES.length);

  const categories = readStore(paths.dataDirectory, 'categories');
  const sourceIds = new Set((DEFAULT_BOOTSTRAP_CATEGORIES as Record<string, unknown>[]).map((item) => item.id));
  const target = categories.filter((category) => category.workspaceId === 'ws2');
  assert.equal(target.length, DEFAULT_BOOTSTRAP_CATEGORIES.length);
  assert.ok(target.every((category) => !sourceIds.has(category.id)));
  assert.ok(target.flatMap((category) => category.subcategories as Record<string, unknown>[])
    .every((subcategory) => String(subcategory.id).startsWith('new-sub-')));
  assert.deepEqual(fs.existsSync(paths.operationsDirectory) ? fs.readdirSync(paths.operationsDirectory) : [], []);
});

test('empty mode creates a usable workspace with no categories', async () => {
  const paths = makeDirectories();
  await createWorkspace({ name: 'Empty', baseCurrency: 'GBP', categoryMode: 'empty' }, 'local', options(paths));
  assert.equal(readStore(paths.dataDirectory, 'workspaces').length, 2);
  assert.equal(readStore(paths.dataDirectory, 'categories').filter((category) => category.workspaceId === 'ws2').length, 0);
});

test('copy mode preserves taxonomy display data but creates independent IDs and ownership', async () => {
  const stores = fixtureStores();
  stores.categories = [{
    id: 'cat-source', workspaceId: 'ws1', name: 'Source category', type: 'expense', order: 7,
    isSystem: false, isActive: false, isCustom: true,
    subcategories: [{
      id: 'sub-source', workspaceId: 'ws1', categoryId: 'cat-source', name: 'Source subcategory',
      order: 3, isSystem: false, isActive: false, isCustom: true, flowType: 'Expense',
    }],
  }];
  const paths = makeDirectories(stores);
  await createWorkspace({
    name: 'Copied', baseCurrency: 'CHF', categoryMode: 'copy', sourceWorkspaceId: 'ws1',
  }, 'local', options(paths));

  const categories = readStore(paths.dataDirectory, 'categories');
  const source = categories.find((category) => category.id === 'cat-source')!;
  const copied = categories.find((category) => category.workspaceId === 'ws2')!;
  assert.equal(copied.id, 'new-cat-cat-source');
  assert.equal(copied.name, source.name);
  assert.equal(copied.order, source.order);
  assert.equal(copied.type, source.type);
  assert.equal(copied.isActive, false);
  assert.equal(copied.isCustom, true);
  const copiedSubcategory = (copied.subcategories as Record<string, unknown>[])[0];
  assert.equal(copiedSubcategory.id, 'new-sub-cat-source-sub-source');
  assert.equal(copiedSubcategory.workspaceId, 'ws2');
  assert.equal(copiedSubcategory.categoryId, copied.id);
  assert.notStrictEqual(copied.subcategories, source.subcategories);
  copied.name = 'Changed target';
  assert.equal(source.name, 'Source category');
});

test('copy from a missing source and invalid create values are rejected server-side', async () => {
  for (const input of [
    { name: 'Copy', categoryMode: 'copy', sourceWorkspaceId: 'missing' },
    { name: '   ', categoryMode: 'empty' },
    { name: 'Invalid currency', baseCurrency: 'XYZ', categoryMode: 'empty' },
  ] as CreateWorkspaceInput[]) {
    const paths = makeDirectories();
    await assert.rejects(() => createWorkspace(input, 'local', options(paths)), WorkspaceLifecycleError);
    assert.equal(readStore(paths.dataDirectory, 'workspaces').length, 1);
  }
});

test('duplicate names are allowed because IDs are authoritative', async () => {
  const paths = makeDirectories();
  await createWorkspace({ name: 'My Finances', categoryMode: 'empty' }, 'local', options(paths));
  assert.deepEqual(readStore(paths.dataDirectory, 'workspaces').map((workspace) => workspace.name), [
    'My Finances', 'My Finances',
  ]);
});

test('rename changes only name and updatedAt and preserves owned data', async () => {
  const stores = fixtureStores();
  stores.accounts.push({
    id: 'acc1', workspaceId: 'ws1', name: 'Account', type: 'bank', currency: 'EUR', institution: 'Bank',
    openingBalance: 0, archived: false, createdAt: now, updatedAt: now,
  });
  const paths = makeDirectories(stores);
  const accountsBefore = fileBytes(paths.dataDirectory, 'accounts');
  const renamed = await renameWorkspace({ workspaceId: 'ws1', name: '  Personal  ' }, 'local', {
    ...paths,
    now: () => new Date('2026-10-07T11:00:00.000Z'),
  });
  assert.equal(renamed.id, 'ws1');
  assert.equal(renamed.name, 'Personal');
  assert.equal(renamed.baseCurrency, 'EUR');
  assert.deepEqual(fileBytes(paths.dataDirectory, 'accounts'), accountsBefore);
  await assert.rejects(
    () => renameWorkspace({ workspaceId: 'missing', name: 'Nope' }, 'local', paths),
    /Workspace not found/
  );
});

test('failure after workspace replacement rolls both stores back byte-for-byte', async () => {
  const paths = makeDirectories();
  const beforeWorkspaces = fileBytes(paths.dataDirectory, 'workspaces');
  const beforeCategories = fileBytes(paths.dataDirectory, 'categories');
  await assert.rejects(() => createWorkspace(
    { name: 'Business', categoryMode: 'default' },
    'local',
    {
      ...options(paths),
      hooks: { beforeReplace: (_key, index) => { if (index === 1) throw new Error('category write failed'); } },
    }
  ), /Original data was restored successfully/);
  assert.deepEqual(fileBytes(paths.dataDirectory, 'workspaces'), beforeWorkspaces);
  assert.deepEqual(fileBytes(paths.dataDirectory, 'categories'), beforeCategories);
});

test('an unfinished workspace-create journal is recoverable', async () => {
  const paths = makeDirectories();
  const beforeWorkspaces = fileBytes(paths.dataDirectory, 'workspaces');
  await assert.rejects(() => createWorkspace(
    { name: 'Business', categoryMode: 'default' },
    'local',
    {
      ...options(paths),
      hooks: {
        beforeReplace: (_key, index) => { if (index === 1) throw new Error('replace failed'); },
        beforeRollback: () => { throw new Error('rollback interrupted'); },
      },
    }
  ), /automatic rollback could not complete/i);
  assert.ok(fs.readdirSync(paths.operationsDirectory).length > 0);
  await recoverPendingRestores(paths);
  assert.deepEqual(fileBytes(paths.dataDirectory, 'workspaces'), beforeWorkspaces);
  assert.deepEqual(fs.readdirSync(paths.operationsDirectory), []);
});

test('client helpers append/select created workspaces and preserve selection on rename', () => {
  const existing = [{
    id: 'ws1', ownerUserId: 'local', name: 'Personal', baseCurrency: 'EUR',
    createdAt: new Date(now), updatedAt: new Date(now),
  }];
  const created: Workspace = {
    id: 'ws2', ownerUserId: 'local', name: 'Business', baseCurrency: 'EUR',
    createdAt: new Date(now), updatedAt: new Date(now),
  };
  const storageValues = new Map<string, string>();
  const storage = {
    getItem: (key: string) => storageValues.get(key) ?? null,
    setItem: (key: string, value: string) => { storageValues.set(key, value); },
    removeItem: (key: string) => { storageValues.delete(key); },
  };
  const withCreated = appendCreatedWorkspace(existing, created);
  persistWorkspaceId(storage, created.id);
  assert.deepEqual(withCreated.map((workspace) => workspace.id), ['ws1', 'ws2']);
  assert.equal(readPersistedWorkspaceId(storage), 'ws2');
  const renamed = { ...created, name: 'Company' };
  assert.equal(replaceRenamedWorkspace(withCreated, renamed)[1].name, 'Company');
  assert.equal(readPersistedWorkspaceId(storage), 'ws2');
});

test('copy categories is unavailable only when no source workspace exists', () => {
  assert.equal(canCopyWorkspaceCategories([]), false);
  assert.equal(canCopyWorkspaceCategories([{ id: 'ws1' }]), true);
});

const withApiDirectories = async <T>(
  paths: ReturnType<typeof makeDirectories>,
  task: () => Promise<T>
) => {
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

test('workspace API rejects client IDs, creates server IDs, and PATCH renames name only', async () => {
  const paths = makeDirectories();
  const rejectedResponse = await withApiDirectories(paths, () => POST(new NextRequest('http://local/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ id: 'client-id', name: 'Rejected', categoryMode: 'empty' }),
    headers: { 'content-type': 'application/json' },
  })));
  assert.equal(rejectedResponse.status, 400);

  const createdResponse = await withApiDirectories(paths, () => POST(new NextRequest('http://local/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name: 'API workspace', categoryMode: 'empty' }),
    headers: { 'content-type': 'application/json' },
  })));
  assert.equal(createdResponse.status, 200);
  const created = await createdResponse.json() as { workspace: Workspace };
  assert.match(created.workspace.id, /^ws_/);

  const renamedResponse = await withApiDirectories(paths, () => PATCH(new NextRequest('http://local/api/workspaces', {
    method: 'PATCH',
    body: JSON.stringify({ workspaceId: created.workspace.id, name: 'Renamed API workspace', baseCurrency: 'USD' }),
    headers: { 'content-type': 'application/json' },
  })));
  assert.equal(renamedResponse.status, 200);
  const renamed = await renamedResponse.json() as Workspace;
  assert.equal(renamed.name, 'Renamed API workspace');
  assert.equal(renamed.baseCurrency, 'EUR');
});
