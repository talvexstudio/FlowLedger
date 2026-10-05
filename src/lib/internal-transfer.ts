import type { Account, Transaction } from './types';

export const INTERNAL_TRANSFER_CATEGORY_ID = 'cat_transfers';

export type InternalTransferValidation =
  | { valid: true }
  | { valid: false; reason: string };

export const validateInternalTransfer = (
  transaction: Partial<Transaction>,
  accounts: Account[],
  workspaceId: string
): InternalTransferValidation => {
  if (transaction.type !== 'InternalTransfer') return { valid: true };

  if (transaction.internalDirection !== 'Out' && transaction.internalDirection !== 'In') {
    return { valid: false, reason: 'Choose whether the transfer is entering or leaving this account.' };
  }
  if (!transaction.accountId) {
    return { valid: false, reason: 'Choose the account for this transfer.' };
  }
  if (!transaction.destinationAccountId) {
    return { valid: false, reason: 'Choose the counterpart account for this transfer.' };
  }
  if (transaction.destinationAccountId === transaction.accountId) {
    return { valid: false, reason: 'The counterpart account must be different from the current account.' };
  }

  const currentAccount = accounts.find((account) => account.id === transaction.accountId);
  if (!currentAccount || currentAccount.workspaceId !== workspaceId) {
    return { valid: false, reason: 'The current account does not belong to this workspace.' };
  }

  const counterpart = accounts.find((account) => account.id === transaction.destinationAccountId);
  if (!counterpart || counterpart.workspaceId !== workspaceId) {
    return { valid: false, reason: 'The counterpart account does not belong to this workspace.' };
  }

  return { valid: true };
};

export const normalizeTransactionTypeFields = (
  transaction: Partial<Transaction>
): Partial<Transaction> => {
  if (transaction.type === 'InternalTransfer') {
    return {
      ...transaction,
      categoryId: undefined,
      subcategoryId: undefined,
      isInternalTransfer: true,
    };
  }

  if (transaction.type) {
    return {
      ...transaction,
      internalDirection: undefined,
      destinationAccountId: undefined,
      linkedTransactionId: undefined,
      isInternalTransfer: false,
    };
  }

  return transaction;
};

export const getTransactionTypeChangePatch = (
  previousType: Transaction['type'],
  nextType: Transaction['type']
): Partial<Transaction> => {
  if (nextType === 'InternalTransfer') {
    return {
      type: nextType,
      categoryId: undefined,
      subcategoryId: undefined,
      isInternalTransfer: true,
    };
  }

  if (previousType === 'InternalTransfer') {
    return {
      type: nextType,
      internalDirection: undefined,
      destinationAccountId: undefined,
      linkedTransactionId: undefined,
      isInternalTransfer: false,
    };
  }

  return { type: nextType, isInternalTransfer: false };
};

export const getSelectableAccounts = (accounts: Account[], selectedId?: string) => {
  const active = accounts.filter((account) => !account.archived);
  if (!selectedId || active.some((account) => account.id === selectedId)) return active;
  const selected = accounts.find((account) => account.id === selectedId);
  return selected ? [...active, selected] : active;
};

export const shouldCreateInternalTransferPair = (transaction: Partial<Transaction>) =>
  transaction.type === 'InternalTransfer' && !transaction.id;

export const matchesCategoryFilter = (
  transaction: Transaction,
  categoryIds: string[]
) => categoryIds.length === 0 || categoryIds.some((categoryId) =>
  categoryId === INTERNAL_TRANSFER_CATEGORY_ID
    ? transaction.type === 'InternalTransfer'
    : transaction.categoryId === categoryId
);

export const getInternalTransferDisplay = (
  transaction: Pick<Transaction, 'type' | 'internalDirection' | 'destinationAccountId'>,
  accounts: Pick<Account, 'id' | 'name'>[]
) => {
  if (transaction.type !== 'InternalTransfer') return null;
  const counterpartName = accounts.find(
    (account) => account.id === transaction.destinationAccountId
  )?.name ?? 'Unknown account';
  if (transaction.internalDirection === 'In') return `Transfer ← ${counterpartName}`;
  if (transaction.internalDirection === 'Out') return `Transfer → ${counterpartName}`;
  return `Transfer · ${counterpartName}`;
};

export const getInternalTransferPairingStatus = (
  transaction: Pick<Transaction, 'type' | 'linkedTransactionId'>
) => transaction.type === 'InternalTransfer'
  ? transaction.linkedTransactionId ? 'Linked' : 'Unpaired'
  : null;
