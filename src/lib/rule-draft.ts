import type { Account, ClassificationRule, Transaction } from './types';
import { suggestStableDescriptionPattern } from './utils/rule-utils';

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
  accounts: Account[]
) => {
  if (!draft.descriptionContains.trim()) {
    throw new Error('Description contains is required.');
  }
  const account = accounts.find((candidate) => candidate.id === draft.accountId);
  if (!account || account.workspaceId !== workspaceId) {
    throw new Error('The rule account does not belong to this workspace.');
  }
  if (draft.action.type !== 'InternalTransfer') return;
  if (draft.action.internalDirection !== 'In' && draft.action.internalDirection !== 'Out') {
    throw new Error('Choose whether matching transfers are entering or leaving this account.');
  }
  if (!draft.action.destinationAccountId) {
    throw new Error('Choose a counterpart account for matching transfers.');
  }
  if (draft.action.destinationAccountId === draft.accountId) {
    throw new Error('The counterpart account must be different from the rule account.');
  }
  const counterpart = accounts.find(
    (candidate) => candidate.id === draft.action.destinationAccountId
  );
  if (!counterpart || counterpart.workspaceId !== workspaceId) {
    throw new Error('The counterpart account does not belong to this workspace.');
  }
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
