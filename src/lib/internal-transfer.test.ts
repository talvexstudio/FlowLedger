import test from 'node:test';
import assert from 'node:assert/strict';
import type { Account, ClassificationRule, Transaction } from './types';
import {
  getInternalTransferDisplay,
  getSelectableAccounts,
  getTransactionTypeChangePatch,
  matchesCategoryFilter,
  normalizeTransactionTypeFields,
  shouldCreateInternalTransferPair,
  validateInternalTransfer,
} from './internal-transfer';
import { createInternalTransferPair } from './services/transactions';
import {
  isTransactionSufficientlyClassified,
  prepareImportTransactions,
  type ImportSourceRow,
} from './import-processing';
import {
  applyRuleClassificationToTransaction,
  applyRulesToTransaction,
} from './utils/rule-utils';
import {
  calculateAccountBalance,
  isConfirmedExpense,
  isConfirmedIncome,
} from './transaction-reporting';

const account = (
  id: string,
  name: string,
  workspaceId = 'ws1',
  archived = false,
  openingBalance = 0
): Account => ({
  id,
  workspaceId,
  name,
  type: 'bank',
  currency: 'EUR',
  institution: 'Test Bank',
  openingBalance,
  archived,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
});

const accounts = [
  account('acc-a', 'Account A', 'ws1', false, 1000),
  account('acc-b', 'Account B', 'ws1', false, 100),
];

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1',
  workspaceId: 'ws1',
  accountId: 'acc-a',
  date: new Date('2026-09-22'),
  description: 'Transfer',
  rawDescription: 'TRANSFER',
  amountOriginal: -500,
  currencyOriginal: 'EUR',
  amountBase: -500,
  type: 'InternalTransfer',
  needsReview: false,
  isInternalTransfer: true,
  internalDirection: 'Out',
  destinationAccountId: 'acc-b',
  isPotentialDuplicate: false,
  isInconsistent: false,
  createdAt: new Date('2026-09-22'),
  updatedAt: new Date('2026-09-22'),
  ...overrides,
});

const createPair = async (direction: 'Out' | 'In') => {
  const stored = new Map<string, Partial<Transaction>>();
  let nextId = 1;
  const result = await createInternalTransferPair('ws1', {
    workspaceId: 'ws1',
    accountId: 'acc-a',
    date: new Date('2026-09-22'),
    description: 'Move money',
    rawDescription: 'MOVE MONEY',
    amountBase: 500,
    amountOriginal: 500,
    currencyOriginal: 'EUR',
    type: 'InternalTransfer',
    internalDirection: direction,
    destinationAccountId: 'acc-b',
    needsReview: false,
    isInternalTransfer: true,
    isPotentialDuplicate: false,
    isInconsistent: false,
  }, {
    getAccounts: async () => accounts,
    saveTransaction: async (_workspaceId, data) => {
      const saved = { ...data, id: `tx-${nextId++}` };
      stored.set(saved.id, saved);
      return saved;
    },
    linkSource: async (_workspaceId, sourceId, destinationId) => {
      stored.set(sourceId, { ...stored.get(sourceId), linkedTransactionId: destinationId });
    },
  });
  return { result, stored };
};

test('new manual Out transfer creates an opposite-signed linked In pair', async () => {
  const { result } = await createPair('Out');
  assert.equal(result.source.amountBase, -500);
  assert.equal(result.source.internalDirection, 'Out');
  assert.equal(result.source.destinationAccountId, 'acc-b');
  assert.equal(result.destination.amountBase, 500);
  assert.equal(result.destination.internalDirection, 'In');
  assert.equal(result.destination.destinationAccountId, 'acc-a');
  assert.equal(result.source.linkedTransactionId, result.destination.id);
  assert.equal(result.destination.linkedTransactionId, result.source.id);
});

test('new manual In transfer creates the reciprocal Out pair', async () => {
  const { result } = await createPair('In');
  assert.equal(result.source.amountBase, 500);
  assert.equal(result.source.internalDirection, 'In');
  assert.equal(result.destination.amountBase, -500);
  assert.equal(result.destination.internalDirection, 'Out');
});

