const roundNearestInteger = (value: number) => {
  const magnitude = Math.abs(value);
  const tolerance = Number.EPSILON * Math.max(1, magnitude) * 4;
  const roundedMagnitude = Math.round(magnitude + tolerance);
  return value < 0 ? -roundedMagnitude : roundedMagnitude;
};

/** Converts a decimal currency amount to integer cents using nearest-cent rounding. */
export function moneyToCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error('Money amount must be finite.');
  return roundNearestInteger(amount * 100);
}

export const centsToMoney = (cents: number) => cents / 100;

export const roundMoneyToNearestCent = (amount: number) => centsToMoney(moneyToCents(amount));

/** Divides an integer-cent total and rounds the resulting average to the nearest cent. */
export function divideMoneyCents(totalCents: number, divisor: number): number {
  if (!Number.isFinite(totalCents) || !Number.isFinite(divisor) || divisor <= 0) return 0;
  return centsToMoney(roundNearestInteger(totalCents / divisor));
}
