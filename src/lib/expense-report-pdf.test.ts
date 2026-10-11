import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UNCATEGORIZED_REPORT_CATEGORY_KEY,
  createCollapsedExpenseReportState,
  expandAllExpenseReportSections,
  type ExpenseReportModel,
} from './expense-report';
import { createExpenseReportPdf, getExpenseReportFilename } from './expense-report-pdf';

const tx = (
  id: string,
  description = `Transaction ${id}`,
  kind: 'Expense' | 'Reimbursement' = 'Expense',
  amount = kind === 'Reimbursement' ? -10 : 10
) => ({
  id,
  date: new Date(2026, 7, 10, 12),
  accountName: 'Main Bank',
  description,
  kind,
  amount,
});

const model: ExpenseReportModel = {
  workspaceId: 'ws-test',
  workspaceName: 'Personal',
  baseCurrency: 'EUR',
  periodStart: new Date(2026, 7, 1),
  periodEnd: new Date(2026, 8, 30),
  equivalentMonths: 2,
  ordinaryIncome: 100,
  grossExpenses: 50,
  reimbursements: 10,
  totalExpenses: 40,
  monthlyAverage: 20,
  percentOfIncome: 0.4,
  transactionCount: 4,
  categoryCount: 2,
  uncategorizedTotal: 10,
  categories: [
    {
      key: 'housing', categoryId: 'housing', name: 'Housing', grossExpense: 40, reimbursements: 10, netExpense: 30, monthlyAverage: 15,
      percentageOfTotal: 0.75, transactionCount: 3, isUncategorized: false,
      transactions: [tx('rent', undefined, 'Expense', 20), tx('repair', undefined, 'Expense', 20), tx('refund', undefined, 'Reimbursement')],
      subcategories: [
        { key: 'rent', subcategoryId: 'rent', name: 'Rent', grossExpense: 20, reimbursements: 0, netExpense: 20, monthlyAverage: 10, percentageOfCategory: 2 / 3, transactionCount: 1, transactions: [tx('rent', undefined, 'Expense', 20)] },
        { key: 'maintenance', subcategoryId: 'maintenance', name: 'Maintenance', grossExpense: 20, reimbursements: 10, netExpense: 10, monthlyAverage: 5, percentageOfCategory: 1 / 3, transactionCount: 2, transactions: [tx('repair', undefined, 'Expense', 20), tx('refund', undefined, 'Reimbursement')] },
      ],
    },
    {
      key: UNCATEGORIZED_REPORT_CATEGORY_KEY, name: 'Uncategorized', grossExpense: 10, reimbursements: 0, netExpense: 10, monthlyAverage: 5,
      percentageOfTotal: 0.25, transactionCount: 1, isUncategorized: true,
      transactions: [tx('uncategorized')], subcategories: [],
    },
  ],
};

test('PDF filename reflects the selected period', () => {
  assert.equal(
    getExpenseReportFilename(model),
    'FlowLedger-Expense-Report-2026-08-01-to-2026-09-30.pdf'
  );
});

test('collapsed PDF contains category summaries only', () => {
  const result = createExpenseReportPdf(model, createCollapsedExpenseReportState());
  assert.equal(result.renderedCategoryCount, 2);
  assert.equal(result.renderedSubcategoryCount, 0);
  assert.equal(result.renderedTransactionCount, 0);
});

test('PDF preserves mixed category and subcategory visibility', () => {
  const result = createExpenseReportPdf(model, {
    expandedCategories: new Set(['housing']),
    expandedSubcategories: new Set(['rent']),
  });

  assert.equal(result.renderedCategoryCount, 2);
  assert.equal(result.renderedSubcategoryCount, 2);
  assert.equal(result.renderedTransactionCount, 1);
});

test('expanded Uncategorized category exports its transactions directly', () => {
  const result = createExpenseReportPdf(model, {
    expandedCategories: new Set([UNCATEGORIZED_REPORT_CATEGORY_KEY]),
    expandedSubcategories: new Set(),
  });
  assert.equal(result.renderedSubcategoryCount, 0);
  assert.equal(result.renderedTransactionCount, 1);
});

test('Expand all PDF includes all visible detail', () => {
  const result = createExpenseReportPdf(model, expandAllExpenseReportSections(model));
  assert.equal(result.renderedCategoryCount, 2);
  assert.equal(result.renderedSubcategoryCount, 2);
  assert.equal(result.renderedTransactionCount, 4);
  assert.equal(result.renderedReimbursementCount, 1);
});

test('long PDF reports paginate without dropping visible transaction rows', () => {
  const transactions = Array.from({ length: 120 }, (_, index) =>
    tx(`long-${index}`, `A long but readable expense description ${index} `.repeat(4))
  );
  const longModel: ExpenseReportModel = {
    ...model,
    grossExpenses: 1_200,
    reimbursements: 0,
    totalExpenses: 1_200,
    transactionCount: transactions.length,
    categoryCount: 1,
    uncategorizedTotal: 1_200,
    categories: [{
      key: UNCATEGORIZED_REPORT_CATEGORY_KEY,
      name: 'Uncategorized',
      grossExpense: 1_200,
      reimbursements: 0,
      netExpense: 1_200,
      monthlyAverage: 600,
      percentageOfTotal: 1,
      transactionCount: transactions.length,
      isUncategorized: true,
      transactions,
      subcategories: [],
    }],
  };

  const result = createExpenseReportPdf(longModel, expandAllExpenseReportSections(longModel));
  assert.ok(result.document.getNumberOfPages() > 1);
  assert.equal(result.renderedTransactionCount, transactions.length);
});