test('same-account and cross-workspace counterparts are rejected', async () => {
  const base = transaction({ id: undefined as unknown as string });
  assert.equal(
    validateInternalTransfer({ ...base, destinationAccountId: 'acc-a' }, accounts, 'ws1').valid,
    false
  );
  assert.equal(
    validateInternalTransfer(
      { ...base, destinationAccountId: 'acc-x' },
      [...accounts, account('acc-x', 'Other workspace', 'ws2')],
      'ws1'
    ).valid,
    false
  );
  await assert.rejects(
    () => createInternalTransferPair('ws1', { ...base, destinationAccountId: 'acc-a' }, {
      getAccounts: async () => accounts,
      saveTransaction: async () => { throw new Error('must not write'); },
      linkSource: async () => { throw new Error('must not link'); },
    }),
    /different from the current account/
  );
});

test('InternalTransfer classification requires direction and valid counterpart', () => {
  assert.equal(
    isTransactionSufficientlyClassified(
      transaction({ internalDirection: undefined, needsReview: true }),
      [],
      accounts,
      'ws1'
    ),
    false
  );
  assert.equal(
    isTransactionSufficientlyClassified(
      transaction({ destinationAccountId: undefined, needsReview: true }),
      [],
      accounts,
      'ws1'
    ),
    false
  );
  assert.equal(isTransactionSufficientlyClassified(transaction(), [], accounts, 'ws1'), true);
});

test('transaction type transitions clear fields that do not apply', () => {
  assert.deepEqual(getTransactionTypeChangePatch('Expense', 'InternalTransfer'), {
    type: 'InternalTransfer',
    categoryId: undefined,
    subcategoryId: undefined,
    isInternalTransfer: true,
  });
  assert.deepEqual(getTransactionTypeChangePatch('InternalTransfer', 'Expense'), {
    type: 'Expense',
    internalDirection: undefined,
    destinationAccountId: undefined,
    linkedTransactionId: undefined,
    isInternalTransfer: false,
  });
});

test('write normalization synchronizes isInternalTransfer and clears stale fields', () => {
  const transfer = normalizeTransactionTypeFields({
    type: 'InternalTransfer',
    categoryId: 'cat-transfers',
    subcategoryId: 'sub-transfers',
    isInternalTransfer: false,
  });
  assert.equal(transfer.isInternalTransfer, true);
  assert.equal(transfer.categoryId, undefined);
  assert.equal(transfer.subcategoryId, undefined);

  const expense = normalizeTransactionTypeFields({
    type: 'Expense',
    destinationAccountId: 'acc-b',
    internalDirection: 'Out',
    linkedTransactionId: 'tx-pair',
    isInternalTransfer: true,
  });
  assert.equal(expense.isInternalTransfer, false);
  assert.equal(expense.destinationAccountId, undefined);
  assert.equal(expense.internalDirection, undefined);
  assert.equal(expense.linkedTransactionId, undefined);
});

test('an existing/imported transaction is updated as one record rather than paired', () => {
  assert.equal(shouldCreateInternalTransferPair({ type: 'InternalTransfer' }), true);
  assert.equal(shouldCreateInternalTransferPair({ id: 'imported-1', type: 'InternalTransfer' }), false);
});

test('a rule-created InternalTransfer stays in review and clears categories', () => {
  const rule: ClassificationRule = {
    id: 'rule-transfer',
    workspaceId: 'ws1',
    match: { descriptionContains: 'move' },
    action: { type: 'InternalTransfer' },
    createdAt: new Date(),
  };
  const classified = applyRulesToTransaction({
    accountId: 'acc-a',
    description: 'Move money',
    amountBase: -10,
    type: 'Expense',
    categoryId: 'cat-expense',
    subcategoryId: 'sub-expense',
    needsReview: false,
  }, [rule]);
  assert.equal(classified.type, 'InternalTransfer');
  assert.equal(classified.needsReview, true);
  assert.equal(classified.categoryId, undefined);
  assert.equal(classified.subcategoryId, undefined);
  assert.equal(classified.isInternalTransfer, true);
});

