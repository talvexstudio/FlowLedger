import assert from 'node:assert/strict';
import test from 'node:test';
import { STORE_VALIDATORS } from './data-management/store-validation';
import {
  TRANSACTION_COMMENTS_MAX_LENGTH,
  TRANSACTION_TABLE_COLUMN_LABELS,
  getTransactionCommentDisplay,
  normalizeTransactionComments,
  normalizeTransactionCommentsValue,
} from './transaction-comments';

const persistedTransaction = (overrides: Record<string, unknown> = {}) => ({
  id: 'tx-1',
  workspaceId: 'ws1',
  accountId: 'acc-1',
  date: '2026-10-08T10:00:00.000Z',
  description: 'Transaction',
  rawDescription: 'TRANSACTION',
  amountOriginal: -10,
  currencyOriginal: 'EUR',
  amountBase: -10,
  type: 'Expense',
  needsReview: false,
  isInternalTransfer: false,
  isPotentialDuplicate: false,
  isInconsistent: false,
  createdAt: '2026-10-08T10:00:00.000Z',
  updatedAt: '2026-10-08T10:00:00.000Z',
  ...overrides,
});

test('legacy transactions without comments remain valid', () => {
  assert.doesNotThrow(() => STORE_VALIDATORS.transactions([persistedTransaction()]));
});

test('comments are trimmed and blank comments become absent', () => {
  assert.equal(normalizeTransactionCommentsValue('  Check invoice  '), 'Check invoice');
  assert.equal(normalizeTransactionCommentsValue('   \n  '), undefined);
  assert.deepEqual(
    normalizeTransactionComments({ id: 'tx-1', comments: '   ' }),
    { id: 'tx-1' }
  );
});

test('non-string and over-limit comments are rejected', () => {
  assert.throws(() => normalizeTransactionCommentsValue(42), /plain text/i);
  assert.throws(
    () => normalizeTransactionCommentsValue('x'.repeat(TRANSACTION_COMMENTS_MAX_LENGTH + 1)),
    /characters or fewer/i
  );
  assert.throws(
    () => STORE_VALIDATORS.transactions([
      persistedTransaction({ comments: 'x'.repeat(TRANSACTION_COMMENTS_MAX_LENGTH + 1) }),
    ]),
    /comments/i
  );
});

test('persisted comments validate and table cells display text or remain blank', () => {
  assert.doesNotThrow(() => STORE_VALIDATORS.transactions([
    persistedTransaction({ comments: 'Annual insurance payment' }),
  ]));
  assert.equal(getTransactionCommentDisplay('Annual insurance payment'), 'Annual insurance payment');
  assert.equal(getTransactionCommentDisplay('  '), '');
  assert.equal(getTransactionCommentDisplay(undefined), '');
});

test('transaction table labels place Comments between Category and Amount', () => {
  assert.deepEqual(TRANSACTION_TABLE_COLUMN_LABELS, [
    'Date',
    'Account',
    'Description',
    'Category',
    'Comments',
    'Amount',
    'Actions',
  ]);
});
