import type { Account, Category, ClassificationRule, Subcategory, Transaction } from './types';
import { validateCategorySelection } from './category-ownership';
import { applyRuleClassificationToTransaction, ruleMatchesTransactionForBackfill } from './utils/rule-utils';

type BackfillCategories = (Category & { subcategories: Subcategory[] })[];

export type RuleBackfillPlanItem = {
  transactionId: string;
  patch: Partial<Transaction>;
};

type RuleBackfillPreflightInput = {
  workspaceId: string;
  selectedIds: string[];
  candidates: Transaction[];
  currentTransactions: Transaction[];
  rule: ClassificationRule;
  categories: BackfillCategories;
  accounts: Account[];
};

export const preflightRuleBackfill = ({
  workspaceId,
  selectedIds,
  candidates,
  currentTransactions,
  rule,
  categories,
  accounts,
}: RuleBackfillPreflightInput): RuleBackfillPlanItem[] => {
  const ids = [...new Set(selectedIds)];
  if (ids.length === 0) return [];
  if (rule.workspaceId !== workspaceId) {
    throw new Error('The selected rule does not belong to this workspace.');
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

  return ids.map((transactionId) => {
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

    return { transactionId, patch };
  });
};
