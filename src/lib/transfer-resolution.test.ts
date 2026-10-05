import test from 'node:test';
import assert from 'node:assert/strict';
import type { Account, Transaction } from './types';
import { findPotentialTransfers } from './utils/duplicate-utils';
import { getInternalTransferPairingStatus, validateInternalTransfer } from './internal-transfer';
import {
  assertLinkedTransferMutationAllowed,
  assertTransactionDeletionAllowed,
  createCounterpartForExisting,
  findTransferCounterpartCandidates,
  linkExistingTransferPair,
  TransferCandidatesExistError,
  type TransferResolutionDependencies,
} from './services/transactions';

const account = (id: string, workspaceId = 'ws1', type: Account['type'] = 'bank'): Account => ({
  id,
  workspaceId,
  name: id,
  type,
  currency: 'EUR',
  institution: 'Test',
  openingBalance: 0,
  archived: false,
  createdAt: new Date('2026-01-01T12:00:00'),
  updatedAt: new Date('2026-01-01T12:00:00'),
});

const accounts = [
  account('acc-a'),
  account('acc-b'),
  account('acc-c'),
  account('acc-cash', 'ws1', 'cash'),
  account('acc-other-workspace', 'ws2'),
];

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'source',
  workspaceId: 'ws1',
  accountId: 'acc-a',
  date: new Date('2026-09-22T12:00:00'),
  description: 'Transfer',
  rawDescription: 'TRANSFER',
  amountOriginal: -700,
  currencyOriginal: 'EUR',
  amountBase: -700,
  type: 'InternalTransfer',
  needsReview: false,
  isInternalTransfer: true,
  internalDirection: 'Out',
  destinationAccountId: 'acc-b',
  isPotentialDuplicate: false,
  isPotentialTransfer: false,
  isInconsistent: false,
  createdAt: new Date('2026-09-22T12:00:00'),
  updatedAt: new Date('2026-09-22T12:00:00'),
  ...overrides,
});

type HarnessOptions = {
  failWriteCalls?: number[];
};

const createHarness = (initial: Transaction[], options: HarnessOptions = {}) => {
  const stored = new Map(initial.map((item) => [item.id, { ...item }]));
  const deleted: string[] = [];
  let writeCount = 0;
  let createCount = 0;

  const dependencies: TransferResolutionDependencies = {
    getTransaction: async (workspaceId, transactionId) => {
      const item = stored.get(transactionId);
      return item?.workspaceId === workspaceId ? { ...item } : null;
    },
    getTransactions: async (workspaceId) => [...stored.values()]
      .filter((item) => item.workspaceId === workspaceId)
      .map((item) => ({ ...item })),
    getAccounts: async () => accounts,
    writeTransaction: async (_workspaceId, item) => {
      writeCount += 1;
      if (options.failWriteCalls?.includes(writeCount)) {
        throw new Error(`write ${writeCount} failed`);
      }
      stored.set(item.id, { ...item });
      return { ...item };
    },
    createTransaction: async (workspaceId, item) => {
      createCount += 1;
      const now = new Date('2026-09-23T12:00:00');
      const created = transaction({
        ...item,
        id: `created-${createCount}`,
        workspaceId,
        createdAt: now,
        updatedAt: now,
      });
      stored.set(created.id, created);
      return { ...created };
    },
    deleteCreatedTransaction: async (_workspaceId, transactionId) => {
      deleted.push(transactionId);
      stored.delete(transactionId);
    },
  };

  return {
    stored,
    deleted,
    dependencies,
    get writeCount() { return writeCount; },
    get createCount() { return createCount; },
  };
};

test('candidate matching accepts exact and +/- one calendar day and ranks deterministically', () => {
  const source = transaction();
  const candidates = [
    transaction({ id: 'exact-b', accountId: 'acc-b', amountBase: 700, amountOriginal: 700, type: 'Income', isInternalTransfer: false, internalDirection: undefined, destinationAccountId: undefined }),
    transaction({ id: 'next-day', accountId: 'acc-b', date: new Date('2026-09-23T23:30:00'), amountBase: 700, amountOriginal: 700, type: 'Expense', isInternalTransfer: false, internalDirection: undefined, destinationAccountId: undefined }),
    transaction({ id: 'exact-a', accountId: 'acc-b', amountBase: 700, amountOriginal: 700, type: 'Expense', isInternalTransfer: false, internalDirection: undefined, destinationAccountId: undefined }),
    transaction({ id: 'previous-day', accountId: 'acc-b', date: new Date('2026-09-21T00:01:00'), amountBase: 700, amountOriginal: 700, type: 'Income', isInternalTransfer: false, internalDirection: undefined, destinationAccountId: undefined }),
    transaction({ id: 'too-far', accountId: 'acc-b', date: new Date('2026-09-24T12:00:00'), amountBase: 700, amountOriginal: 700 }),
  ];
  const matches = findPotentialTransfers(source, candidates, {
    workspaceId: 'ws1',
    counterpartAccountId: 'acc-b',
    sourceTransactionId: source.id,
    excludeLinked: true,
  });
  assert.deepEqual(matches.map((match) => match.existingTransaction.id), [
    'exact-a',
    'exact-b',
    'next-day',
    'previous-day',
  ]);
});

