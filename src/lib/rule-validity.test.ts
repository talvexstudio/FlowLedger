import assert from 'node:assert/strict';
import test from 'node:test';
import { STORE_VALIDATORS } from './data-management/store-validation';
import { prepareImportTransactions } from './import-processing';
import { preflightRuleBackfill } from './rule-backfill';
import {
  describeRuleValidity,
  INVALID_RULE_LABEL,
  validateRuleAction,
} from './rule-validity';
import type { Account, Category, ClassificationRule, Subcategory, Transaction } from './types';
import {
  applyRulesToTransactionWithResult,
  getRuleBackfillCandidateResult,
  matchRuleDescription,
} from './utils/rule-utils';

const workspaceId = 'ws1';
const account = (id: string, owner = workspaceId): Account => ({
  id,
  workspaceId: owner,
  name: id,
  type: 'bank',
  currency: 'EUR',
  institution: 'Fixture',
  openingBalance: 0,
  archived: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});
const accounts = [account('acc-source'), account('acc-cash'), account('acc-savings')];
const categories: (Category & { subcategories: Subcategory[] })[] = [{
  id: 'cat-food',
  workspaceId,
  name: 'Food',
  type: 'expense',
  order: 1,
  isSystem: false,
  isActive: true,
  subcategories: [{
    id: 'sub-groceries',
    workspaceId,
    categoryId: 'cat-food',
    name: 'Groceries',
    order: 1,
    isSystem: false,
    isActive: true,
    flowType: 'Expense',
  }],
}];
const context = { workspaceId, accounts, categories };

