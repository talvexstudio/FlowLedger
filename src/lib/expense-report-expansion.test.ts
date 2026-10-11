import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildVisibleExpenseReport,
  collapseAllExpenseReportSections,
  createCollapsedExpenseReportState,
  expandAllExpenseReportSections,
  toggleExpenseReportCategory,
  toggleExpenseReportSubcategory,
  type ExpenseReportModel,
} from './expense-report';

const report: ExpenseReportModel = {
  workspaceId: 'ws-test',
  workspaceName: 'Personal',
  baseCurrency: 'EUR',
  periodStart: new Date(2026, 7, 1),
  periodEnd: new Date(2026, 8, 30),
  equivalentMonths: 2,
  ordinaryIncome: 300,
  grossExpenses: 150,
  reimbursements: 0,
  totalExpenses: 150,
  monthlyAverage: 75,
  percentOfIncome: 0.5,
  transactionCount: 3,
  categoryCount: 2,
  uncategorizedTotal: 0,
  categories: [
    {
      key: 'housing', categoryId: 'housing', name: 'Housing', grossExpense: 100, reimbursements: 0, netExpense: 100, monthlyAverage: 50,
      percentageOfTotal: 2 / 3, transactionCount: 2, isUncategorized: false, transactions: [],
      subcategories: [
        { key: 'rent', subcategoryId: 'rent', name: 'Rent', grossExpense: 80, reimbursements: 0, netExpense: 80, monthlyAverage: 40, percentageOfCategory: 0.8, transactionCount: 1, transactions: [] },
        { key: 'maintenance', subcategoryId: 'maintenance', name: 'Maintenance', grossExpense: 20, reimbursements: 0, netExpense: 20, monthlyAverage: 10, percentageOfCategory: 0.2, transactionCount: 1, transactions: [] },
      ],
    },
    {
      key: 'food', categoryId: 'food', name: 'Food', grossExpense: 50, reimbursements: 0, netExpense: 50, monthlyAverage: 25,
      percentageOfTotal: 1 / 3, transactionCount: 1, isUncategorized: false, transactions: [],
      subcategories: [
        { key: 'groceries', subcategoryId: 'groceries', name: 'Groceries', grossExpense: 50, reimbursements: 0, netExpense: 50, monthlyAverage: 25, percentageOfCategory: 1, transactionCount: 1, transactions: [] },
      ],
    },
  ],
};

test('categories and subcategories expand independently', () => {
  let state = createCollapsedExpenseReportState();
  state = toggleExpenseReportCategory(state, 'housing');
  state = toggleExpenseReportSubcategory(state, 'rent');
  const visible = buildVisibleExpenseReport(report, state);

  assert.equal(visible.categories[0].isExpanded, true);
  assert.equal(visible.categories[1].isExpanded, false);
  assert.equal(visible.categories[0].visibleSubcategories[0].isExpanded, true);
  assert.equal(visible.categories[0].visibleSubcategories[1].isExpanded, false);
  assert.equal(state.expandedCategories.has('food'), false);
  assert.equal(state.expandedSubcategories.has('maintenance'), false);
});

test('Expand all opens every category/subcategory and manual changes remain independent', () => {
  let state = expandAllExpenseReportSections(report);
  assert.deepEqual([...state.expandedCategories], ['housing', 'food']);
  assert.deepEqual([...state.expandedSubcategories], ['rent', 'maintenance', 'groceries']);

  state = toggleExpenseReportSubcategory(state, 'maintenance');
  assert.equal(state.expandedCategories.size, 2);
  assert.equal(state.expandedSubcategories.has('rent'), true);
  assert.equal(state.expandedSubcategories.has('maintenance'), false);
});

test('Collapse all closes every section and manual expansion still works', () => {
  let state = collapseAllExpenseReportSections();
  assert.equal(state.expandedCategories.size, 0);
  assert.equal(state.expandedSubcategories.size, 0);

  state = toggleExpenseReportCategory(state, 'food');
  assert.deepEqual([...state.expandedCategories], ['food']);
  assert.equal(state.expandedSubcategories.size, 0);
});