test('candidate matching excludes wrong account, same sign, different amount, and linked rows', () => {
  const source = transaction();
  const matches = findPotentialTransfers(source, [
    transaction({ id: 'wrong-account', accountId: 'acc-c', amountBase: 700 }),
    transaction({ id: 'same-sign', accountId: 'acc-b', amountBase: -700 }),
    transaction({ id: 'wrong-amount', accountId: 'acc-b', amountBase: 700.01 }),
    transaction({ id: 'linked', accountId: 'acc-b', amountBase: 700, linkedTransactionId: 'other' }),
  ], {
    workspaceId: 'ws1',
    counterpartAccountId: 'acc-b',
    sourceTransactionId: source.id,
    excludeLinked: true,
  });
  assert.deepEqual(matches, []);
});

test('pending, confirmed, ordinary, and unlinked InternalTransfer candidates are eligible', async () => {
  const source = transaction();
  const candidates = [
    transaction({ id: 'confirmed', accountId: 'acc-b', amountBase: 700, type: 'Income', isInternalTransfer: false, internalDirection: undefined, destinationAccountId: undefined, needsReview: false }),
    transaction({ id: 'pending', accountId: 'acc-b', amountBase: 700, type: 'Expense', isInternalTransfer: false, internalDirection: undefined, destinationAccountId: undefined, needsReview: true }),
    transaction({ id: 'transfer', accountId: 'acc-b', amountBase: 700, internalDirection: 'In', destinationAccountId: 'acc-a' }),
  ];
  const harness = createHarness([source, ...candidates]);
  const result = await findTransferCounterpartCandidates('ws1', source.id, harness.dependencies);
  assert.deepEqual(result.map((item) => item.transaction.id), ['confirmed', 'pending', 'transfer']);
});

test('link existing converts and reciprocally links both records without creating a third', async () => {
  const source = transaction({ categoryId: 'stale-source', subcategoryId: 'stale-sub' });
  const candidate = transaction({
    id: 'candidate',
    accountId: 'acc-b',
    amountBase: 700,
    amountOriginal: 700,
    type: 'Income',
    isInternalTransfer: false,
    internalDirection: undefined,
    destinationAccountId: undefined,
    categoryId: 'income',
    subcategoryId: 'salary',
    needsReview: true,
  });
  const harness = createHarness([source, candidate]);
  const result = await linkExistingTransferPair('ws1', source.id, candidate.id, harness.dependencies);
  assert.equal(harness.stored.size, 2);
  assert.equal(result.source.linkedTransactionId, candidate.id);
  assert.equal(result.counterpart.linkedTransactionId, source.id);
  assert.equal(result.source.destinationAccountId, 'acc-b');
  assert.equal(result.counterpart.destinationAccountId, 'acc-a');
  assert.equal(result.source.internalDirection, 'Out');
  assert.equal(result.counterpart.internalDirection, 'In');
  assert.equal(result.counterpart.type, 'InternalTransfer');
  assert.equal(result.counterpart.isInternalTransfer, true);
  assert.equal(result.source.categoryId, undefined);
  assert.equal(result.counterpart.categoryId, undefined);
  assert.equal(result.counterpart.subcategoryId, undefined);
  assert.equal(result.source.needsReview, false);
  assert.equal(result.counterpart.needsReview, false);
});

test('link existing restores both snapshots when the second write fails', async () => {
  const source = transaction();
  const candidate = transaction({ id: 'candidate', accountId: 'acc-b', amountBase: 700, amountOriginal: 700, type: 'Income', isInternalTransfer: false, internalDirection: undefined, destinationAccountId: undefined });
  const harness = createHarness([source, candidate], { failWriteCalls: [2] });
  await assert.rejects(
    () => linkExistingTransferPair('ws1', source.id, candidate.id, harness.dependencies),
    /both original transactions were restored/
  );
  assert.deepEqual(harness.stored.get(source.id), source);
  assert.deepEqual(harness.stored.get(candidate.id), candidate);
});

test('link existing rejects same-account, cross-workspace, amount, and sign mismatches', async () => {
  const cases = [
    transaction({ id: 'same-account', accountId: 'acc-a', amountBase: 700 }),
    transaction({ id: 'wrong-amount', accountId: 'acc-b', amountBase: 701 }),
    transaction({ id: 'same-sign', accountId: 'acc-b', amountBase: -700 }),
    transaction({ id: 'other-workspace', workspaceId: 'ws2', accountId: 'acc-other-workspace', amountBase: 700 }),
  ];
  for (const candidate of cases) {
    const source = transaction({ destinationAccountId: candidate.accountId });
    const harness = createHarness([source, candidate]);
    await assert.rejects(
      () => linkExistingTransferPair('ws1', source.id, candidate.id, harness.dependencies)
    );
  }
});

