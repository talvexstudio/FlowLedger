import type { Account, Category, Subcategory, Transaction } from './types';

type CategoryWithSubcategories = Category & { subcategories: Subcategory[] };

export const getSelectableOptions = <T extends { id: string; isActive?: boolean }>(
  options: T[],
  selectedId?: string
) => {
  const active = options.filter(option => option.isActive !== false);
  if (!selectedId || active.some(option => option.id === selectedId)) return active;
  const selected = options.find(option => option.id === selectedId);
  return selected ? [...active, selected] : active;
};

type HydrationInput = {
  transaction: Partial<Transaction>;
  accounts: Account[];
  categories: CategoryWithSubcategories[];
  current: {
    accountId?: string;
    categoryId?: string;
    subcategoryId?: string;
  };
  dirty: {
    accountId: boolean;
    categoryId: boolean;
    subcategoryId: boolean;
  };
};

export const getTransactionEditHydrationPatch = ({
  transaction,
  accounts,
  categories,
  current,
  dirty,
}: HydrationInput) => {
  const patch: {
    accountId?: string;
    categoryId?: string;
    subcategoryId?: string;
  } = {};

  if (
    transaction.accountId &&
    !dirty.accountId &&
    current.accountId !== transaction.accountId &&
    accounts.some(account => account.id === transaction.accountId)
  ) {
    patch.accountId = transaction.accountId;
  }

  const category = categories.find(item => item.id === transaction.categoryId);
  if (
    transaction.categoryId &&
    category &&
    !dirty.categoryId &&
    current.categoryId !== transaction.categoryId
  ) {
    patch.categoryId = transaction.categoryId;
  }

  if (
    transaction.subcategoryId &&
    category?.subcategories.some(item => item.id === transaction.subcategoryId) &&
    !dirty.subcategoryId &&
    current.subcategoryId !== transaction.subcategoryId
  ) {
    patch.subcategoryId = transaction.subcategoryId;
  }

  return patch;
};
