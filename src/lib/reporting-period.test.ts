import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateEquivalentCalendarMonths, calculateMonthlyAverage } from './reporting-period';

const closeTo = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);

test('full two-month range equals two equivalent calendar months', () => {
  closeTo(calculateEquivalentCalendarMonths(new Date(2026, 7, 1), new Date(2026, 8, 30)), 2);
});

test('partial first month plus full second month uses exact month fractions', () => {
  closeTo(
    calculateEquivalentCalendarMonths(new Date(2026, 7, 15), new Date(2026, 8, 30)),
    17 / 31 + 30 / 30
  );
});

test('full first month plus partial second month uses exact month fractions', () => {
  closeTo(
    calculateEquivalentCalendarMonths(new Date(2026, 7, 1), new Date(2026, 8, 15)),
    31 / 31 + 15 / 30
  );
});

test('single full and partial calendar months are calculated independently', () => {
  closeTo(calculateEquivalentCalendarMonths(new Date(2026, 7, 1), new Date(2026, 7, 31)), 1);
  closeTo(calculateEquivalentCalendarMonths(new Date(2026, 7, 10), new Date(2026, 7, 20)), 11 / 31);
});

test('leap-year February uses 29 calendar days', () => {
  closeTo(calculateEquivalentCalendarMonths(new Date(2028, 1, 1), new Date(2028, 1, 15)), 15 / 29);
});

test('monthly average preserves signed net values and handles zero coverage safely', () => {
  assert.equal(calculateMonthlyAverage(600, 2), 300);
  assert.equal(calculateMonthlyAverage(-120, 2), -60);
  assert.equal(calculateMonthlyAverage(0, 2), 0);
  assert.equal(calculateMonthlyAverage(100, 0), 0);
});
