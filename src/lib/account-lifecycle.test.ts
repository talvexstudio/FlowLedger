import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Account } from './types';
import {
  clearDeletedAccountTarget,
  resolveQueuedAccountDelete,
  splitAccountsByArchiveState,
} from './account-lifecycle';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-account-lifecycle-'));
const dataDirectory = path.join(root, 'data');
const now = '2026-10-08T10:00:00.000Z';

const fixture = () => ({
  workspaces: [
    { id: 'ws1', ownerUserId: 'local', name: 'Personal', baseCurrency: 'EUR', createdAt: now, updatedAt: now },
    { id: 'ws2', ownerUserId: 'local', name: 'Business', baseCurrency: 'EUR', createdAt: now, updatedAt: now },
  ],
  accounts: [
    { id: 'acc-history', workspaceId: 'ws1', name: 'Historical account', type: 'bank', currency: 'EUR', institution: 'Bank', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
    { id: 'acc-safe', workspaceId: 'ws1', name: 'Unused account', type: 'cash', currency: 'EUR', institution: 'Cash', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
    { id: 'acc-other', workspaceId: 'ws2', name: 'Business account', type: 'bank', currency: 'EUR', institution: 'Bank', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
  ],
  categories: [],
  imports: [],
  importTemplates: [],
  budgets: [],
  rules: [],
  transactions: [{
    id: 'tx-history', workspaceId: 'ws1', accountId: 'acc-history', date: '2026-10-08',
    description: 'Historical transaction', rawDescription: 'HISTORICAL', amountOriginal: -10,
    currencyOriginal: 'EUR', amountBase: -10, type: 'Expense', needsReview: true,
    isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false,
    createdAt: now, updatedAt: now,
  }],
});

const filenames: Record<string, string> = {
  workspaces: 'workspaces.json',
  accounts: 'accounts.json',
  categories: 'categories.json',
  imports: 'imports.json',
  importTemplates: 'import-templates.json',
  budgets: 'budgets.json',
  rules: 'rules.json',
  transactions: 'transactions.json',
};

const writeFixture = () => {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const stores = fixture();
  for (const [key, filename] of Object.entries(filenames)) {
    fs.writeFileSync(
      path.join(dataDirectory, filename),
      JSON.stringify(stores[key as keyof typeof stores], null, 2)
    );
  }
};

let accounts: typeof import('./services/accounts');
let transactions: typeof import('./services/transactions');
let accountRoute: typeof import('../app/api/accounts/route');

test.before(async () => {
  process.env.FLOWLEDGER_DATA_DIR = dataDirectory;
  [accounts, transactions, accountRoute] = await Promise.all([
    import('./services/accounts'),
    import('./services/transactions'),
    import('../app/api/accounts/route'),
  ]);
});

test.beforeEach(() => writeFixture());

test.after(() => {
  delete process.env.FLOWLEDGER_DATA_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

test('archive persists the account and history while removing it from the active view', async () => {
  await accounts.archiveAccount('ws1', 'acc-history');

  const archived = await accounts.getAccount('ws1', 'acc-history');
  const history = await transactions.getTransaction('ws1', 'tx-history');
  const lists = splitAccountsByArchiveState(await accounts.getAccounts('ws1'));

  assert.equal(archived?.id, 'acc-history');
  assert.equal(archived?.archived, true);
  assert.equal(history?.accountId, 'acc-history');
  assert.deepEqual(lists.activeAccounts.map((account) => account.id), ['acc-safe']);
  assert.deepEqual(lists.archivedAccounts.map((account) => account.id), ['acc-history']);
});

test('restore keeps account identity and transaction history and returns it to the active view', async () => {
  await accounts.archiveAccount('ws1', 'acc-history');
  await accounts.restoreAccount('ws1', 'acc-history');

  const restored = await accounts.getAccount('ws1', 'acc-history');
  const history = await transactions.getTransaction('ws1', 'tx-history');
  const lists = splitAccountsByArchiveState(await accounts.getAccounts('ws1'));

  assert.equal(restored?.id, 'acc-history');
  assert.equal(restored?.archived, false);
  assert.equal(history?.id, 'tx-history');
  assert.equal(history?.accountId, restored?.id);
  assert.ok(lists.activeAccounts.some((account) => account.id === 'acc-history'));
  assert.equal(lists.archivedAccounts.length, 0);
});

test('restore is workspace-scoped and the API exposes the same guarded operation', async () => {
  await accounts.archiveAccount('ws1', 'acc-history');
  await assert.rejects(
    () => accounts.restoreAccount('ws2', 'acc-history'),
    /selected workspace/i
  );

  const response = await accountRoute.PATCH(new Request('http://localhost/api/accounts', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId: 'ws1', id: 'acc-history', action: 'restore' }),
  }) as any);
  assert.equal(response.status, 200);
  assert.equal((await accounts.getAccount('ws1', 'acc-history'))?.archived, false);
});

test('safe account deletion still succeeds while referenced-account guards remain intact', async () => {
  await accounts.deleteAccount('ws1', 'acc-safe');
  assert.equal(await accounts.getAccount('ws1', 'acc-safe'), null);
  await assert.rejects(
    () => accounts.deleteAccount('ws1', 'acc-history'),
    /has transactions/i
  );
  await assert.rejects(
    () => accounts.deleteAccount('ws2', 'acc-history'),
    /selected workspace/i
  );
});

test('delete dialog waits for its dropdown layer to close and success clears only its target', () => {
  const target = fixture().accounts[1] as unknown as Account;

  assert.equal(resolveQueuedAccountDelete(true, target), null);
  assert.equal(resolveQueuedAccountDelete(false, target), target);
  assert.equal(clearDeletedAccountTarget(target, target.id), null);

  const another = fixture().accounts[0] as unknown as Account;
  assert.equal(clearDeletedAccountTarget(another, target.id), another);
});
