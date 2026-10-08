import type { Account, Category, Transaction } from './types';

export const ALL_ACCOUNTS_FILTER_ID = '__all_accounts__';
export const ALL_CATEGORIES_FILTER_ID = '__all_categories__';
export const UNCATEGORIZED_CATEGORY_FILTER_ID = '__uncategorized__';
export const INTERNAL_TRANSFER_CATEGORY_ID = 'cat_transfers';

export type TransactionFilterOption = {
  id: string;
  label: string;
};

const compareLabels = (left: TransactionFilterOption, right: TransactionFilterOption) =>
  left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });

export const getAccountFilterOptions = (
  accounts: Pick<Account, 'id' | 'name' | 'archived'>[]
): TransactionFilterOption[] => [
  { id: ALL_ACCOUNTS_FILTER_ID, label: 'All accounts' },
  ...accounts
    .filter((account) => !account.archived)
    .map((account) => ({ id: account.id, label: account.name }))
    .sort(compareLabels),
];

export const getCategoryFilterOptions = (
  categories: Pick<Category, 'id' | 'name'>[]
): TransactionFilterOption[] => [
  { id: ALL_CATEGORIES_FILTER_ID, label: 'All categories' },
  { id: UNCATEGORIZED_CATEGORY_FILTER_ID, label: 'Uncategorized' },
  ...categories
    .map((category) => ({ id: category.id, label: category.name }))
    .sort(compareLabels),
];

export const isUncategorizedTransaction = (
  transaction: Pick<Transaction, 'type' | 'categoryId'>
) => transaction.type !== 'InternalTransfer' && !transaction.categoryId;

export const matchesCategoryFilter = (
  transaction: Transaction,
  categoryIds: string[]
) => categoryIds.length === 0 || categoryIds.some((categoryId) => {
  if (categoryId === UNCATEGORIZED_CATEGORY_FILTER_ID) {
    return isUncategorizedTransaction(transaction);
  }
  if (categoryId === INTERNAL_TRANSFER_CATEGORY_ID) {
    return transaction.type === 'InternalTransfer';
  }
  return transaction.categoryId === categoryId;
});

export const matchesTransactionFilters = (
  transaction: Transaction,
  accountIds: string[],
  categoryIds: string[]
) => (accountIds.length === 0 || accountIds.includes(transaction.accountId))
  && matchesCategoryFilter(transaction, categoryIds);

