import type { Account, Category, ClassificationRule, Subcategory, Transaction } from './types';
import { validateCategorySelection } from './category-ownership';
import { findPotentialTransfers } from './utils/duplicate-utils';
import { validateInternalTransfer } from './internal-transfer';
import {
  applyRuleClassificationToTransaction,
  applyRulesToTransactionWithResult,
  ruleMatchesTransactionForBackfill,
} from './utils/rule-utils';

type BackfillCategories = (Category & { subcategories: Subcategory[] })[];

export type RuleBackfillPlanItem = {
  transactionId: string;
  patch: Partial<Transaction>;
  transferResolution?:
    | { kind: 'create' }
    | { kind: 'link'; candidateId: string };
};

export type TransferBackfillDecision = 'create_counterparts' | 'keep_unpaired';

type RuleBackfillPreflightInput = {
  workspaceId: string;
  selectedIds: string[];
  candidates: Transaction[];
  currentTransactions: Transaction[];
  rule: ClassificationRule;
  categories: BackfillCategories;
  accounts: Account[];
  currentRules?: ClassificationRule[];
  transferDecision?: TransferBackfillDecision;
};

export const preflightRuleBackfill = ({
  workspaceId,
  selectedIds,
  candidates,
  currentTransactions,
  rule,
  categories,
  accounts,
  currentRules,
  transferDecision,
}: RuleBackfillPreflightInput): RuleBackfillPlanItem[] => {
  const ids = [...new Set(selectedIds)];
  if (ids.length === 0) return [];
  if (rule.workspaceId !== workspaceId) {
    throw new Error('The selected rule does not belong to this workspace.');
  }
  if (currentRules && !currentRules.some((current) => current.id === rule.id)) {
    throw new Error('The selected rule no longer exists. Refresh and try again.');
  }

  const isTransferRule = rule.action.type === 'InternalTransfer';
  if (isTransferRule && !transferDecision) {
    throw new Error('Choose whether to create reciprocal counterparts or keep the transfers unpaired.');
  }

  validateCategorySelection(
    categories,
    workspaceId,
    rule.action.categoryId,
    rule.action.subcategoryId
  );

  const candidateIds = new Set(candidates.map((transaction) => transaction.id));
  const currentById = new Map(currentTransactions.map((transaction) => [transaction.id, transaction]));
  const accountIds = new Set(
    accounts.filter((account) => account.workspaceId === workspaceId).map((account) => account.id)
  );
  if (rule.match.accountId && !accountIds.has(rule.match.accountId)) {
    throw new Error('The rule account does not belong to this workspace.');
  }
  if (isTransferRule) {
    const transferValidation = validateInternalTransfer({
      type: 'InternalTransfer',
      accountId: rule.match.accountId,
      internalDirection: rule.action.internalDirection,
      destinationAccountId: rule.action.destinationAccountId,
    }, accounts, workspaceId);
    if (!transferValidation.valid) throw new Error(transferValidation.reason);
  }

  const usedCounterpartIds = new Set<string>();
  const plan: RuleBackfillPlanItem[] = [];
  for (const transactionId of ids) {
    if (!candidateIds.has(transactionId)) {
      throw new Error('One or more selected transactions are stale. Refresh and try again.');
    }
    const transaction = currentById.get(transactionId);
    if (!transaction) {
      throw new Error('One or more selected transactions no longer exist. Refresh and try again.');
    }
    if (transaction.workspaceId !== workspaceId || !accountIds.has(transaction.accountId)) {
      throw new Error('One or more selected transactions do not belong to this workspace.');
    }
    if (!ruleMatchesTransactionForBackfill(rule, transaction)) {
      throw new Error('One or more selected transactions no longer match this rule. Refresh and try again.');
    }
    if (currentRules) {
      const evaluation = applyRulesToTransactionWithResult(transaction, currentRules);
      if (evaluation.conflict) {
        throw new Error(evaluation.conflictReason);
      }
    }

    const patch = applyRuleClassificationToTransaction(transaction, rule, categories, accounts);
    const proposed = { ...transaction, ...patch };
    if (transaction.linkedTransactionId && proposed.type !== 'InternalTransfer') {
      throw new Error('A linked transfer pair cannot be converted to another transaction type.');
    }
    validateCategorySelection(
      categories,
      workspaceId,
      proposed.categoryId,
      proposed.subcategoryId
    );

    let transferResolution: RuleBackfillPlanItem['transferResolution'];
    if (isTransferRule) {
      if (transaction.linkedTransactionId) {
        throw new Error('A linked transfer cannot be reclassified through rule backfill.');
      }
      const expectedDirection = transaction.amountBase < 0 ? 'Out' : 'In';
      if (!transaction.amountBase || rule.action.internalDirection !== expectedDirection) {
        throw new Error('A matching transaction amount does not agree with the rule transfer direction.');
      }
      if (transferDecision === 'create_counterparts') {
        const matches = findPotentialTransfers(proposed, currentTransactions, {
          workspaceId,
          counterpartAccountId: rule.action.destinationAccountId,
          sourceTransactionId: transaction.id,
          excludeLinked: true,
          maxCalendarDayDifference: 1,
        });
        if (matches.length > 1) {
          throw new Error('A matching transfer has more than one possible counterpart. Resolve it individually.');
        }
        const candidateId = matches[0]?.existingTransaction.id;
        if (candidateId) {
          if (usedCounterpartIds.has(candidateId)) {
            throw new Error('One existing transaction would be used as the counterpart for more than one transfer.');
          }
          usedCounterpartIds.add(candidateId);
          transferResolution = { kind: 'link', candidateId };
        } else {
          transferResolution = { kind: 'create' };
        }
      }
    }

    plan.push({ transactionId, patch, transferResolution });
  }
  return plan;
};
