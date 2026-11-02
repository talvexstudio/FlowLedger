import type { Account, Category, Subcategory, Transaction } from './types';
import { validateInternalTransfer } from './internal-transfer';

export type TransactionCategories = (Category & { subcategories: Subcategory[] })[];

export type TransactionClassificationValidation = {
  valid: boolean;
  reason?: string;
};

export const validateTransactionClassificationSelection = (
  transaction: Partial<Transaction>,
  categories: TransactionCategories,
  accounts: Account[] = [],
  workspaceId: string = transaction.workspaceId ?? ''
): TransactionClassificationValidation => {
  if (transaction.type === 'InternalTransfer') {
    return validateInternalTransfer(transaction, accounts, workspaceId);
  }

  if (!transaction.categoryId) {
    return transaction.subcategoryId
      ? { valid: false, reason: 'Choose a valid category.' }
      : { valid: true };
  }

  const category = categories.find((candidate) => candidate.id === transaction.categoryId);
  if (!category) return { valid: false, reason: 'Choose a valid category.' };
  if (transaction.type === 'Expense' && category.type === 'income') {
    return { valid: false, reason: 'Choose a valid category.' };
  }
  if (transaction.type === 'Income' && category.type === 'expense') {
    return { valid: false, reason: 'Choose a valid category.' };
  }
  if (!transaction.subcategoryId) return { valid: true };

  const subcategory = category.subcategories.find(
    (candidate) => candidate.id === transaction.subcategoryId
  );
  if (!subcategory || (subcategory.flowType && subcategory.flowType !== transaction.type)) {
    return {
      valid: false,
      reason: 'Choose a valid subcategory for this category.',
    };
  }
  return { valid: true };
};

export const isTransactionSufficientlyClassified = (
  transaction: Partial<Transaction>,
  categories: TransactionCategories,
  accounts: Account[] = [],
  workspaceId: string = transaction.workspaceId ?? ''
) => {
  const selection = validateTransactionClassificationSelection(
    transaction,
    categories,
    accounts,
    workspaceId
  );
  if (!selection.valid) return false;
  if (transaction.type === 'InternalTransfer') return true;
  if (transaction.type !== 'Expense' && transaction.type !== 'Income') return true;
  if (!transaction.categoryId) return false;
  return true;
};

export const hasIndependentReviewRequirement = (
  transaction: Partial<Transaction>
) => transaction.isPotentialDuplicate === true ||
  transaction.isPotentialTransfer === true ||
  transaction.isInconsistent === true;

export const getIndependentReviewBlockReason = (
  transaction: Partial<Transaction>
): string | undefined => {
  if (transaction.isPotentialTransfer) {
    return 'Potential transfer: resolve the possible transfer before approving this transaction.';
  }
  if (transaction.isInconsistent) {
    return 'This transaction is inconsistent and cannot be approved until the inconsistency is resolved.';
  }
  return undefined;
};

export const selectTransactionsToReview = (transactions: Transaction[]) =>
  transactions.filter((transaction) => transaction.needsReview === true);

export const needsReviewAfterClassification = (
  transaction: Partial<Transaction>,
  categories: TransactionCategories,
  accounts: Account[] = [],
  workspaceId: string = transaction.workspaceId ?? ''
) => hasIndependentReviewRequirement(transaction) ||
  !isTransactionSufficientlyClassified(transaction, categories, accounts, workspaceId);