test('direct rule backfill cannot confirm an incomplete InternalTransfer', () => {
  const rule: ClassificationRule = {
    id: 'rule-transfer',
    workspaceId: 'ws1',
    match: { descriptionContains: 'move' },
    action: { type: 'InternalTransfer' },
    createdAt: new Date(),
  };
  const patch = applyRuleClassificationToTransaction(
    transaction({ type: 'Expense', isInternalTransfer: false, destinationAccountId: undefined, internalDirection: undefined }),
    rule,
    []
  );
  assert.equal(patch.type, 'InternalTransfer');
  assert.equal(patch.needsReview, true);
  assert.equal(patch.isInternalTransfer, true);
});

test('import preparation keeps a rule-suggested InternalTransfer in review', () => {
  const rows: ImportSourceRow[] = [{
    rowNumber: 2,
    values: { Date: '22/09/2026', Description: 'Move money', Amount: '-10.00' },
  }];
  const rule: ClassificationRule = {
    id: 'rule-transfer',
    workspaceId: 'ws1',
    match: { descriptionContains: 'move' },
    action: { type: 'InternalTransfer' },
    createdAt: new Date(),
  };
  const prepared = prepareImportTransactions(rows, {
    dateField: 'Date',
    descriptionField: 'Description',
    amountField: 'Amount',
    dateFormat: 'dd/MM/yyyy',
    amountOptions: { decimalSeparator: '.', thousandsSeparator: ',' },
  }, 'CSV', { workspaceId: 'ws1', accountId: 'acc-a' }, [rule], []);
  assert.equal(prepared.transactions[0].type, 'InternalTransfer');
  assert.equal(prepared.transactions[0].needsReview, true);
});

test('the existing Internal Transfers category option filters by type', () => {
  const pending = transaction({ id: 'pending', needsReview: true, categoryId: undefined });
  const confirmed = transaction({ id: 'confirmed', needsReview: false, categoryId: undefined });
  const pseudoCategoryExpense = transaction({
    id: 'expense',
    type: 'Expense',
    isInternalTransfer: false,
    categoryId: 'cat_transfers',
  });
  assert.equal(matchesCategoryFilter(pending, ['cat_transfers']), true);
  assert.equal(matchesCategoryFilter(confirmed, ['cat_transfers']), true);
  assert.equal(matchesCategoryFilter(pseudoCategoryExpense, ['cat_transfers']), false);
});

test('table display resolves transfer direction and counterpart name', () => {
  assert.equal(getInternalTransferDisplay(transaction(), accounts), 'Transfer → Account B');
  assert.equal(
    getInternalTransferDisplay(transaction({ internalDirection: 'In', destinationAccountId: 'acc-a' }), accounts),
    'Transfer ← Account A'
  );
  assert.equal(
    getInternalTransferDisplay(transaction({ destinationAccountId: 'missing' }), accounts),
    'Transfer → Unknown account'
  );
});

test('archived historical counterpart remains displayable but is not a new option', () => {
  const archived = account('acc-archived', 'Archived Savings', 'ws1', true);
  assert.deepEqual(
    getSelectableAccounts([...accounts, archived], archived.id).map((item) => item.id),
    ['acc-a', 'acc-b', 'acc-archived']
  );
  assert.deepEqual(
    getSelectableAccounts([...accounts, archived]).map((item) => item.id),
    ['acc-a', 'acc-b']
  );
});

test('InternalTransfer affects account balances but not income, expense, or budget predicates', async () => {
  const { result } = await createPair('Out');
  const source = transaction({ ...result.source, id: result.source.id as string });
  const destination = transaction({ ...result.destination, id: result.destination.id as string });
  assert.equal(calculateAccountBalance(accounts[0], [source, destination]), 500);
  assert.equal(calculateAccountBalance(accounts[1], [source, destination]), 600);
  assert.equal(isConfirmedIncome(source), false);
  assert.equal(isConfirmedExpense(source), false);
  assert.equal(isConfirmedIncome(destination), false);
  assert.equal(isConfirmedExpense(destination), false);
});
