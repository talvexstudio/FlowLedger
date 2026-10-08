import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-workspace-hardening-'));
const dataDirectory = path.join(temporaryRoot, 'data');
const operationsDirectory = path.join(temporaryRoot, 'operations');

const now = '2026-10-06T10:00:00.000Z';

const transaction = (id: string, workspaceId: string, accountId: string) => ({
  id,
  workspaceId,
  accountId,
  date: '2026-10-06',
  description: id,
  rawDescription: id,
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
});

const fixture = () => ({
  workspaces: [
    { id: 'ws1', ownerUserId: 'local', name: 'Personal', baseCurrency: 'EUR', createdAt: now, updatedAt: now },
    { id: 'ws2', ownerUserId: 'local', name: 'Business', baseCurrency: 'EUR', createdAt: now, updatedAt: now },
  ],
  accounts: [
    { id: 'acc-1', workspaceId: 'ws1', name: 'Checking', type: 'bank', currency: 'EUR', institution: 'Bank', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
    { id: 'acc-2', workspaceId: 'ws1', name: 'Cash', type: 'cash', currency: 'EUR', institution: 'Cash', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
    { id: 'acc-3', workspaceId: 'ws2', name: 'Business', type: 'bank', currency: 'EUR', institution: 'Bank', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
  ],
  categories: [],
  imports: [
    { id: 'imp-1', workspaceId: 'ws1', accountId: 'acc-1', createdAt: now, fileName: 'one.csv', sourceType: 'CSV', template: 'Manual', transactionCount: 1 },
    { id: 'imp-2', workspaceId: 'ws2', accountId: 'acc-3', createdAt: now, fileName: 'two.csv', sourceType: 'CSV', template: 'Manual', transactionCount: 1 },
  ],
  importTemplates: [
    { id: 'tpl-1', workspaceId: 'ws1', name: 'Template one', sourceType: 'CSV', headerSignature: ['Date'], mapping: { dateField: 'Date', descriptionField: 'Description', amountField: 'Amount' }, defaultAccountId: 'acc-1', createdAt: now },
    { id: 'tpl-2', workspaceId: 'ws2', name: 'Template two', sourceType: 'CSV', headerSignature: ['Date'], mapping: { dateField: 'Date', descriptionField: 'Description', amountField: 'Amount' }, defaultAccountId: 'acc-3', createdAt: now },
  ],
  budgets: [
    { id: '2025', workspaceId: 'ws1', year: 2025, createdFromSampleMonths: 3, samplePeriodFrom: '2025-01', samplePeriodTo: '2025-12', createdAt: now },
  ],
  rules: [
    { id: 'rule-1', workspaceId: 'ws1', match: { accountId: 'acc-1' }, action: { type: 'Expense' }, createdAt: now },
    { id: 'rule-2', workspaceId: 'ws2', match: { accountId: 'acc-3' }, action: { type: 'Expense' }, createdAt: now },
  ],
  transactions: [
    { ...transaction('tx-1', 'ws1', 'acc-1'), importId: 'imp-1' },
    { ...transaction('tx-2', 'ws2', 'acc-3'), importId: 'imp-2' },
  ],
});

const writeFixture = () => {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const stores = fixture();
  const filenames: Record<keyof typeof stores, string> = {
    workspaces: 'workspaces.json',
    accounts: 'accounts.json',
    categories: 'categories.json',
    imports: 'imports.json',
    importTemplates: 'import-templates.json',
    budgets: 'budgets.json',
    rules: 'rules.json',
    transactions: 'transactions.json',
  };
  for (const [key, filename] of Object.entries(filenames)) {
    fs.writeFileSync(
      path.join(dataDirectory, filename),
      JSON.stringify(stores[key as keyof typeof stores], null, 2)
    );
  }
};

let accounts: typeof import('./services/accounts');
let importsService: typeof import('./services/imports');
let rules: typeof import('./services/rules');
let budgets: typeof import('./services/budgets');
let transactions: typeof import('./services/transactions');
let jsonStoreModule: typeof import('./services/json-store');
let bulkDelete: typeof import('./data-management/transaction-bulk-delete');

test.before(async () => {
  process.env.FLOWLEDGER_DATA_DIR = dataDirectory;
  [accounts, importsService, rules, budgets, transactions, jsonStoreModule, bulkDelete] = await Promise.all([
    import('./services/accounts'),
    import('./services/imports'),
    import('./services/rules'),
    import('./services/budgets'),
    import('./services/transactions'),
    import('./services/json-store'),
    import('./data-management/transaction-bulk-delete'),
  ]);
});

test.beforeEach(() => writeFixture());

test.after(() => {
  delete process.env.FLOWLEDGER_DATA_DIR;
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test('exact saved import mapping matching is workspace- and source-type scoped', async () => {
  const personal = await importsService.findMatchingTemplate('ws1', ['Date'], 'CSV');
  const business = await importsService.findMatchingTemplate('ws2', ['Date'], 'CSV');
  const wrongSourceType = await importsService.findMatchingTemplate('ws1', ['Date'], 'XLSX');

  assert.equal(personal?.id, 'tpl-1');
  assert.equal(business?.id, 'tpl-2');
  assert.equal(wrongSourceType, null);
});

test('scoped document operations enforce workspace ownership and keep global stores working', async () => {
  const store = jsonStoreModule.createJsonStore({ dataDirectory });
  const wrongWorkspaceAccount = store.collection('workspaces/ws2/accounts').doc('acc-1');
  assert.equal((await wrongWorkspaceAccount.get()).exists, false);
  await assert.rejects(() => wrongWorkspaceAccount.update({ name: 'Wrong' }), /workspace/i);
  await assert.rejects(() => wrongWorkspaceAccount.delete(), /workspace/i);
  await assert.rejects(
    () => wrongWorkspaceAccount.set({ name: 'Collision', workspaceId: 'ws2' }),
    /globally unique ID|workspace/i
  );

  await store.collection('workspaces').doc('ws1').update({ name: 'Updated Personal' });
  const workspace = await store.collection('workspaces').doc('ws1').get();
  assert.equal(workspace.data()?.name, 'Updated Personal');
});

test('account updates and deletes cannot cross workspace boundaries', async () => {
  await accounts.saveAccount('ws1', { id: 'acc-1', name: 'Updated' });
  assert.equal((await accounts.getAccount('ws1', 'acc-1'))?.name, 'Updated');
  await assert.rejects(
    () => accounts.saveAccount('ws2', { id: 'acc-1', name: 'Wrong' }),
    /selected workspace/i
  );
  await assert.rejects(() => accounts.deleteAccount('ws2', 'acc-1'), /selected workspace/i);
  await assert.rejects(() => accounts.deleteAccount('ws1', 'acc-1'), /has transactions/i);
});

test('transaction updates, deletes, account references, and links stay in one workspace', async () => {
  await assert.rejects(
    () => transactions.saveTransaction('ws2', { id: 'tx-1', accountId: 'acc-3' }),
    /selected workspace/i
  );
  await assert.rejects(() => transactions.deleteTransaction('ws2', 'tx-1'), /workspace/i);
  await assert.rejects(
    () => transactions.saveTransaction('ws1', {
      id: 'tx-1',
      type: 'InternalTransfer',
      isInternalTransfer: true,
      internalDirection: 'Out',
      destinationAccountId: 'acc-3',
    }),
    /Counterpart account/i
  );
  await assert.rejects(
    () => transactions.saveTransaction('ws1', {
      id: 'tx-1',
      type: 'InternalTransfer',
      isInternalTransfer: true,
      internalDirection: 'Out',
      destinationAccountId: 'acc-2',
      linkedTransactionId: 'tx-2',
    }),
    /Linked transaction/i
  );
});

test('transaction comments persist, normalize, clear, and survive unrelated partial updates', async () => {
  const { id: _fixtureId, ...newTransaction } = transaction('new-comment', 'ws1', 'acc-1');
  const created = await transactions.saveTransaction('ws1', {
    ...newTransaction,
    comments: '  Reimbursable by Joao  ',
  } as any);
  assert.equal(created.comments, 'Reimbursable by Joao');
  assert.equal((await transactions.getTransaction('ws1', created.id))?.comments, 'Reimbursable by Joao');

  await transactions.saveTransaction('ws1', { id: created.id, needsReview: true });
  assert.equal((await transactions.getTransaction('ws1', created.id))?.comments, 'Reimbursable by Joao');

  await transactions.saveTransaction('ws1', { id: created.id, comments: 'Updated note' });
  assert.equal((await transactions.getTransaction('ws1', created.id))?.comments, 'Updated note');

  await transactions.saveTransaction('ws1', {
    id: created.id,
    isPotentialDuplicate: true,
    needsReview: true,
  });
  await transactions.saveTransaction('ws1', {
    id: created.id,
    isPotentialDuplicate: false,
    potentialDuplicateMatch: null,
    needsReview: false,
  });
  assert.equal((await transactions.getTransaction('ws1', created.id))?.comments, 'Updated note');

  await transactions.confirmTransaction('ws1', created.id);
  assert.equal((await transactions.getTransaction('ws1', created.id))?.comments, 'Updated note');

  await transactions.saveTransaction('ws1', { id: created.id, comments: '   ' });
  assert.equal((await transactions.getTransaction('ws1', created.id))?.comments, undefined);

  await assert.rejects(
    () => transactions.saveTransaction('ws1', { id: created.id, comments: 'x'.repeat(2001) }),
    /characters or fewer/i
  );
  await assert.rejects(
    () => transactions.saveTransaction('ws1', { id: created.id, comments: 42 as unknown as string }),
    /plain text/i
  );
});

test('bulk deletion rejects IDs from another workspace', async () => {
  await assert.rejects(
    () => bulkDelete.previewTransactionBulkDelete('ws1', ['tx-2'], { dataDirectory, operationsDirectory }),
    /current data scope/i
  );
});

test('valid same-workspace InternalTransfer paired creation still works', async () => {
  const result = await transactions.createInternalTransferPair('ws1', {
    workspaceId: 'ws1',
    accountId: 'acc-1',
    destinationAccountId: 'acc-2',
    date: new Date('2026-10-06T00:00:00.000Z'),
    description: 'Transfer',
    rawDescription: 'Transfer',
    amountOriginal: -25,
    currencyOriginal: 'EUR',
    amountBase: -25,
    type: 'InternalTransfer',
    internalDirection: 'Out',
    needsReview: false,
    isInternalTransfer: true,
    isPotentialDuplicate: false,
    isInconsistent: false,
    comments: 'Source note',
  });
  assert.equal(result.source.destinationAccountId, 'acc-2');
  assert.equal(result.destination.destinationAccountId, 'acc-1');
  assert.equal(result.source.linkedTransactionId, result.destination.id);
  assert.equal(result.destination.linkedTransactionId, result.source.id);
  assert.equal(result.source.comments, 'Source note');
  assert.equal(result.destination.comments, undefined);
});

test('imports and persisted import templates validate workspace ownership', async () => {
  await assert.rejects(() => importsService.deleteImportSession('ws2', 'imp-1'), /workspace/i);
  await assert.rejects(
    () => importsService.saveImportSession('ws1', {
      workspaceId: 'ws1', accountId: 'acc-3', createdAt: new Date(now), fileName: 'wrong.csv',
      sourceType: 'CSV', template: 'Manual', transactionCount: 0,
    }),
    /selected workspace/i
  );
  assert.equal(await importsService.getImportTemplate('ws2', 'tpl-1'), null);
  await assert.rejects(
    () => importsService.deleteImportTemplate('ws2', 'tpl-1'),
    /selected workspace/i
  );
  await assert.rejects(
    () => importsService.saveImportTemplate('ws1', {
      workspaceId: 'ws1', name: 'Wrong account', sourceType: 'CSV', headerSignature: ['Date'],
      mapping: { dateField: 'Date', descriptionField: 'Description', amountField: 'Amount' },
      defaultAccountId: 'acc-3',
    }),
    /selected workspace/i
  );
  const updated = await importsService.saveImportTemplate('ws1', {
    id: 'tpl-1',
    workspaceId: 'ws1',
    name: 'Updated template',
    sourceType: 'CSV',
    headerSignature: ['Date'],
    mapping: { dateField: 'Date', descriptionField: 'Description', amountField: 'Amount' },
    defaultAccountId: 'acc-1',
  });
  assert.equal(updated.name, 'Updated template');
});

test('rule mutations are scoped and cross-workspace account references are rejected', async () => {
  await assert.rejects(
    () => rules.saveRule('ws2', {
      id: 'rule-1', workspaceId: 'ws2', match: { accountId: 'acc-3' },
      action: { type: 'Expense' }, createdAt: new Date(now),
    }),
    /workspace/i
  );
  await assert.rejects(
    () => rules.saveRule('ws1', {
      workspaceId: 'ws1', match: { accountId: 'acc-3' },
      action: { type: 'Expense' }, createdAt: new Date(now),
    }),
    /selected workspace/i
  );
  await assert.rejects(() => rules.deleteRule('ws2', 'rule-1'), /workspace/i);

  await assert.rejects(
    () => rules.saveRule('ws1', {
      workspaceId: 'ws1', match: { descriptionContains: 'coffee' },
      action: { categoryId: 'global-category-no-longer-supported' }, createdAt: new Date(now),
    }),
    /Category not found in the selected workspace/i
  );
});

test('budgets use globally unique new IDs and preserve legacy year-ID lookup', async () => {
  const legacy = await budgets.ensureBudget('ws1', 2025);
  const business = await budgets.ensureBudget('ws2', 2025);
  assert.equal(legacy.id, '2025');
  assert.notEqual(business.id, '2025');
  assert.notEqual(business.id, legacy.id);
  assert.equal((await budgets.getBudget('ws1', 2025)).budget?.id, '2025');
  assert.equal((await budgets.getBudget('ws2', 2025)).budget?.id, business.id);
});

test('concurrent budget creation still produces one header per workspace and year', async () => {
  const created = await Promise.all([
    budgets.ensureBudget('ws2', 2026),
    budgets.ensureBudget('ws2', 2026),
    budgets.ensureBudget('ws2', 2026),
  ]);
  assert.equal(new Set(created.map((budget) => budget.id)).size, 1);
  const records = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'budgets.json'), 'utf8'));
  assert.equal(
    records.filter((record: any) =>
      record.workspaceId === 'ws2' && record.year === 2026 && record.recordType !== 'line'
    ).length,
    1
  );
});

test('duplicate budgets for the same workspace and year are rejected', async () => {
  const records = fixture().budgets;
  records.push({
    id: 'budget-duplicate', workspaceId: 'ws1', year: 2025,
    createdFromSampleMonths: 3, samplePeriodFrom: '2025-01', samplePeriodTo: '2025-12', createdAt: now,
  });
  fs.writeFileSync(path.join(dataDirectory, 'budgets.json'), JSON.stringify(records, null, 2));
  await assert.rejects(() => budgets.ensureBudget('ws1', 2025), /More than one budget/i);
});
