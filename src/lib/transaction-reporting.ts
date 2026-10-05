import type { Account, Transaction } from './types';

export const isConfirmedIncome = (transaction: Transaction) =>
  !transaction.needsReview && transaction.type === 'Income';

export const isConfirmedExpense = (transaction: Transaction) =>
  !transaction.needsReview && transaction.type === 'Expense';

export const calculateAccountBalance = (
  account: Pick<Account, 'id' | 'openingBalance'>,
  transactions: Transaction[]
) => transactions.reduce(
  (balance, transaction) =>
    !transaction.needsReview && transaction.accountId === account.id
      ? balance + transaction.amountBase
      : balance,
  account.openingBalance ?? 0
);
