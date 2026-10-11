import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateAccountBalance,
  calculateReportingTotals,
  hasExpenseCategoryAssignment,
  isOrdinaryIncome,
  isReimbursement,
} from './transaction-reporting';
import type { Category, Transaction } from './types';

const categories: Pick<Category, 'id' | 'type'>[] = [
  { id: 'expense-category', type: 'expense' },
  { id: 'income-category', type: 'income' },
  { id: 'both-category', type: 'both' },
];

const transaction = (
  id: string,
  amountBase: number,
  type: Transaction['type'],
  overrides: Partial<Transaction> = {}
): Transaction => ({
  id,
  workspaceId: 'ws-test',
  accountId: 'acc-test',
  date: new Date(2026, 7, 1),
  description: id,
  rawDescription: id,
  amountOriginal: amountBase,
  currencyOriginal: 'EUR',
  amountBase,
  type,
  needsReview: false,
  isInternalTransfer: type === 'InternalTransfer',
  isPotentialDuplicate: false,
  isInconsistent: false,
  createdAt: new Date(2026, 7, 1),
  updatedAt: new Date(2026, 7, 1),
  ...overrides,
});

test('ordinary Income and reimbursements are mutually exclusive and category-type aware', () => {
  const uncategorized = transaction('uncategorized-income', 100, 'Income');
  const salary = transaction('salary', 1_000, 'Income', { categoryId: 'income-category' });
  const reimbursement = transaction('reimbursement', 25, 'Income', { categoryId: 'expense-category' });
  const both = transaction('both', 10, 'Income', { categoryId: 'both-category' });

  assert.equal(hasExpenseCategoryAssignment(uncategorized, categories), false);
  assert.equal(isOrdinaryIncome(uncategorized, categories), true);
  assert.equal(isOrdinaryIncome(salary, categories), true);
  assert.equal(isReimbursement(salary, categories), false);
  assert.equal(isReimbursement(reimbursement, categories), true);
  assert.equal(isOrdinaryIncome(reimbursement, categories), false);
  assert.equal(isReimbursement(both, categories), true);
});

test('reporting totals exclude pending, InternalTransfer, and Adjustment while preventing double counting', () => {
  const totals = calculateReportingTotals([
    transaction('uncategorized-income', 200, 'Income'),
    transaction('salary', 1_000, 'Income', { categoryId: 'income-category' }),
    transaction('expense', -700, 'Expense', { categoryId: 'expense-category' }),
    transaction('reimbursement', 100, 'Income', { categoryId: 'expense-category' }),
    transaction('pending-reimbursement', 50, 'Income', { categoryId: 'expense-category', needsReview: true }),
    transaction('transfer', -300, 'InternalTransfer', { categoryId: 'expense-category' }),
    transaction('adjustment', 75, 'Adjustment', { categoryId: 'expense-category' }),
  ], categories);

  assert.deepEqual(totals, {
    ordinaryIncome: 1_200,
    grossExpenses: 700,
    reimbursements: 100,
    netExpenses: 600,
  });
});

test('account balances retain real cashflow semantics for categorized Income', () => {
  const account = { id: 'acc-test', openingBalance: 10 };
  const transactions = [
    transaction('expense', -70, 'Expense', { categoryId: 'expense-category' }),
    transaction('reimbursement', 25, 'Income', { categoryId: 'expense-category' }),
    transaction('pending', 1_000, 'Income', { needsReview: true }),
  ];

  assert.equal(calculateAccountBalance(account, transactions), -35);
});
