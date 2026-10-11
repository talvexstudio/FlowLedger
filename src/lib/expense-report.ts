import type { Account, Category, Subcategory, Transaction } from './types';
import {
  calculateReportingTotals,
  isConfirmedExpense,
  isReimbursement,
  isReportingExpenseRecord,
} from './transaction-reporting';
import { calculateEquivalentCalendarMonths, calculateMonthlyAverage } from './reporting-period';

export const UNCATEGORIZED_REPORT_CATEGORY_KEY = '__uncategorized__';
export const EXPENSE_REPORT_CATEGORY_COLUMN_LABELS = [
  'Category',
  'Amount',
  'Monthly Average',
  '% of Total Expenses',
  'Transactions',
] as const;
export const EXPENSE_REPORT_SUMMARY_LABELS = [
  'Expenses',
  'Monthly Average',
  '% of Income',
  'Transactions',
  'Categories',
] as const;
const NO_SUBCATEGORY_PREFIX = '__no_subcategory__:';

export type ExpenseReportTransaction = {
  id: string;
  date: Date;
  accountName: string;
  description: string;
  comments?: string;
  kind: 'Expense' | 'Reimbursement';
  amount: number;
};

export type ExpenseReportSubcategory = {
  key: string;
  subcategoryId?: string;
  name: string;
  grossExpense: number;
  reimbursements: number;
  netExpense: number;
  monthlyAverage: number;
  percentageOfCategory: number;
  transactionCount: number;
  transactions: ExpenseReportTransaction[];
};

export type ExpenseReportCategory = {
  key: string;
  categoryId?: string;
  name: string;
  grossExpense: number;
  reimbursements: number;
  netExpense: number;
  monthlyAverage: number;
  percentageOfTotal: number;
  transactionCount: number;
  isUncategorized: boolean;
  subcategories: ExpenseReportSubcategory[];
  transactions: ExpenseReportTransaction[];
};

export type ExpenseReportModel = {
  workspaceId: string;
  workspaceName: string;
  baseCurrency: string;
  periodStart: Date;
  periodEnd: Date;
  equivalentMonths: number;
  ordinaryIncome: number;
  grossExpenses: number;
  reimbursements: number;
  totalExpenses: number;
  monthlyAverage: number;
  percentOfIncome: number;
  transactionCount: number;
  categoryCount: number;
  uncategorizedTotal: number;
  categories: ExpenseReportCategory[];
};

export type ExpenseReportExpansionState = {
  expandedCategories: Set<string>;
  expandedSubcategories: Set<string>;
};

export type VisibleExpenseReportSubcategory = ExpenseReportSubcategory & {
  isExpanded: boolean;
  visibleTransactions: ExpenseReportTransaction[];
};

export type VisibleExpenseReportCategory = ExpenseReportCategory & {
  isExpanded: boolean;
  visibleSubcategories: VisibleExpenseReportSubcategory[];
  visibleTransactions: ExpenseReportTransaction[];
};

export type VisibleExpenseReport = Omit<ExpenseReportModel, 'categories'> & {
  categories: VisibleExpenseReportCategory[];
};

type WorkspaceCategory = Category & { subcategories: Subcategory[] };

type MutableAmounts = {
  grossExpenseCents: number;
  reimbursementCents: number;
};

type MutableSubcategoryGroup = MutableAmounts & {
  key: string;
  subcategoryId?: string;
  name: string;
  transactions: ExpenseReportTransaction[];
};

type MutableCategoryGroup = MutableAmounts & {
  key: string;
  categoryId?: string;
  name: string;
  isUncategorized: boolean;
  transactions: ExpenseReportTransaction[];
  subcategories: Map<string, MutableSubcategoryGroup>;
};

const toCents = (amount: number) => Math.round(Math.abs(amount) * 100);
const fromCents = (amountCents: number) => amountCents / 100;

const compareByNetThenName = (
  left: { netExpense: number; name: string },
  right: { netExpense: number; name: string }
) => right.netExpense - left.netExpense || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });

const compareTransactions = (left: ExpenseReportTransaction, right: ExpenseReportTransaction) =>
  right.date.getTime() - left.date.getTime() || left.id.localeCompare(right.id);

