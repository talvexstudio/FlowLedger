import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NextRequest } from 'next/server';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-transaction-approval-'));
const dataDirectory = path.join(root, 'data');
const now = '2026-01-15T12:00:00.000Z';

const makeTransaction = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  workspaceId: 'ws1',
  accountId: 'acc1',
  date: now,
  description: id,
  rawDescription: id,
  amountOriginal: -10,
  currencyOriginal: 'EUR',
  amountBase: -10,
  type: 'Expense',
  needsReview: true,
  isInternalTransfer: false,
  isPotentialDuplicate: false,
  isPotentialTransfer: false,
  isInconsistent: false,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const fixture = () => ({
  workspaces: [{
    id: 'ws1', ownerUserId: 'local', name: 'Personal', baseCurrency: 'EUR',
    createdAt: now, updatedAt: now,
  }],
  accounts: [{
    id: 'acc1', workspaceId: 'ws1', name: 'Bank', type: 'bank', currency: 'EUR',
    institution: 'Bank', openingBalance: 0, archived: false, createdAt: now, updatedAt: now,
  }, {
    id: 'acc2', workspaceId: 'ws1', name: 'Cash', type: 'cash', currency: 'EUR',
    institution: 'Cash', openingBalance: 0, archived: false, createdAt: now, updatedAt: now,
  }],
  categories: [{
    id: 'cat1', workspaceId: 'ws1', name: 'Housing', type: 'expense', order: 1,
    isSystem: false, isActive: true,
    subcategories: [{
      id: 'sub1', workspaceId: 'ws1', categoryId: 'cat1', name: 'Rent', order: 1,
      isSystem: false, isActive: true, flowType: 'Expense',
    }],
  }],
  imports: [],
  importTemplates: [],
  budgets: [],
  rules: [],
  transactions: [
    makeTransaction('tx-uncategorized'),
    makeTransaction('tx-category-only', { categoryId: 'cat1' }),
    makeTransaction('tx-duplicate', { isPotentialDuplicate: true }),
    makeTransaction('tx-potential-transfer', { isPotentialTransfer: true }),
    makeTransaction('tx-inconsistent', { isInconsistent: true }),
    makeTransaction('tx-incomplete-transfer', {
      type: 'InternalTransfer', isInternalTransfer: true, internalDirection: 'Out',
    }),
  ],
});

const filenames: Record<keyof ReturnType<typeof fixture>, string> = {
  workspaces: 'workspaces.json', accounts: 'accounts.json', categories: 'categories.json',
  imports: 'imports.json', importTemplates: 'import-templates.json', budgets: 'budgets.json',
  rules: 'rules.json', transactions: 'transactions.json',
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

let PATCH: typeof import('@/app/api/transactions/route').PATCH;
let POST: typeof import('@/app/api/transactions/route').POST;

test.before(async () => {
  process.env.FLOWLEDGER_DATA_DIR = dataDirectory;
  ({ PATCH, POST } = await import('@/app/api/transactions/route'));
});

test.beforeEach(writeFixture);

test.after(() => {
  delete process.env.FLOWLEDGER_DATA_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

const confirm = async (transactionId: string) => PATCH(new NextRequest(
  'http://local/api/transactions',
  {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'confirm', workspaceId: 'ws1', transactionId }),
  }
));

const savedTransaction = (id: string) => {
  const stored = JSON.parse(
    fs.readFileSync(path.join(dataDirectory, 'transactions.json'), 'utf8')
  ) as Array<Record<string, unknown>>;
  return stored.find((transaction) => transaction.id === id);
};

test('explicit approval accepts Uncategorized and category-only transactions', async () => {
  const uncategorizedResponse = await confirm('tx-uncategorized');
  const categoryOnlyResponse = await confirm('tx-category-only');

  assert.equal(uncategorizedResponse.status, 200);
  assert.equal(categoryOnlyResponse.status, 200);
  assert.equal(savedTransaction('tx-uncategorized')?.needsReview, false);
  assert.equal(savedTransaction('tx-uncategorized')?.categoryId, undefined);
  assert.equal(savedTransaction('tx-category-only')?.needsReview, false);
  assert.equal(savedTransaction('tx-category-only')?.categoryId, 'cat1');
  assert.equal(savedTransaction('tx-category-only')?.subcategoryId, undefined);
});

test('explicit approval does not bypass duplicate, potential-transfer, or inconsistency blockers', async () => {
  const duplicate = await confirm('tx-duplicate');
  const potentialTransfer = await confirm('tx-potential-transfer');
  const inconsistent = await confirm('tx-inconsistent');

  assert.equal(duplicate.status, 409);
  assert.match((await duplicate.json()).error, /Potential duplicate/);
  assert.equal(potentialTransfer.status, 409);
  assert.match((await potentialTransfer.json()).error, /Potential transfer/);
  assert.equal(inconsistent.status, 409);
  assert.match((await inconsistent.json()).error, /inconsistent/);
  assert.equal(savedTransaction('tx-duplicate')?.needsReview, true);
  assert.equal(savedTransaction('tx-potential-transfer')?.needsReview, true);
  assert.equal(savedTransaction('tx-inconsistent')?.needsReview, true);
});

test('explicit approval still rejects incomplete InternalTransfer details', async () => {
  const response = await confirm('tx-incomplete-transfer');
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /counterpart account/i);
  assert.equal(savedTransaction('tx-incomplete-transfer')?.needsReview, true);
});

test('approved Uncategorized can later be categorized and cleared again without stale fields', async () => {
  assert.equal((await confirm('tx-uncategorized')).status, 200);
  const categorized = await POST(new NextRequest('http://local/api/transactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workspaceId: 'ws1', id: 'tx-uncategorized', categoryId: 'cat1', subcategoryId: 'sub1',
    }),
  }));
  assert.equal(categorized.status, 200);
  assert.equal(savedTransaction('tx-uncategorized')?.subcategoryId, 'sub1');

  const parentOnly = await POST(new NextRequest('http://local/api/transactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workspaceId: 'ws1', id: 'tx-uncategorized', categoryId: 'cat1', subcategoryId: null,
    }),
  }));
  assert.equal(parentOnly.status, 200);
  assert.equal(savedTransaction('tx-uncategorized')?.categoryId, 'cat1');
  assert.equal(savedTransaction('tx-uncategorized')?.subcategoryId, undefined);

  const uncategorized = await POST(new NextRequest('http://local/api/transactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workspaceId: 'ws1', id: 'tx-uncategorized', categoryId: null, subcategoryId: null,
    }),
  }));
  assert.equal(uncategorized.status, 200);
  assert.equal(savedTransaction('tx-uncategorized')?.categoryId, undefined);
  assert.equal(savedTransaction('tx-uncategorized')?.subcategoryId, undefined);
});