test('already-linked source and counterpart are rejected', async () => {
  const linkedSource = transaction({ linkedTransactionId: 'existing-pair' });
  const candidate = transaction({ id: 'candidate', accountId: 'acc-b', amountBase: 700, linkedTransactionId: 'other' });
  let harness = createHarness([linkedSource, candidate]);
  await assert.rejects(
    () => findTransferCounterpartCandidates('ws1', linkedSource.id, harness.dependencies),
    /already linked/
  );
  const source = transaction();
  harness = createHarness([source, candidate]);
  await assert.rejects(
    () => linkExistingTransferPair('ws1', source.id, candidate.id, harness.dependencies),
    /already linked/
  );
});

test('create counterpart adds only one reciprocal record and links the existing source', async () => {
  const source = transaction({ destinationAccountId: 'acc-cash' });
  const harness = createHarness([source]);
  const result = await createCounterpartForExisting('ws1', source.id, false, harness.dependencies);
  assert.equal(harness.createCount, 1);
  assert.equal(harness.stored.size, 2);
  assert.equal(result.source.id, source.id);
  assert.equal(result.source.linkedTransactionId, result.counterpart.id);
  assert.equal(result.counterpart.accountId, 'acc-cash');
  assert.equal(result.counterpart.destinationAccountId, 'acc-a');
  assert.equal(result.counterpart.amountBase, 700);
  assert.equal(result.counterpart.internalDirection, 'In');
  assert.equal(result.counterpart.linkedTransactionId, source.id);
  assert.equal(result.counterpart.description, 'Transfer: Transfer');
});

test('create counterpart removes the new record when linking the source fails', async () => {
  const source = transaction({ destinationAccountId: 'acc-cash' });
  const harness = createHarness([source], { failWriteCalls: [1] });
  await assert.rejects(
    () => createCounterpartForExisting('ws1', source.id, false, harness.dependencies),
    /no reciprocal transaction was retained/
  );
  assert.equal(harness.stored.size, 1);
  assert.deepEqual(harness.stored.get(source.id), source);
  assert.deepEqual(harness.deleted, ['created-1']);
});

test('create counterpart requires an explicit override when a candidate exists', async () => {
  const source = transaction();
  const candidate = transaction({ id: 'candidate', accountId: 'acc-b', amountBase: 700, amountOriginal: 700, type: 'Income', isInternalTransfer: false, internalDirection: undefined, destinationAccountId: undefined });
  const harness = createHarness([source, candidate]);
  await assert.rejects(
    () => createCounterpartForExisting('ws1', source.id, false, harness.dependencies),
    (error: unknown) => error instanceof TransferCandidatesExistError && error.candidates[0].id === candidate.id
  );
  assert.equal(harness.createCount, 0);
  const result = await createCounterpartForExisting('ws1', source.id, true, harness.dependencies);
  assert.equal(result.counterpart.id, 'created-1');
  assert.equal(harness.stored.size, 3);
});

test('keeping a valid transfer unpaired needs no mutation and remains financially valid', () => {
  const source = transaction({ linkedTransactionId: undefined });
  const before = { ...source };
  assert.equal(validateInternalTransfer(source, accounts, 'ws1').valid, true);
  assert.equal(getInternalTransferPairingStatus(source), 'Unpaired');
  assert.deepEqual(source, before);
});

test('pairing display status is derived only from linkedTransactionId', () => {
  assert.equal(getInternalTransferPairingStatus(transaction()), 'Unpaired');
  assert.equal(getInternalTransferPairingStatus(transaction({ linkedTransactionId: 'pair' })), 'Linked');
  assert.equal(getInternalTransferPairingStatus(transaction({ type: 'Expense', isInternalTransfer: false })), null);
});

test('single-leg deletion and structural mutation of a linked pair are rejected', () => {
  const source = transaction({ linkedTransactionId: 'candidate' });
  const candidate = transaction({
    id: 'candidate',
    accountId: 'acc-b',
    amountBase: 700,
    amountOriginal: 700,
    internalDirection: 'In',
    destinationAccountId: 'acc-a',
    linkedTransactionId: source.id,
  });
  assert.throws(() => assertTransactionDeletionAllowed(source), /single leg/);
  assert.throws(
    () => assertLinkedTransferMutationAllowed(source, { ...source, amountBase: -701 }, candidate, source.id),
    /amount/
  );
  assert.throws(
    () => assertLinkedTransferMutationAllowed(source, { ...source, accountId: 'acc-c' }, candidate, source.id),
    /account/
  );
  assert.throws(
    () => assertLinkedTransferMutationAllowed(source, { ...source, type: 'Expense' }, candidate, source.id),
    /converted/
  );
  assert.doesNotThrow(() => assertLinkedTransferMutationAllowed(source, { ...source, description: 'Edited memo' }, candidate, source.id));
});
