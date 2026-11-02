import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertTransactionDeletionAllowed } from './services/transactions';
import { deleteTransactionAndReload } from './transaction-delete-client';

test('confirmed deletion uses the existing API path before refreshing transactions', async () => {
  const calls: string[] = [];
  await deleteTransactionAndReload('ws1', 'tx-review', {
    deleteTransaction: async (workspaceId, transactionId) => {
      calls.push(`delete:${workspaceId}:${transactionId}`);
    },
    reloadTransactions: async () => {
      calls.push('reload');
    },
  });

  assert.deepEqual(calls, ['delete:ws1:tx-review', 'reload']);
});

test('a rejected deletion preserves the server error and does not refresh away the row', async () => {
  let reloadCount = 0;
  await assert.rejects(
    () => deleteTransactionAndReload('ws1', 'tx-linked', {
      deleteTransaction: async () => {
        throw new Error('A single leg of a linked transfer cannot be deleted.');
      },
      reloadTransactions: async () => {
        reloadCount += 1;
      },
    }),
    /single leg of a linked transfer/
  );
  assert.equal(reloadCount, 0);
});

test('the existing linked InternalTransfer deletion safeguard remains authoritative', () => {
  assert.throws(
    () => assertTransactionDeletionAllowed({ linkedTransactionId: 'tx-counterpart' }),
    /single leg of a linked transfer/
  );
});

test('Dashboard review rows expose direct Edit, Approve, Delete actions and a shared confirmation dialog', () => {
  const source = readFileSync(
    new URL('../components/dashboard/review-transactions.tsx', import.meta.url),
    'utf8'
  );
  const edit = source.indexOf('<span className="sr-only">Edit</span>');
  const approve = source.indexOf('<span className="sr-only">Approve</span>');
  const remove = source.indexOf('<span className="sr-only">Delete</span>');

  assert.ok(edit >= 0);
  assert.ok(approve > edit);
  assert.ok(remove > approve);
  assert.match(source, /<TransactionDeleteDialog/);
  assert.doesNotMatch(source, /apiDeleteTransaction/);
});

test('the shared dialog requires explicit confirmation and retains cancel behavior', () => {
  const source = readFileSync(
    new URL('../components/transactions/transaction-delete-dialog.tsx', import.meta.url),
    'utf8'
  );

  assert.match(source, /<AlertDialogCancel/);
  assert.match(source, /Delete this transaction\?/);
  assert.match(source, /onClick=\{handleConfirm\}/);
  assert.match(source, /deleteTransactionAndReload/);
});