export function buildExpenseReportModel(
  selectedPeriodTransactions: Transaction[],
  categories: WorkspaceCategory[],
  accounts: Pick<Account, 'id' | 'name'>[],
  metadata: {
    workspaceId: string;
    workspaceName: string;
    baseCurrency: string;
    periodStart: Date;
    periodEnd: Date;
  }
): ExpenseReportModel {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const equivalentMonths = calculateEquivalentCalendarMonths(metadata.periodStart, metadata.periodEnd);
  const reportingTotals = calculateReportingTotals(selectedPeriodTransactions, categories);
  const groups = new Map<string, MutableCategoryGroup>();
  let grossExpenseCents = 0;
  let reimbursementCents = 0;

  for (const transaction of selectedPeriodTransactions) {
    if (!isReportingExpenseRecord(transaction, categories)) continue;

    const reimbursement = isReimbursement(transaction, categories);
    const category = transaction.categoryId ? categoryById.get(transaction.categoryId) : undefined;
    if (transaction.categoryId && !category) {
      throw new Error(`Reporting transaction ${transaction.id} references an unavailable category.`);
    }
    const categoryKey = category?.id ?? UNCATEGORIZED_REPORT_CATEGORY_KEY;
    const categoryGroup = groups.get(categoryKey) ?? {
      key: categoryKey,
      categoryId: category?.id,
      name: category?.name ?? 'Uncategorized',
      isUncategorized: !category,
      grossExpenseCents: 0,
      reimbursementCents: 0,
      transactions: [],
      subcategories: new Map<string, MutableSubcategoryGroup>(),
    };
    groups.set(categoryKey, categoryGroup);

    const amountCents = toCents(transaction.amountBase);
    if (reimbursement) {
      reimbursementCents += amountCents;
      categoryGroup.reimbursementCents += amountCents;
    } else if (isConfirmedExpense(transaction)) {
      grossExpenseCents += amountCents;
      categoryGroup.grossExpenseCents += amountCents;
    }

    const reportTransaction: ExpenseReportTransaction = {
      id: transaction.id,
      date: transaction.date instanceof Date ? transaction.date : new Date(transaction.date),
      accountName: accountNames.get(transaction.accountId) ?? 'Unknown account',
      description: transaction.description,
      comments: transaction.comments?.trim() || undefined,
      kind: reimbursement ? 'Reimbursement' : 'Expense',
      amount: fromCents(reimbursement ? -amountCents : amountCents),
    };
    categoryGroup.transactions.push(reportTransaction);

    if (!category) continue;

    const subcategory = transaction.subcategoryId
      ? category.subcategories.find((candidate) => candidate.id === transaction.subcategoryId)
      : undefined;
    const subcategoryKey = subcategory?.id ?? `${NO_SUBCATEGORY_PREFIX}${category.id}`;
    const subcategoryGroup = categoryGroup.subcategories.get(subcategoryKey) ?? {
      key: subcategoryKey,
      subcategoryId: subcategory?.id,
      name: subcategory?.name ?? 'No subcategory',
      grossExpenseCents: 0,
      reimbursementCents: 0,
      transactions: [],
    };
    categoryGroup.subcategories.set(subcategoryKey, subcategoryGroup);
    if (reimbursement) subcategoryGroup.reimbursementCents += amountCents;
    else subcategoryGroup.grossExpenseCents += amountCents;
    subcategoryGroup.transactions.push(reportTransaction);
  }

  const totalExpenses = fromCents(grossExpenseCents - reimbursementCents);
  const monthlyAverage = calculateMonthlyAverage(totalExpenses, equivalentMonths);
  const percentOfIncome = reportingTotals.ordinaryIncome > 0
    ? totalExpenses / reportingTotals.ordinaryIncome
    : 0;
  const reportCategories = Array.from(groups.values()).map<ExpenseReportCategory>((group) => {
    const netExpenseCents = group.grossExpenseCents - group.reimbursementCents;
    return {
      key: group.key,
      categoryId: group.categoryId,
      name: group.name,
      grossExpense: fromCents(group.grossExpenseCents),
      reimbursements: fromCents(group.reimbursementCents),
      netExpense: fromCents(netExpenseCents),
      monthlyAverage: calculateMonthlyAverage(fromCents(netExpenseCents), equivalentMonths),
      percentageOfTotal: totalExpenses > 0 ? fromCents(netExpenseCents) / totalExpenses : 0,
      transactionCount: group.transactions.length,
      isUncategorized: group.isUncategorized,
      transactions: [...group.transactions].sort(compareTransactions),
      subcategories: Array.from(group.subcategories.values())
        .map((subcategory) => {
          const subcategoryNetCents = subcategory.grossExpenseCents - subcategory.reimbursementCents;
          return {
            key: subcategory.key,
            subcategoryId: subcategory.subcategoryId,
            name: subcategory.name,
            grossExpense: fromCents(subcategory.grossExpenseCents),
            reimbursements: fromCents(subcategory.reimbursementCents),
            netExpense: fromCents(subcategoryNetCents),
            monthlyAverage: calculateMonthlyAverage(fromCents(subcategoryNetCents), equivalentMonths),
            percentageOfCategory: netExpenseCents !== 0 ? subcategoryNetCents / netExpenseCents : 0,
            transactionCount: subcategory.transactions.length,
            transactions: [...subcategory.transactions].sort(compareTransactions),
          };
        })
        .sort(compareByNetThenName),
    };
  }).sort(compareByNetThenName);

  return {
    ...metadata,
    periodStart: new Date(metadata.periodStart),
    periodEnd: new Date(metadata.periodEnd),
    equivalentMonths,
    ordinaryIncome: reportingTotals.ordinaryIncome,
    grossExpenses: fromCents(grossExpenseCents),
    reimbursements: fromCents(reimbursementCents),
    totalExpenses,
    monthlyAverage,
    percentOfIncome,
    transactionCount: reportCategories.reduce((sum, category) => sum + category.transactionCount, 0),
    categoryCount: reportCategories.length,
    uncategorizedTotal: reportCategories.find((category) => category.isUncategorized)?.netExpense ?? 0,
    categories: reportCategories,
  };
}

