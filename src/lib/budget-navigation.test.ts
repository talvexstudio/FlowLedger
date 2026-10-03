import assert from 'node:assert/strict';
import test from 'node:test';
import { shiftBudgetMonth } from './budget-navigation';

test('shifts months within the same year', () => {
  assert.deepEqual(shiftBudgetMonth({ month: 0, year: 2026 }, 1), { month: 1, year: 2026 });
  assert.deepEqual(shiftBudgetMonth({ month: 10, year: 2026 }, 1), { month: 11, year: 2026 });
  assert.deepEqual(shiftBudgetMonth({ month: 1, year: 2026 }, -1), { month: 0, year: 2026 });
  assert.deepEqual(shiftBudgetMonth({ month: 11, year: 2026 }, -1), { month: 10, year: 2026 });
});

test('shifts across year boundaries exactly once', () => {
  assert.deepEqual(shiftBudgetMonth({ month: 11, year: 2026 }, 1), { month: 0, year: 2027 });
  assert.deepEqual(shiftBudgetMonth({ month: 0, year: 2026 }, -1), { month: 11, year: 2025 });
});

test('repeated boundary navigation remains sequential', () => {
  const next = shiftBudgetMonth(shiftBudgetMonth({ month: 11, year: 2026 }, 1), 1);
  const previous = shiftBudgetMonth(shiftBudgetMonth({ month: 0, year: 2026 }, -1), -1);

  assert.deepEqual(next, { month: 1, year: 2027 });
  assert.deepEqual(previous, { month: 10, year: 2025 });
});
