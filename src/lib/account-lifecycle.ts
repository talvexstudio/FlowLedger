import type { Account } from './types';

export const splitAccountsByArchiveState = (accounts: Account[]) => ({
  activeAccounts: accounts.filter((account) => !account.archived),
  archivedAccounts: accounts.filter((account) => account.archived),
});

/**
 * A modal requested from a Radix dropdown must mount only after the menu has
 * committed its closed state, otherwise their focus and pointer locks overlap.
 */
export const resolveQueuedAccountDelete = (
  menuOpen: boolean,
  queuedAccount: Account | null
) => menuOpen ? null : queuedAccount;

export const clearDeletedAccountTarget = (
  target: Account | null,
  deletedAccountId: string
) => target?.id === deletedAccountId ? null : target;
