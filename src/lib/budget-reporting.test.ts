import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateBudgetActualSpending, calculateBudgetPosition } from './budget-reporting';
import type { Category, Transaction } from './types';

const categories: Pick<Category, 'id' | 'type'>[] = [
  { id: 'groceries', type: 'expense' },
];

const transaction = (
  id: string,
  amountBase: number,
  type: Transaction['type'],
  overrides: Partial<Transaction> = {}
): Transaction => ({
  id, workspaceId: 'ws-test', accountId: 'acc-test', date: new Date(2026, 7, 15),
  description: id, rawDescription: id, amountOriginal: amountBase, currencyOriginal: 'EUR',
  amountBase, type, categoryId: 'groceries', subcategoryId: 'supermarket', needsReview: false,
  isInternalTransfer: type === 'InternalTransfer', isPotentialDuplicate: false, isInconsistent: false,
  createdAt: new Date(2026, 7, 15), updatedAt: new Date(2026, 7, 15), ...overrides,
});

test('budget used and remaining reflect reimbursement-aware net spending', () => {
  const actuals = calculateBudgetActualSpending([
    transaction('expense', -400, 'Expense'),
    transaction('reimbursement', 100, 'Income'),
    transaction('pending-reimbursement', 50, 'Income', { needsReview: true }),
    transaction('other-month-expense', -1_000, 'Expense', { date: new Date(2026, 6, 31) }),
  ], categories, { categoryId: 'groceries', month: 7, year: 2026 });
  const position = calculateBudgetPosition(500, actuals);

  assert.equal(actuals.grossExpenses, 400);
  assert.equal(actuals.reimbursements, 100);
  assert.equal(actuals.netExpenses, 300);
  assert.deepEqual(position, { used: 300, remaining: 200, progress: 60 });
});

test('subcategory budget scope and reimbursement-only periods preserve negative actual spending', () => {
  const actuals = calculateBudgetActualSpending([
    transaction('supermarket-refund', 75, 'Income'),
    transaction('other-subcategory', -20, 'Expense', { subcategoryId: 'market' }),
  ], categories, {
    categoryId: 'groceries',
    subcategoryId: 'supermarket',
    month: 7,
    year: 2026,
  });
  const position = calculateBudgetPosition(500, actuals);

  assert.equal(actuals.netExpenses, -75);
  assert.equal(position.used, -75);
  assert.equal(position.remaining, 575);
  assert.equal(position.progress, 0);
});
