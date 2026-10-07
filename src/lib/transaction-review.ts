import type { Account, Category, Subcategory, Transaction } from './types';
import { validateInternalTransfer } from './internal-transfer';

export type TransactionCategories = (Category & { subcategories: Subcategory[] })[];

export const isTransactionSufficientlyClassified = (
  transaction: Partial<Transaction>,
  categories: TransactionCategories,
  accounts: Account[] = [],
  workspaceId: string = transaction.workspaceId ?? ''
) => {
  if (transaction.type === 'InternalTransfer') {
    return validateInternalTransfer(transaction, accounts, workspaceId).valid;
  }
  if (transaction.type !== 'Expense' && transaction.type !== 'Income') return true;
  if (!transaction.categoryId) return false;
  const category = categories.find((candidate) => candidate.id === transaction.categoryId);
  if (!category) return false;
  if (transaction.type === 'Expense' && category.type === 'income') return false;
  if (transaction.type === 'Income' && category.type === 'expense') return false;
  if (category.subcategories.length === 0) return true;
  if (!transaction.subcategoryId) return false;
  const subcategory = category.subcategories.find(
    (candidate) => candidate.id === transaction.subcategoryId
  );
  if (!subcategory) return false;
  return !subcategory.flowType || subcategory.flowType === transaction.type;
};

export const hasIndependentReviewRequirement = (
  transaction: Partial<Transaction>
) => transaction.isPotentialDuplicate === true ||
  transaction.isPotentialTransfer === true ||
  transaction.isInconsistent === true;

export const needsReviewAfterClassification = (
  transaction: Partial<Transaction>,
  categories: TransactionCategories,
  accounts: Account[] = [],
  workspaceId: string = transaction.workspaceId ?? ''
) => hasIndependentReviewRequirement(transaction) ||
  !isTransactionSufficientlyClassified(transaction, categories, accounts, workspaceId);