export const createCollapsedExpenseReportState = (): ExpenseReportExpansionState => ({
  expandedCategories: new Set<string>(),
  expandedSubcategories: new Set<string>(),
});

export const expandAllExpenseReportSections = (
  report: ExpenseReportModel
): ExpenseReportExpansionState => ({
  expandedCategories: new Set(report.categories.map((category) => category.key)),
  expandedSubcategories: new Set(
    report.categories.flatMap((category) => category.subcategories.map((subcategory) => subcategory.key))
  ),
});

export const collapseAllExpenseReportSections = createCollapsedExpenseReportState;

export function toggleExpenseReportCategory(
  state: ExpenseReportExpansionState,
  categoryKey: string
): ExpenseReportExpansionState {
  const expandedCategories = new Set(state.expandedCategories);
  if (expandedCategories.has(categoryKey)) expandedCategories.delete(categoryKey);
  else expandedCategories.add(categoryKey);
  return { expandedCategories, expandedSubcategories: new Set(state.expandedSubcategories) };
}

export function toggleExpenseReportSubcategory(
  state: ExpenseReportExpansionState,
  subcategoryKey: string
): ExpenseReportExpansionState {
  const expandedSubcategories = new Set(state.expandedSubcategories);
  if (expandedSubcategories.has(subcategoryKey)) expandedSubcategories.delete(subcategoryKey);
  else expandedSubcategories.add(subcategoryKey);
  return { expandedCategories: new Set(state.expandedCategories), expandedSubcategories };
}

export function buildVisibleExpenseReport(
  report: ExpenseReportModel,
  state: ExpenseReportExpansionState
): VisibleExpenseReport {
  return {
    ...report,
    categories: report.categories.map((category) => {
      const isExpanded = state.expandedCategories.has(category.key);
      return {
        ...category,
        isExpanded,
        visibleTransactions: isExpanded && category.isUncategorized ? category.transactions : [],
        visibleSubcategories: isExpanded
          ? category.subcategories.map((subcategory) => {
              const subcategoryExpanded = state.expandedSubcategories.has(subcategory.key);
              return {
                ...subcategory,
                isExpanded: subcategoryExpanded,
                visibleTransactions: subcategoryExpanded ? subcategory.transactions : [],
              };
            })
          : [],
      };
    }),
  };
}

export function assertExpenseReportReconciles(report: ExpenseReportModel): void {
  const totalCents = Math.round(report.totalExpenses * 100);
  const categoryNetCents = report.categories.reduce(
    (sum, category) => sum + Math.round(category.netExpense * 100),
    0
  );
  if (categoryNetCents !== totalCents) {
    throw new Error('Expense report categories do not reconcile to net expenses.');
  }
  if (Math.round((report.grossExpenses - report.reimbursements) * 100) !== totalCents) {
    throw new Error('Expense report gross expenses and reimbursements do not reconcile to net expenses.');
  }
  const categoryMonthlyAverage = report.categories.reduce(
    (sum, category) => sum + category.monthlyAverage,
    0
  );
  if (Math.abs(categoryMonthlyAverage - report.monthlyAverage) > 1e-9) {
    throw new Error('Expense report category monthly averages do not reconcile to the report monthly average.');
  }

  for (const category of report.categories) {
    const categoryCents = Math.round(category.netExpense * 100);
    const transactionCents = category.transactions.reduce(
      (sum, transaction) => sum + Math.round(transaction.amount * 100),
      0
    );
    if (transactionCents !== categoryCents) {
      throw new Error(`Expense report category ${category.key} does not reconcile to its transactions.`);
    }
    if (Math.round((category.grossExpense - category.reimbursements) * 100) !== categoryCents) {
      throw new Error(`Expense report category ${category.key} does not reconcile gross and reimbursement amounts.`);
    }
    if (!category.isUncategorized) {
      const subcategoryCents = category.subcategories.reduce(
        (sum, subcategory) => sum + Math.round(subcategory.netExpense * 100),
        0
      );
      if (subcategoryCents !== categoryCents) {
        throw new Error(`Expense report category ${category.key} does not reconcile to its subcategories.`);
      }
    }
  }
}
