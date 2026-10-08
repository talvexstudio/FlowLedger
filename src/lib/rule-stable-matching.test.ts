import assert from 'node:assert/strict';
import test from 'node:test';
import type { Account, ClassificationRule, Transaction } from './types';
import { createRuleDraftFromTransaction, ruleDataFromDraft, validateRuleDraft } from './rule-draft';
import { STORE_VALIDATORS } from './data-management/store-validation';
import {
  applyRulesToTransaction,
  applyRulesToTransactionWithResult,
  getRuleBackfillCandidates,
  matchRuleDescription,
  suggestStableDescriptionPattern,
} from './utils/rule-utils';

const account = (id: string, workspaceId = 'ws1'): Account => ({
  id,
  workspaceId,
  name: id,
  type: 'bank',
  currency: 'EUR',
  institution: 'Local',
  openingBalance: 0,
  archived: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1',
  workspaceId: 'ws1',
  accountId: 'acc-bank',
  date: new Date('2026-01-02T00:00:00Z'),
  description: 'COMPRA 0822 PINGO DOCE AROUCA AROUC CONTACTLESS',
  rawDescription: 'COMPRA 0822 PINGO DOCE AROUCA AROUC CONTACTLESS',
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

const rule = (overrides: Partial<ClassificationRule> = {}): ClassificationRule => ({
  id: 'rule-1',
  workspaceId: 'ws1',
  match: {
    descriptionContains: 'COMPRA 8004 PINGO DOCE AROUCA AROUC CONTACTLESS',
    accountId: 'acc-bank',
  },
  action: { type: 'Expense', categoryId: 'cat-food', subcategoryId: 'sub-groceries' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

test('manual rules keep literal substring semantics', () => {
  const manual = rule({ createdFromTransactionId: undefined });
  assert.equal(matchRuleDescription(manual, manual.match.descriptionContains!), 'literal');
  assert.equal(matchRuleDescription(manual, transaction().rawDescription), null);
});

test('legacy and explicit contains modes retain case-insensitive substring behavior', () => {
  const legacy = rule({
    match: { descriptionContains: 'LEV', accountId: 'acc-bank' },
    createdFromTransactionId: undefined,
  });
  const explicit = rule({
    match: { descriptionContains: 'lev', matchMode: 'contains', accountId: 'acc-bank' },
    createdFromTransactionId: undefined,
  });
  assert.equal(matchRuleDescription(legacy, 'PAGAMENTO LEV 1234'), 'literal');
  assert.equal(matchRuleDescription(explicit, 'PAGAMENTO LEV 1234'), 'literal');
  assert.equal(legacy.match.matchMode, undefined);
});

test('starts_with is case-insensitive, enforces the prefix, and never falls back to stable tokens', () => {
  const startsWith = rule({
    match: { descriptionContains: 'lev', matchMode: 'starts_with', accountId: 'acc-bank' },
    createdFromTransactionId: 'tx-source',
  });
  assert.equal(matchRuleDescription(startsWith, 'LEV 1234 ATM'), 'literal');
  assert.equal(matchRuleDescription(startsWith, 'lev 1234 atm'), 'literal');
  assert.equal(matchRuleDescription(startsWith, 'PAGAMENTO LEV 1234 ATM'), null);

  const generatedPrefix = rule({
    match: {
      descriptionContains: 'COMPRA 8004 PINGO DOCE AROUCA',
      matchMode: 'starts_with',
      accountId: 'acc-bank',
    },
    createdFromTransactionId: 'tx-source',
  });
  assert.equal(matchRuleDescription(generatedPrefix, 'PAGAMENTO PINGO DOCE AROUCA'), null);
});

test('generated legacy full-description rule matches a volatile numeric variant', () => {
  const generated = rule({ createdFromTransactionId: 'tx-source' });
  assert.equal(matchRuleDescription(generated, transaction().rawDescription), 'stable-token');
  const classified = applyRulesToTransaction(transaction(), [generated]);
  assert.equal(classified.categoryId, 'cat-food');
  assert.equal(classified.subcategoryId, 'sub-groceries');
});

test('stable matching tolerates punctuation and whitespace while enforcing account scope', () => {
  const generated = rule({
    createdFromTransactionId: 'tx-source',
    match: { descriptionContains: 'COMPRA 8004 PINGO-DOCE AROUCA', accountId: 'acc-bank' },
  });
  assert.equal(matchRuleDescription(generated, 'COMPRA 0822   PINGO / DOCE, AROUCA'), 'stable-token');
  assert.equal(applyRulesToTransaction(transaction({ accountId: 'acc-other' }), [generated]).categoryId, undefined);
});

test('suggestion strips only standalone volatile numbers and keeps embedded identifiers', () => {
  assert.equal(
    suggestStableDescriptionPattern('COMPRA 8004 PINGO DOCE AROUCA AROUC CONTACTLESS'),
    'PINGO DOCE AROUCA'
  );
  assert.equal(suggestStableDescriptionPattern('COMPRA LOJA24 MERCADO PORTO'), 'LOJA24 MERCADO PORTO');
});

test('rule draft is inspectable and an explicit short LEV pattern remains valid', () => {
  const source = transaction({ rawDescription: 'LEV 1234 ATM', description: 'LEV 1234 ATM' });
  const draft = createRuleDraftFromTransaction(source);
  assert.equal(draft.originalDescription, 'LEV 1234 ATM');
  assert.equal(draft.matchMode, 'contains');
  draft.descriptionContains = 'LEV';
  assert.doesNotThrow(() => validateRuleDraft(draft, 'ws1', [account('acc-bank')]));
  const saved = ruleDataFromDraft(draft, source.id, 'ws1');
  assert.equal(saved.match.descriptionContains, 'LEV');
  assert.equal(saved.match.matchMode, 'contains');
});

test('equivalently classified transactions are omitted from backfill suggestions', () => {
  const generated = rule({
    createdFromTransactionId: 'tx-source',
    match: { descriptionContains: 'PINGO DOCE AROUCA', accountId: 'acc-bank' },
  });
  const alreadyClassified = transaction({
    categoryId: 'cat-food',
    subcategoryId: 'sub-groceries',
    needsReview: false,
  });
  assert.deepEqual(getRuleBackfillCandidates(generated, [alreadyClassified]), []);
});

test('conflicting matching rules do not override by storage order', () => {
  const first = rule({
    id: 'rule-expense',
    createdFromTransactionId: 'tx-source',
    match: { descriptionContains: 'PINGO DOCE', accountId: 'acc-bank' },
  });
  const second = rule({
    id: 'rule-adjustment',
    createdFromTransactionId: 'tx-source-2',
    match: { descriptionContains: 'PINGO DOCE', accountId: 'acc-bank' },
    action: { type: 'Adjustment' },
  });
  const result = applyRulesToTransactionWithResult(transaction(), [first, second]);
  assert.equal(result.conflict, true);
  assert.equal(result.transaction.categoryId, undefined);
  assert.equal(result.transaction.needsReview, true);
});

test('InternalTransfer rule drafts require complete same-workspace semantics', () => {
  const source = transaction({
    type: 'InternalTransfer',
    isInternalTransfer: true,
    internalDirection: 'Out',
    destinationAccountId: 'acc-cash',
    categoryId: undefined,
    subcategoryId: undefined,
  });
  const draft = createRuleDraftFromTransaction(source);
  assert.doesNotThrow(() => validateRuleDraft(draft, 'ws1', [account('acc-bank'), account('acc-cash')]));
  assert.equal(draft.action.categoryId, undefined);
  assert.equal(draft.action.subcategoryId, undefined);
  assert.equal(draft.action.internalDirection, 'Out');
  assert.equal(draft.action.destinationAccountId, 'acc-cash');

  assert.throws(
    () => validateRuleDraft({ ...draft, action: { type: 'InternalTransfer' } }, 'ws1', [account('acc-bank')]),
    /entering or leaving/i
  );
  assert.throws(
    () => validateRuleDraft({ ...draft, action: { ...draft.action, destinationAccountId: 'acc-bank' } }, 'ws1', [account('acc-bank')]),
    /different/i
  );
  assert.throws(
    () => validateRuleDraft(draft, 'ws1', [account('acc-bank'), account('acc-cash', 'ws2')]),
    /does not belong/i
  );
});

test('starts_with InternalTransfer rules preserve direction and counterpart in matching and backfill candidates', () => {
  const transferRule = rule({
    match: { descriptionContains: 'LEV', matchMode: 'starts_with', accountId: 'acc-bank' },
    action: {
      type: 'InternalTransfer',
      internalDirection: 'Out',
      destinationAccountId: 'acc-cash',
    },
    createdFromTransactionId: 'tx-source',
  });
  const matching = transaction({ description: 'LEV 1234 ATM', rawDescription: 'LEV 1234 ATM' });
  const nonMatching = transaction({
    id: 'tx-middle',
    description: 'PAGAMENTO LEV 1234 ATM',
    rawDescription: 'PAGAMENTO LEV 1234 ATM',
  });
  const classified = applyRulesToTransaction(matching, [transferRule]);
  assert.equal(classified.type, 'InternalTransfer');
  assert.equal(classified.internalDirection, 'Out');
  assert.equal(classified.destinationAccountId, 'acc-cash');
  assert.equal(classified.needsReview, true);
  assert.deepEqual(
    getRuleBackfillCandidates(transferRule, [matching, nonMatching]).map((candidate) => candidate.id),
    [matching.id]
  );
});

test('persisted rule validation accepts legacy, contains, and starts_with modes without migration', () => {
  const persisted = (id: string, matchMode?: 'contains' | 'starts_with') => ({
    id,
    workspaceId: 'ws1',
    match: {
      descriptionContains: 'LEV',
      ...(matchMode ? { matchMode } : {}),
    },
    action: { type: 'Expense' },
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  assert.doesNotThrow(() => STORE_VALIDATORS.rules([
    persisted('legacy'),
    persisted('contains', 'contains'),
    persisted('starts', 'starts_with'),
  ]));
  assert.throws(
    () => STORE_VALIDATORS.rules([{ ...persisted('invalid'), match: { descriptionContains: 'LEV', matchMode: 'regex' } }]),
    /unsupported value/i
  );
});
