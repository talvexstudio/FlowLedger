import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isWorkspaceResponseCurrent } from './workspace-client-state';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowledger-workspace-integrity-'));
const dataDirectory = path.join(root, 'data');
const now = '2026-10-07T10:00:00.000Z';

const category = (id: string, subId: string, workspaceId: string) => ({
  id,
  workspaceId,
  name: `${workspaceId} category`,
  type: 'expense',
  order: 1,
  isSystem: false,
  isActive: true,
  subcategories: [{
    id: subId,
    workspaceId,
    categoryId: id,
    name: `${workspaceId} subcategory`,
    order: 1,
    isSystem: false,
    isActive: true,
    flowType: 'Expense',
  }],
});

const transaction = (
  id: string,
  workspaceId: string,
  accountId: string,
  overrides: Record<string, unknown> = {}
): any => ({
  id,
  workspaceId,
  accountId,
  date: '2026-10-07',
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
  ...overrides,
});

const fixture = (): Record<string, any[]> => ({
  workspaces: [
    { id: 'ws1', ownerUserId: 'local', name: 'Personal', baseCurrency: 'EUR', createdAt: now, updatedAt: now },
    { id: 'ws2', ownerUserId: 'local', name: 'Business', baseCurrency: 'EUR', createdAt: now, updatedAt: now },
  ],
  accounts: [
    { id: 'acc-personal', workspaceId: 'ws1', name: 'Personal bank', type: 'bank', currency: 'EUR', institution: 'Bank', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
    { id: 'acc-cash', workspaceId: 'ws1', name: 'Personal cash', type: 'cash', currency: 'EUR', institution: 'Cash', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
    { id: 'acc-business', workspaceId: 'ws2', name: 'Business bank', type: 'bank', currency: 'EUR', institution: 'Bank', openingBalance: 0, archived: false, createdAt: now, updatedAt: now },
  ],
  categories: [
    category('cat-personal', 'sub-personal', 'ws1'),
    category('cat-business', 'sub-business', 'ws2'),
    {
      id: 'cat-legacy', name: 'Legacy ws1', type: 'expense', order: 2, isSystem: false, isActive: true,
      subcategories: [{ id: 'sub-legacy', categoryId: 'cat-legacy', name: 'Legacy', order: 1, isSystem: false, isActive: true, flowType: 'Expense' }],
    },
  ],
  imports: [
    { id: 'imp-personal', workspaceId: 'ws1', accountId: 'acc-personal', createdAt: now, fileName: 'personal.csv', sourceType: 'CSV', template: 'Manual', transactionCount: 1 },
    { id: 'imp-business', workspaceId: 'ws2', accountId: 'acc-business', createdAt: now, fileName: 'business.csv', sourceType: 'CSV', template: 'Manual', transactionCount: 1 },
  ],
  importTemplates: [
    { id: 'tpl-personal', workspaceId: 'ws1', name: 'Personal CSV', sourceType: 'CSV', headerSignature: ['Date'], mapping: { dateField: 'Date', descriptionField: 'Description', amountField: 'Amount' }, defaultAccountId: 'acc-personal', createdAt: now },
    { id: 'tpl-business', workspaceId: 'ws2', name: 'Business CSV', sourceType: 'CSV', headerSignature: ['Date'], mapping: { dateField: 'Date', descriptionField: 'Description', amountField: 'Amount' }, defaultAccountId: 'acc-business', createdAt: now },
  ],
  budgets: [
    { id: 'budget-personal', workspaceId: 'ws1', year: 2026, createdFromSampleMonths: 3, samplePeriodFrom: '2026-01', samplePeriodTo: '2026-12', createdAt: now },
    { id: 'line-personal', recordType: 'line', workspaceId: 'ws1', year: 2026, budgetId: 'budget-personal', type: 'Expense', categoryId: 'cat-personal', subcategoryId: 'sub-personal', totalSample: 10, monthlyAverage: 10, annualBudget: 120, percentageOfType: 100 },
    { id: 'budget-business', workspaceId: 'ws2', year: 2026, createdFromSampleMonths: 3, samplePeriodFrom: '2026-01', samplePeriodTo: '2026-12', createdAt: now },
    { id: 'line-business', recordType: 'line', workspaceId: 'ws2', year: 2026, budgetId: 'budget-business', type: 'Expense', categoryId: 'cat-business', subcategoryId: 'sub-business', totalSample: 20, monthlyAverage: 20, annualBudget: 240, percentageOfType: 100 },
  ],
  rules: [
    { id: 'rule-personal', workspaceId: 'ws1', match: { accountId: 'acc-personal' }, action: { categoryId: 'cat-personal', subcategoryId: 'sub-personal', type: 'Expense' }, createdFromTransactionId: 'missing-soft-transaction', createdAt: now },
    { id: 'rule-business', workspaceId: 'ws2', match: { accountId: 'acc-business' }, action: { categoryId: 'cat-business', subcategoryId: 'sub-business', type: 'Expense' }, createdAt: now },
  ],
  transactions: [
    transaction('tx-personal', 'ws1', 'acc-personal', { importId: 'imp-personal', categoryId: 'cat-personal', subcategoryId: 'sub-personal', potentialDuplicateMatch: { transactionId: 'missing-soft-duplicate', date: '2026-10-07', description: 'Historical', amountBase: -10 } }),
    transaction('tx-business', 'ws2', 'acc-business', { importId: 'imp-business', categoryId: 'cat-business', subcategoryId: 'sub-business' }),
    transaction('tx-transfer-out', 'ws1', 'acc-personal', { amountOriginal: -50, amountBase: -50, type: 'InternalTransfer', isInternalTransfer: true, internalDirection: 'Out', destinationAccountId: 'acc-cash', linkedTransactionId: 'tx-transfer-in' }),
    transaction('tx-transfer-in', 'ws1', 'acc-cash', { amountOriginal: 50, amountBase: 50, type: 'InternalTransfer', isInternalTransfer: true, internalDirection: 'In', destinationAccountId: 'acc-personal', linkedTransactionId: 'tx-transfer-out' }),
  ],
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

const cloneFixture = () => JSON.parse(JSON.stringify(fixture())) as Record<string, any[]>;

const writeFixture = (stores = fixture()) => {
  fs.mkdirSync(dataDirectory, { recursive: true });
  for (const [key, filename] of Object.entries(filenames)) {
    fs.writeFileSync(path.join(dataDirectory, filename), JSON.stringify(stores[key], null, 2));
  }
};

let accounts: typeof import('./services/accounts');
let categories: typeof import('./services/categories');
let imports: typeof import('./services/imports');
let rules: typeof import('./services/rules');
let budgets: typeof import('./services/budgets');
let transactions: typeof import('./services/transactions');
let storeState: typeof import('./data-management/store-state');

test.before(async () => {
  process.env.FLOWLEDGER_DATA_DIR = dataDirectory;
  [accounts, categories, imports, rules, budgets, transactions, storeState] = await Promise.all([
    import('./services/accounts'),
    import('./services/categories'),
    import('./services/imports'),
    import('./services/rules'),
    import('./services/budgets'),
    import('./services/transactions'),
    import('./data-management/store-state'),
  ]);
});

test.beforeEach(() => writeFixture());

test.after(() => {
  delete process.env.FLOWLEDGER_DATA_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

test('workspace-owned creation rejects a nonexistent workspace', async () => {
  await assert.rejects(() => accounts.saveAccount('missing', { name: 'No owner' }), /Workspace not found/i);
  await assert.rejects(() => transactions.saveTransaction('missing', transaction('new', 'missing', 'acc-personal')), /Workspace not found/i);
  await assert.rejects(() => imports.saveImportSession('missing', { workspaceId: 'missing', accountId: 'acc-personal', createdAt: new Date(now), fileName: 'x.csv', sourceType: 'CSV', template: 'Manual', transactionCount: 0 }), /Workspace not found/i);
  await assert.rejects(() => imports.saveImportTemplate('missing', { workspaceId: 'missing', name: 'No owner', sourceType: 'CSV', headerSignature: [], mapping: { dateField: 'Date', descriptionField: 'Description' } }), /Workspace not found/i);
  await assert.rejects(() => rules.saveRule('missing', { workspaceId: 'missing', match: {}, action: {}, createdAt: new Date(now) }), /Workspace not found/i);
  await assert.rejects(() => budgets.ensureBudget('missing', 2026), /Workspace not found/i);
});

test('normal reads are isolated for every workspace-owned store', async () => {
  assert.deepEqual((await accounts.getAccounts('ws1')).map((item) => item.id).sort(), ['acc-cash', 'acc-personal']);
  assert.deepEqual((await transactions.getTransactions('ws1')).map((item) => item.id).sort(), ['tx-personal', 'tx-transfer-in', 'tx-transfer-out']);
  assert.deepEqual((await categories.getCategories('ws1')).map((item) => item.id).sort(), ['cat-legacy', 'cat-personal']);
  assert.deepEqual((await rules.getRules('ws1')).map((item) => item.id), ['rule-personal']);
  assert.deepEqual((await imports.getImportSessions('ws1')).map((item) => item.id), ['imp-personal']);
  assert.deepEqual((await imports.getImportTemplates('ws1')).map((item) => item.id), ['tpl-personal']);
  assert.equal((await budgets.getBudget('ws1', 2026)).budget?.id, 'budget-personal');
  assert.equal((await budgets.getBudget('ws2', 2026)).budget?.id, 'budget-business');
});

test('transaction mutations reject cross-workspace hard references', async () => {
  const base = transaction('new', 'ws1', 'acc-personal');
  await assert.rejects(() => transactions.saveTransaction('ws1', { ...base, id: undefined, accountId: 'acc-business' }), /Transaction account/i);
  await assert.rejects(() => transactions.saveTransaction('ws1', {
    ...base,
    id: undefined,
    type: 'InternalTransfer',
    isInternalTransfer: true,
    internalDirection: 'Out',
    destinationAccountId: 'acc-business',
  }), /Counterpart account/i);
  await assert.rejects(() => transactions.saveTransaction('ws1', { ...base, id: undefined, importId: 'imp-business' }), /Import session/i);
  await assert.rejects(() => transactions.saveTransaction('ws1', { ...base, id: undefined, categoryId: 'cat-business', subcategoryId: 'sub-business' }), /Category not found/i);
  await assert.rejects(() => transactions.saveTransaction('ws1', { ...base, id: undefined, categoryId: 'cat-personal', subcategoryId: 'sub-business' }), /Subcategory does not belong/i);
});

test('direct transaction writes cannot manufacture a one-sided linked pair', async () => {
  await assert.rejects(
    () => transactions.saveTransaction('ws1', {
      ...transaction('new-linked', 'ws1', 'acc-personal'),
      id: undefined,
      type: 'InternalTransfer',
      isInternalTransfer: true,
      internalDirection: 'Out',
      destinationAccountId: 'acc-cash',
      linkedTransactionId: 'tx-transfer-in',
    }),
    /dedicated transfer-pair operation/i
  );
});

test('imports and templates enforce same-workspace account ownership', async () => {
  await assert.rejects(() => imports.saveImportSession('ws1', { workspaceId: 'ws1', accountId: 'acc-business', createdAt: new Date(now), fileName: 'wrong.csv', sourceType: 'CSV', template: 'Manual', transactionCount: 0 }), /selected workspace/i);
  await assert.rejects(() => imports.saveImportTemplate('ws1', { workspaceId: 'ws1', name: 'Wrong', sourceType: 'CSV', headerSignature: [], mapping: { dateField: 'Date', descriptionField: 'Description' }, defaultAccountId: 'acc-business' }), /selected workspace/i);
  await assert.rejects(() => imports.deleteImportSession('ws1', 'imp-personal'), /still has transactions/i);

  const halfLinked = cloneFixture();
  halfLinked.transactions.find((item) => item.id === 'tx-transfer-out').importId = 'imp-personal';
  writeFixture(halfLinked);
  await assert.rejects(
    () => transactions.deleteTransactionsByImport('ws1', 'imp-personal'),
    /one leg of a linked transfer/i
  );
});

test('rules enforce workspace ownership during save and application while provenance stays soft', async () => {
  await assert.rejects(() => rules.saveRule('ws1', { workspaceId: 'ws1', match: { accountId: 'acc-business' }, action: {}, createdAt: new Date(now) }), /selected workspace/i);
  await assert.rejects(() => rules.saveRule('ws1', { workspaceId: 'ws1', match: {}, action: { categoryId: 'cat-business', subcategoryId: 'sub-business' }, createdAt: new Date(now) }), /Category not found/i);

  const ws1Transaction = (await transactions.getTransaction('ws1', 'tx-personal'))!;
  const ws2Rule = (await rules.getRules('ws2'))[0];
  const classified = rules.applyRulesToTransaction(ws1Transaction, [ws2Rule]);
  assert.equal(classified.categoryId, ws1Transaction.categoryId);
  assert.equal(classified.subcategoryId, ws1Transaction.subcategoryId);
  assert.equal(classified.type, ws1Transaction.type);
  assert.equal(rules.ruleMatchesTransactionForBackfill(ws2Rule, ws1Transaction), false);
  await assert.rejects(
    async () => rules.applyRuleClassificationToTransaction(ws1Transaction, ws2Rule, await categories.getCategories('ws1')),
    /across workspaces/i
  );
  assert.doesNotThrow(() => storeState.validateCompleteStoreSet(fixture() as any));
});

test('InternalTransfer rules enforce direction and same-workspace counterpart ownership', async () => {
  const valid = await rules.saveRule('ws1', {
    workspaceId: 'ws1',
    match: { descriptionContains: 'LEV', matchMode: 'starts_with', accountId: 'acc-personal' },
    action: {
      type: 'InternalTransfer',
      internalDirection: 'Out',
      destinationAccountId: 'acc-cash',
    },
    createdFromTransactionId: 'tx-personal',
    createdAt: new Date(now),
  });
  assert.equal(valid.action.destinationAccountId, 'acc-cash');
  await assert.rejects(() => rules.saveRule('ws1', {
    workspaceId: 'ws1',
    match: { descriptionContains: 'LEV', accountId: 'acc-personal' },
    action: { type: 'InternalTransfer', destinationAccountId: 'acc-cash' },
    createdAt: new Date(now),
  }), /direction/i);
  await assert.rejects(() => rules.saveRule('ws1', {
    workspaceId: 'ws1',
    match: { descriptionContains: 'LEV', accountId: 'acc-personal' },
    action: { type: 'InternalTransfer', internalDirection: 'Out', destinationAccountId: 'acc-personal' },
    createdAt: new Date(now),
  }), /different/i);
  await assert.rejects(() => rules.saveRule('ws1', {
    workspaceId: 'ws1',
    match: { descriptionContains: 'LEV', accountId: 'acc-personal' },
    action: { type: 'InternalTransfer', internalDirection: 'Out', destinationAccountId: 'acc-business' },
    createdAt: new Date(now),
  }), /selected workspace/i);
});

test('budget lines enforce workspace category ownership and header consistency', async () => {
  await assert.rejects(() => budgets.saveBudgetLine('ws1', 2026, { type: 'Expense', categoryId: 'cat-business', subcategoryId: 'sub-business' }), /Category not found/i);
  const wrongYear = cloneFixture();
  wrongYear.budgets.find((item) => item.id === 'line-personal').year = 2025;
  assert.throws(() => storeState.validateCompleteStoreSet(wrongYear as any), /year does not match/i);

  const duplicate = cloneFixture();
  duplicate.budgets.push({ ...duplicate.budgets[0], id: 'budget-personal-duplicate' });
  assert.throws(() => storeState.validateCompleteStoreSet(duplicate as any), /same workspace and year/i);
  assert.doesNotThrow(() => storeState.validateCompleteStoreSet(fixture() as any));
});

test('account deletion protects all same-workspace hard account references while archive remains valid', async () => {
  await accounts.archiveAccount('ws1', 'acc-personal');
  assert.equal((await accounts.getAccount('ws1', 'acc-personal'))?.archived, true);
  await assert.rejects(() => accounts.deleteAccount('ws1', 'acc-cash'), /has transactions/i);

  for (const reference of ['imports', 'importTemplates', 'rules'] as const) {
    const stores = cloneFixture();
    stores.accounts.push({ ...stores.accounts[0], id: `acc-${reference}`, name: reference });
    if (reference === 'imports') stores.imports.push({ ...stores.imports[0], id: 'imp-extra', accountId: `acc-${reference}` });
    if (reference === 'importTemplates') stores.importTemplates.push({ ...stores.importTemplates[0], id: 'tpl-extra', defaultAccountId: `acc-${reference}` });
    if (reference === 'rules') stores.rules.push({ ...stores.rules[0], id: 'rule-extra', match: { accountId: `acc-${reference}` }, action: {} });
    writeFixture(stores);
    await assert.rejects(() => accounts.deleteAccount('ws1', `acc-${reference}`), /referenced by/i);
  }
});

test('complete-state validation rejects mixed-workspace contamination at every hard boundary', () => {
  const cases: Array<[string, (data: Record<string, any[]>) => void, RegExp]> = [
    ['missing workspace', (data) => { data.accounts[0].workspaceId = 'missing'; }, /missing workspace/i],
    ['transaction account', (data) => { data.transactions[0].accountId = 'acc-business'; }, /account belongs to a different workspace/i],
    ['destination account', (data) => { data.transactions[2].destinationAccountId = 'acc-business'; }, /counterpart belongs to a different workspace/i],
    ['import account', (data) => { data.imports[0].accountId = 'acc-business'; }, /import account belongs to a different workspace/i],
    ['template account', (data) => { data.importTemplates[0].defaultAccountId = 'acc-business'; }, /template account belongs to a different workspace/i],
    ['transaction import', (data) => { data.transactions[0].importId = 'imp-business'; }, /transaction import belongs to a different workspace/i],
    ['transaction category', (data) => { data.transactions[0].categoryId = 'cat-business'; data.transactions[0].subcategoryId = 'sub-business'; }, /category belongs to a different workspace/i],
    ['transaction subcategory', (data) => { data.transactions[0].subcategoryId = 'sub-business'; }, /subcategory that does not belong/i],
    ['rule account', (data) => { data.rules[0].match.accountId = 'acc-business'; }, /rule account belongs to a different workspace/i],
    ['rule category', (data) => { data.rules[0].action.categoryId = 'cat-business'; data.rules[0].action.subcategoryId = 'sub-business'; }, /rule category belongs to a different workspace/i],
    ['budget category', (data) => { data.budgets[1].categoryId = 'cat-business'; data.budgets[1].subcategoryId = 'sub-business'; }, /budget line category belongs to a different workspace/i],
    ['linked transaction', (data) => { data.transactions[2].linkedTransactionId = 'tx-business'; }, /linked InternalTransfer pair/i],
  ];

  for (const [label, mutate, expected] of cases) {
    const data = cloneFixture();
    mutate(data);
    assert.throws(() => storeState.validateCompleteStoreSet(data as any), expected, label);
  }
});

test('legacy categories are ws1-only and valid same-workspace linked/unpaired transfers pass', () => {
  const valid = cloneFixture();
  valid.transactions.push(transaction('tx-legacy', 'ws1', 'acc-personal', { categoryId: 'cat-legacy', subcategoryId: 'sub-legacy' }));
  valid.transactions.push(transaction('tx-unpaired', 'ws1', 'acc-personal', { amountOriginal: -25, amountBase: -25, type: 'InternalTransfer', isInternalTransfer: true, internalDirection: 'Out', destinationAccountId: 'acc-cash' }));
  assert.doesNotThrow(() => storeState.validateCompleteStoreSet(valid as any));

  valid.transactions[valid.transactions.length - 2].workspaceId = 'ws2';
  valid.transactions[valid.transactions.length - 2].accountId = 'acc-business';
  assert.throws(() => storeState.validateCompleteStoreSet(valid as any), /category belongs to a different workspace/i);
});

test('stale client responses are rejected after a workspace switch', () => {
  assert.equal(isWorkspaceResponseCurrent('ws1', 'ws1'), true);
  assert.equal(isWorkspaceResponseCurrent('ws2', 'ws1'), false);
  assert.equal(isWorkspaceResponseCurrent(null, 'ws1'), false);
});
