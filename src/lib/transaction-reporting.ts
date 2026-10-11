import type { Account, Category, Transaction } from './types';

export type ReportingCategory = Pick<Category, 'id' | 'type'>;

export type ReportingTotals = {
  ordinaryIncome: number;
  grossExpenses: number;
  reimbursements: number;
  netExpenses: number;
};

const toCents = (amount: number) => Math.round(amount * 100);
const fromCents = (amount: number) => amount / 100;

export const hasExpenseCategoryAssignment = (
  transaction: Pick<Transaction, 'categoryId'>,
  categories: ReportingCategory[]
) => {
  if (!transaction.categoryId) return false;
  const category = categories.find((candidate) => candidate.id === transaction.categoryId);
  return category?.type === 'expense' || category?.type === 'both';
};

export const isReimbursement = (
  transaction: Transaction,
  categories: ReportingCategory[]
) => !transaction.needsReview &&
  transaction.type === 'Income' &&
  hasExpenseCategoryAssignment(transaction, categories);

export const isOrdinaryIncome = (
  transaction: Transaction,
  categories: ReportingCategory[]
) => !transaction.needsReview &&
  transaction.type === 'Income' &&
  !hasExpenseCategoryAssignment(transaction, categories);

export const isReportingExpenseRecord = (
  transaction: Transaction,
  categories: ReportingCategory[]
) => isConfirmedExpense(transaction) || isReimbursement(transaction, categories);

export const getReportingExpenseContribution = (
  transaction: Transaction,
  categories: ReportingCategory[]
) => {
  if (isConfirmedExpense(transaction)) return Math.abs(transaction.amountBase);
  if (isReimbursement(transaction, categories)) return -Math.abs(transaction.amountBase);
  return 0;
};

export const calculateReportingTotals = (
  transactions: Transaction[],
  categories: ReportingCategory[]
): ReportingTotals => {
  let ordinaryIncomeCents = 0;
  let grossExpenseCents = 0;
  let reimbursementCents = 0;

  for (const transaction of transactions) {
    if (isOrdinaryIncome(transaction, categories)) {
      ordinaryIncomeCents += toCents(transaction.amountBase);
    } else if (isConfirmedExpense(transaction)) {
      grossExpenseCents += Math.abs(toCents(transaction.amountBase));
    } else if (isReimbursement(transaction, categories)) {
      reimbursementCents += Math.abs(toCents(transaction.amountBase));
    }
  }

  return {
    ordinaryIncome: fromCents(ordinaryIncomeCents),
    grossExpenses: fromCents(grossExpenseCents),
    reimbursements: fromCents(reimbursementCents),
    netExpenses: fromCents(grossExpenseCents - reimbursementCents),
  };
};

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
