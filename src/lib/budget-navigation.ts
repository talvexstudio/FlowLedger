export type BudgetPeriod = {
  month: number;
  year: number;
};

export function shiftBudgetMonth(period: BudgetPeriod, amount: number): BudgetPeriod {
  const date = new Date(period.year, period.month + amount, 1);

  return {
    month: date.getMonth(),
    year: date.getFullYear(),
  };
}