const rule = (overrides: Partial<ClassificationRule> = {}): ClassificationRule => ({
  id: 'rule-expense',
  workspaceId,
  match: { descriptionContains: 'MATCH', accountId: 'acc-source' },
  action: { type: 'Expense', categoryId: 'cat-food', subcategoryId: 'sub-groceries' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});
const transferRule = (overrides: Partial<ClassificationRule> = {}): ClassificationRule => rule({
  id: 'rule-transfer',
  action: {
    type: 'InternalTransfer',
    internalDirection: 'Out',
    destinationAccountId: 'acc-cash',
  },
  ...overrides,
});
const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1',
  workspaceId,
  accountId: 'acc-source',
  date: new Date('2026-01-02T00:00:00Z'),
  description: 'MATCH TRANSACTION',
  rawDescription: 'MATCH TRANSACTION',
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

test('valid Expense, category-only, and InternalTransfer rules remain actionable', () => {
  assert.equal(validateRuleAction(rule(), context).valid, true);
  assert.equal(validateRuleAction(rule({
    action: { type: 'Expense', categoryId: 'cat-food' },
  }), context).valid, true);
  assert.equal(validateRuleAction(transferRule(), context).valid, true);
});

test('InternalTransfer validity reports each missing field clearly', () => {
  const missingDirection = validateRuleAction(transferRule({
    action: { type: 'InternalTransfer', destinationAccountId: 'acc-cash' },
  }), context);
  const missingDestination = validateRuleAction(transferRule({
    action: { type: 'InternalTransfer', internalDirection: 'Out' },
  }), context);
  const missingBoth = validateRuleAction(transferRule({
    action: { type: 'InternalTransfer' },
  }), context);

  assert.equal(missingDirection.valid, false);
  assert.deepEqual(missingDirection.missingFields, ['action.internalDirection']);
  assert.match(describeRuleValidity(missingDirection), /Missing transfer direction/);
  assert.deepEqual(missingDestination.missingFields, ['action.destinationAccountId']);
  assert.match(describeRuleValidity(missingDestination), /Missing destination account/);
  assert.deepEqual(missingBoth.missingFields, [
    'action.internalDirection',
    'action.destinationAccountId',
  ]);
  assert.match(
    describeRuleValidity(missingBoth),
    /Missing transfer direction and destination account/
  );
});

test('same-account and cross-workspace transfer destinations are invalid', () => {
  const sameAccount = validateRuleAction(transferRule({
    action: {
      type: 'InternalTransfer',
      internalDirection: 'Out',
      destinationAccountId: 'acc-source',
    },
  }), context);
  const crossWorkspace = validateRuleAction(transferRule({
    action: {
      type: 'InternalTransfer',
      internalDirection: 'Out',
      destinationAccountId: 'acc-other',
    },
  }), { ...context, accounts: [...accounts, account('acc-other', 'ws2')] });

  assert.match(describeRuleValidity(sameAccount), /different from the source/);
  assert.match(describeRuleValidity(crossWorkspace), /does not belong/);
});

test('legacy invalid rules remain loadable and receive Settings-friendly status', () => {
  const legacy = transferRule({ action: { type: 'InternalTransfer' } });
  assert.doesNotThrow(() => STORE_VALIDATORS.rules([{
    ...legacy,
    createdAt: legacy.createdAt.toISOString(),
  }]));
  const validity = validateRuleAction(legacy, context);
  assert.equal(INVALID_RULE_LABEL, 'Invalid rule');
  assert.equal(validity.valid, false);
  assert.match(
    describeRuleValidity(validity),
    /Missing transfer direction and destination account/
  );
  assert.equal(validateRuleAction(transferRule(), context).valid, true);
});

test('invalid matching rules are quarantined before classification and conflict resolution', () => {
  const invalidOne = transferRule({ id: 'invalid-1', action: { type: 'InternalTransfer' } });
  const invalidTwo = transferRule({ id: 'invalid-2', action: { type: 'InternalTransfer' } });
  const validOne = transferRule({ id: 'valid-1' });
  const validTwo = transferRule({ id: 'valid-2' });
  const result = applyRulesToTransactionWithResult(
    transaction(),
    [invalidOne, invalidTwo, validOne, validTwo],
    context
  );

  assert.equal(result.conflict, false);
  assert.deepEqual(result.matchedRules.map((candidate) => candidate.id), ['valid-1', 'valid-2']);
  assert.equal(result.transaction.type, 'InternalTransfer');
  assert.equal(result.transaction.internalDirection, 'Out');
  assert.equal(result.transaction.destinationAccountId, 'acc-cash');
});

test('invalid-only and invalid non-matching rules have no classification effect', () => {
  const invalidMatching = transferRule({ action: { type: 'InternalTransfer' } });
  const invalidNonMatching = transferRule({
    id: 'invalid-other',
    match: { descriptionContains: 'OTHER', accountId: 'acc-source' },
    action: { type: 'InternalTransfer' },
  });
  const result = applyRulesToTransactionWithResult(
    transaction(),
    [invalidMatching, invalidNonMatching],
    context
  );
  assert.equal(result.matchedRules.length, 0);
  assert.equal(result.transaction.type, 'Expense');
  assert.equal(matchRuleDescription(invalidMatching, 'MATCH TRANSACTION'), 'literal');
});

test('conflicts between valid rules remain protected', () => {
  const outToCash = transferRule({ id: 'cash' });
  const outToSavings = transferRule({
    id: 'savings',
    action: {
      type: 'InternalTransfer',
      internalDirection: 'Out',
      destinationAccountId: 'acc-savings',
    },
  });
  const result = applyRulesToTransactionWithResult(
    transaction(),
    [outToCash, outToSavings],
    context
  );
  assert.equal(result.conflict, true);
  assert.match(result.conflictReason ?? '', /different classification/);
});

test('import preparation ignores invalid matches and applies equivalent valid rules', () => {
  const invalidOne = transferRule({ id: 'invalid-1', action: { type: 'InternalTransfer' } });
  const invalidTwo = transferRule({ id: 'invalid-2', action: { type: 'InternalTransfer' } });
  const validOne = transferRule({ id: 'valid-1' });
  const validTwo = transferRule({ id: 'valid-2' });
  const prepared = prepareImportTransactions(
    [{ rowNumber: 2, values: { Date: '02/01/2026', Description: 'MATCH TRANSACTION', Amount: '-20' } }],
    { dateField: 'Date', descriptionField: 'Description', amountField: 'Amount' },
    'CSV',
    { workspaceId, accountId: 'acc-source' },
    [invalidOne, invalidTwo, validOne, validTwo],
    categories,
    accounts
  );
  assert.equal(prepared.transactions[0].type, 'InternalTransfer');
  assert.equal(prepared.transactions[0].internalDirection, 'Out');
  assert.equal(prepared.transactions[0].destinationAccountId, 'acc-cash');
  assert.equal(prepared.transactions[0].needsReview, true);
});

test('invalid rules expose zero backfill candidates while valid equivalence remains unchanged', () => {
  const invalid = transferRule({ action: { type: 'InternalTransfer' } });
  const valid = transferRule();
  const different = transaction();
  const equivalent = transaction({
    id: 'tx-equivalent',
    type: 'InternalTransfer',
    isInternalTransfer: true,
    internalDirection: 'Out',
    destinationAccountId: 'acc-cash',
  });

  const invalidResult = getRuleBackfillCandidateResult(
    invalid,
    [different, equivalent],
    context
  );
  const validResult = getRuleBackfillCandidateResult(
    valid,
    [different, equivalent],
    context
  );
  assert.equal(invalidResult.validity.valid, false);
  assert.deepEqual(invalidResult.candidates, []);
  assert.equal(validResult.validity.valid, true);
  assert.deepEqual(validResult.candidates.map((candidate) => candidate.id), ['tx-1']);
});

test('backfill preflight rejects an invalid rule as defense in depth', () => {
  const invalid = transferRule({ action: { type: 'InternalTransfer' } });
  assert.throws(() => preflightRuleBackfill({
    workspaceId,
    selectedIds: ['tx-1'],
    candidates: [transaction()],
    currentTransactions: [transaction()],
    rule: invalid,
    categories,
    accounts,
    currentRules: [invalid],
    transferDecision: 'keep_unpaired',
  }), /Missing transfer direction and destination account/);
});
