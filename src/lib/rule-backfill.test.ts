import assert from 'node:assert/strict';
import test from 'node:test';
import type { Account, ClassificationRule, Transaction } from './types';
import type { RuntimeCategory } from './category-ownership';
import { getDuplicateApprovalBlockReason } from './utils/duplicate-utils';
import { applyRuleClassificationToTransaction } from './utils/rule-utils';
import { preflightRuleBackfill } from './rule-backfill';

const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'acc-ws1',
  workspaceId: 'ws1',
  name: 'Current account',
  type: 'bank',
  currency: 'EUR',
  institution: 'Local',
  openingBalance: 0,
  archived: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const categories: RuntimeCategory[] = [{
  id: 'cat-food',
  workspaceId: 'ws1',
  name: 'Food',
  type: 'expense',
  order: 1,
  isSystem: false,
  isActive: true,
  subcategories: [{
    id: 'sub-groceries',
    workspaceId: 'ws1',
    categoryId: 'cat-food',
    name: 'Groceries',
    order: 1,
    isSystem: false,
    isActive: true,
    flowType: 'Expense',
  }],
}];

const rule: ClassificationRule = {
  id: 'rule-grocery',
  workspaceId: 'ws1',
  match: { descriptionContains: 'market', accountId: 'acc-ws1' },
  action: { categoryId: 'cat-food', subcategoryId: 'sub-groceries', type: 'Expense' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-normal',
  workspaceId: 'ws1',
  accountId: 'acc-ws1',
  date: new Date('2026-01-02T00:00:00Z'),
  description: 'Local market',
  rawDescription: 'LOCAL MARKET',
  amountOriginal: -20,
  currencyOriginal: 'EUR',
  amountBase: -20,
  type: 'Expense',
  needsReview: true,
  isInternalTransfer: false,
  isPotentialDuplicate: false,
  isPotentialTransfer: false,
  isInconsistent: false,
  createdAt: new Date('2026-01-02T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  ...overrides,
});

test('rule backfill completes review when classification was the only review reason', () => {
  const patch = applyRuleClassificationToTransaction(
    transaction(),
    rule,
    categories,
    [account()]
  );

  assert.deepEqual(patch, {
    id: 'tx-normal',
    categoryId: 'cat-food',
    subcategoryId: 'sub-groceries',
    type: 'Expense',
    needsReview: false,
  });
});

test('rule backfill classifies a potential duplicate without approving or changing duplicate metadata', () => {
  const duplicateMatch = {
    transactionId: 'tx-existing',
    date: new Date('2026-01-01T00:00:00Z'),
    description: 'Existing record',
    amountBase: -20,
  };
  const duplicate = transaction({
    id: 'tx-duplicate',
    isPotentialDuplicate: true,
    potentialDuplicateMatch: duplicateMatch,
  });
  const patch = applyRuleClassificationToTransaction(duplicate, rule, categories, [account()]);

  assert.equal(patch.needsReview, true);
  assert.equal('isPotentialDuplicate' in patch, false);
  assert.equal('potentialDuplicateMatch' in patch, false);
  assert.equal(duplicate.isPotentialDuplicate, true);
  assert.equal(duplicate.potentialDuplicateMatch, duplicateMatch);
});

test('the direct unresolved-duplicate approval guard remains intact', () => {
  assert.equal(
    getDuplicateApprovalBlockReason(
      transaction({ isPotentialDuplicate: true }),
      { needsReview: false }
    ),
    'Potential duplicate: open Edit and explicitly keep this transaction.'
  );
});

test('mixed normal and duplicate backfill preflight uses review-safe patches for both', () => {
  const normal = transaction();
  const duplicate = transaction({ id: 'tx-duplicate', isPotentialDuplicate: true });
  const plan = preflightRuleBackfill({
    workspaceId: 'ws1',
    selectedIds: [normal.id, duplicate.id],
    candidates: [normal, duplicate],
    currentTransactions: [normal, duplicate],
    rule,
    categories,
    accounts: [account()],
  });

  assert.equal(plan.length, 2);
  assert.equal(plan[0].patch.needsReview, false);
  assert.equal(plan[1].patch.needsReview, true);
});

test('invalid rule category fails preflight before a caller can start mutation', () => {
  const normal = transaction();
  assert.throws(() => preflightRuleBackfill({
    workspaceId: 'ws1',
    selectedIds: [normal.id],
    candidates: [normal],
    currentTransactions: [normal],
    rule: { ...rule, action: { ...rule.action, categoryId: 'missing-category' } },
    categories,
    accounts: [account()],
  }), /Category not found in the selected workspace/);
});

test('invalid rule subcategory fails preflight before a caller can start mutation', () => {
  const normal = transaction();
  assert.throws(() => preflightRuleBackfill({
    workspaceId: 'ws1',
    selectedIds: [normal.id],
    candidates: [normal],
    currentTransactions: [normal],
    rule: { ...rule, action: { ...rule.action, subcategoryId: 'missing-subcategory' } },
    categories,
    accounts: [account()],
  }), /Subcategory does not belong to the selected category and workspace/);
});

test('cross-workspace selected transaction fails preflight', () => {
  const otherWorkspaceTransaction = transaction({
    id: 'tx-ws2',
    workspaceId: 'ws2',
    accountId: 'acc-ws2',
  });
  assert.throws(() => preflightRuleBackfill({
    workspaceId: 'ws1',
    selectedIds: [otherWorkspaceTransaction.id],
    candidates: [otherWorkspaceTransaction],
    currentTransactions: [otherWorkspaceTransaction],
    rule,
    categories,
    accounts: [account(), account({ id: 'acc-ws2', workspaceId: 'ws2' })],
  }), /do not belong to this workspace/);
});

test('independent potential-transfer and inconsistency review signals survive classification', () => {
  const potentialTransfer = applyRuleClassificationToTransaction(
    transaction({ id: 'tx-transfer-candidate', isPotentialTransfer: true }),
    rule,
    categories,
    [account()]
  );
  const inconsistent = applyRuleClassificationToTransaction(
    transaction({ id: 'tx-inconsistent', isInconsistent: true }),
    rule,
    categories,
    [account()]
  );

  assert.equal(potentialTransfer.needsReview, true);
  assert.equal(inconsistent.needsReview, true);
});

const transferRule: ClassificationRule = {
  id: 'rule-transfer',
  workspaceId: 'ws1',
  match: { descriptionContains: 'market', accountId: 'acc-ws1' },
  action: {
    type: 'InternalTransfer',
    internalDirection: 'Out',
    destinationAccountId: 'acc-cash',
  },
  createdFromTransactionId: 'tx-source',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const transferAccounts = [account(), account({ id: 'acc-cash', name: 'Cash', type: 'cash' })];

test('InternalTransfer backfill requires an explicit counterpart decision', () => {
  const source = transaction();
  assert.throws(() => preflightRuleBackfill({
    workspaceId: 'ws1',
    selectedIds: [source.id],
    candidates: [source],
    currentTransactions: [source],
    rule: transferRule,
    categories,
    accounts: transferAccounts,
  }), /Choose whether to create reciprocal counterparts/i);
});

test('keeping a rule-classified transfer unpaired clears categories and leaves review pending', () => {
  const source = transaction({ categoryId: 'cat-food', subcategoryId: 'sub-groceries' });
  const plan = preflightRuleBackfill({
    workspaceId: 'ws1',
    selectedIds: [source.id],
    candidates: [source],
    currentTransactions: [source],
    rule: transferRule,
    categories,
    accounts: transferAccounts,
    transferDecision: 'keep_unpaired',
  });
  assert.equal(plan[0].patch.type, 'InternalTransfer');
  assert.equal(plan[0].patch.categoryId, undefined);
  assert.equal(plan[0].patch.subcategoryId, undefined);
  assert.equal(plan[0].patch.internalDirection, 'Out');
  assert.equal(plan[0].patch.destinationAccountId, 'acc-cash');
  assert.equal(plan[0].patch.needsReview, true);
  assert.equal(plan[0].transferResolution, undefined);
});

test('counterpart creation plan reuses one exact existing reciprocal candidate', () => {
  const source = transaction();
  const reciprocal = transaction({
    id: 'tx-cash',
    accountId: 'acc-cash',
    amountOriginal: 20,
    amountBase: 20,
    description: 'Cash movement',
    rawDescription: 'CASH MOVEMENT',
  });
  const plan = preflightRuleBackfill({
    workspaceId: 'ws1',
    selectedIds: [source.id],
    candidates: [source],
    currentTransactions: [source, reciprocal],
    rule: transferRule,
    categories,
    accounts: transferAccounts,
    transferDecision: 'create_counterparts',
  });
  assert.deepEqual(plan[0].transferResolution, { kind: 'link', candidateId: reciprocal.id });
});

test('counterpart creation plan creates only when no reciprocal candidate exists', () => {
  const source = transaction();
  const plan = preflightRuleBackfill({
    workspaceId: 'ws1',
    selectedIds: [source.id],
    candidates: [source],
    currentTransactions: [source],
    rule: transferRule,
    categories,
    accounts: transferAccounts,
    transferDecision: 'create_counterparts',
  });
  assert.deepEqual(plan[0].transferResolution, { kind: 'create' });
});

test('starts_with LEV transfer rule uses the same boundary during backfill and counterpart planning', () => {
  const startsWithRule: ClassificationRule = {
    ...transferRule,
    match: {
      descriptionContains: 'LEV',
      matchMode: 'starts_with',
      accountId: 'acc-ws1',
    },
  };
  const matching = transaction({ description: 'LEV 1234 ATM', rawDescription: 'LEV 1234 ATM' });
  const embedded = transaction({
    id: 'tx-embedded',
    description: 'PAGAMENTO LEV 1234 ATM',
    rawDescription: 'PAGAMENTO LEV 1234 ATM',
  });
  const plan = preflightRuleBackfill({
    workspaceId: 'ws1',
    selectedIds: [matching.id],
    candidates: [matching],
    currentTransactions: [matching, embedded],
    rule: startsWithRule,
    categories,
    accounts: transferAccounts,
    transferDecision: 'create_counterparts',
  });
  assert.deepEqual(plan[0].transferResolution, { kind: 'create' });
  assert.throws(() => preflightRuleBackfill({
    workspaceId: 'ws1',
    selectedIds: [embedded.id],
    candidates: [embedded],
    currentTransactions: [matching, embedded],
    rule: startsWithRule,
    categories,
    accounts: transferAccounts,
    transferDecision: 'keep_unpaired',
  }), /no longer match/i);
});

test('ambiguous reciprocal candidates block the complete transfer backfill plan', () => {
  const source = transaction();
  const reciprocal = (id: string) => transaction({
    id,
    accountId: 'acc-cash',
    amountOriginal: 20,
    amountBase: 20,
    description: 'Cash movement',
    rawDescription: 'CASH MOVEMENT',
  });
  assert.throws(() => preflightRuleBackfill({
    workspaceId: 'ws1',
    selectedIds: [source.id],
    candidates: [source],
    currentTransactions: [source, reciprocal('tx-cash-1'), reciprocal('tx-cash-2')],
    rule: transferRule,
    categories,
    accounts: transferAccounts,
    transferDecision: 'create_counterparts',
  }), /more than one possible counterpart/i);
});

test('transfer rule preflight rejects missing, same-account, and cross-workspace counterpart semantics', () => {
  const source = transaction();
  const base = {
    workspaceId: 'ws1',
    selectedIds: [source.id],
    candidates: [source],
    currentTransactions: [source],
    categories,
    transferDecision: 'keep_unpaired' as const,
  };
  assert.throws(() => preflightRuleBackfill({
    ...base,
    rule: { ...transferRule, action: { type: 'InternalTransfer', destinationAccountId: 'acc-cash' } },
    accounts: transferAccounts,
  }), /entering or leaving/i);
  assert.throws(() => preflightRuleBackfill({
    ...base,
    rule: { ...transferRule, action: { ...transferRule.action, destinationAccountId: 'acc-ws1' } },
    accounts: transferAccounts,
  }), /different/i);
  assert.throws(() => preflightRuleBackfill({
    ...base,
    rule: transferRule,
    accounts: [account(), account({ id: 'acc-cash', workspaceId: 'ws2' })],
  }), /does not belong/i);
});

test('stale rules and conflicting rule results fail before a mutation plan is returned', () => {
  const source = transaction();
  const base = {
    workspaceId: 'ws1',
    selectedIds: [source.id],
    candidates: [source],
    currentTransactions: [source],
    rule,
    categories,
    accounts: [account()],
  };
  assert.throws(() => preflightRuleBackfill({ ...base, currentRules: [] }), /no longer exists/i);
  assert.throws(() => preflightRuleBackfill({
    ...base,
    currentRules: [
      rule,
      { ...rule, id: 'rule-conflict', action: { type: 'Adjustment' } },
    ],
  }), /different classification/i);
});
