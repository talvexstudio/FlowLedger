import type { Account, Category, ClassificationRule, Subcategory, Transaction } from './types';
import { suggestStableDescriptionPattern } from './utils/rule-utils';
import { describeRuleValidity, validateRuleAction } from './rule-validity';

export type RuleDraft = {
  originalDescription: string;
  descriptionContains: string;
  matchMode: 'contains' | 'starts_with';
  accountId: string;
  action: ClassificationRule['action'];
};

export const createRuleDraftFromTransaction = (transaction: Transaction): RuleDraft => {
  const originalDescription = transaction.rawDescription || transaction.description || '';
  return {
    originalDescription,
    descriptionContains: suggestStableDescriptionPattern(originalDescription),
    matchMode: 'contains',
    accountId: transaction.accountId,
    action: transaction.type === 'InternalTransfer'
      ? {
          type: 'InternalTransfer',
          internalDirection: transaction.internalDirection,
          destinationAccountId: transaction.destinationAccountId,
        }
      : {
          type: transaction.type,
          categoryId: transaction.categoryId,
          subcategoryId: transaction.subcategoryId,
        },
  };
};

export const validateRuleDraft = (
  draft: RuleDraft,
  workspaceId: string,
  accounts: Account[],
  categories?: (Category & { subcategories: Subcategory[] })[]
) => {
  if (!draft.descriptionContains.trim()) {
    throw new Error('Description contains is required.');
  }
  const validity = validateRuleAction({
    workspaceId,
    match: { accountId: draft.accountId, matchMode: draft.matchMode },
    action: draft.action,
    createdAt: new Date(),
  }, { workspaceId, accounts, categories });
  if (!validity.valid) throw new Error(describeRuleValidity(validity));
};

export const ruleDataFromDraft = (
  draft: RuleDraft,
  sourceTransactionId: string,
  workspaceId: string
): Omit<ClassificationRule, 'id'> => ({
  workspaceId,
  match: {
    descriptionContains: draft.descriptionContains.trim(),
    matchMode: draft.matchMode,
    accountId: draft.accountId,
  },
  action: draft.action.type === 'InternalTransfer'
    ? {
        type: 'InternalTransfer',
        internalDirection: draft.action.internalDirection,
        destinationAccountId: draft.action.destinationAccountId,
      }
    : {
        type: draft.action.type,
        categoryId: draft.action.categoryId,
        subcategoryId: draft.action.subcategoryId,
      },
  createdFromTransactionId: sourceTransactionId,
  createdAt: new Date(),
});
