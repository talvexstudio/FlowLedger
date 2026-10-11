import { format } from 'date-fns';
import { jsPDF } from 'jspdf';
import {
  buildVisibleExpenseReport,
  type ExpenseReportExpansionState,
  type ExpenseReportModel,
  type ExpenseReportTransaction,
} from './expense-report';

const PAGE_MARGIN = 14;
const PAGE_BOTTOM_MARGIN = 14;
const CONTENT_WIDTH = 182;

const formatCurrency = (amount: number, currency: string) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(amount);

const formatPercentage = (value: number) =>
  new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 1 }).format(value);

const formatReimbursement = (amount: number, currency: string) =>
  formatCurrency(amount > 0 ? -amount : 0, currency);

export const getExpenseReportFilename = (report: ExpenseReportModel) =>
  `FlowLedger-Expense-Report-${format(report.periodStart, 'yyyy-MM-dd')}-to-${format(report.periodEnd, 'yyyy-MM-dd')}.pdf`;

export type ExpenseReportPdfResult = {
  document: jsPDF;
  filename: string;
  renderedCategoryCount: number;
  renderedSubcategoryCount: number;
  renderedTransactionCount: number;
  renderedReimbursementCount: number;
};

export function createExpenseReportPdf(
  report: ExpenseReportModel,
  state: ExpenseReportExpansionState
): ExpenseReportPdfResult {
  const visibleReport = buildVisibleExpenseReport(report, state);
  const document = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageHeight = document.internal.pageSize.getHeight();
  let y = PAGE_MARGIN;
  let renderedCategoryCount = 0;
  let renderedSubcategoryCount = 0;
  let renderedTransactionCount = 0;
  let renderedReimbursementCount = 0;

  const addPage = () => {
    document.addPage();
    y = PAGE_MARGIN;
  };

  const ensureSpace = (height: number) => {
    if (y + height > pageHeight - PAGE_BOTTOM_MARGIN) addPage();
  };

  const drawLines = (
    lines: string[],
    x: number,
    options: { indent?: number; fontSize?: number; fontStyle?: 'normal' | 'bold'; lineHeight?: number } = {}
  ) => {
    const fontSize = options.fontSize ?? 9;
    const lineHeight = options.lineHeight ?? 4.5;
    const indent = options.indent ?? 0;
    document.setFont('helvetica', options.fontStyle ?? 'normal');
    document.setFontSize(fontSize);
    for (const line of lines) {
      ensureSpace(lineHeight);
      document.text(line, x + indent, y);
      y += lineHeight;
    }
  };

  const drawTransaction = (transaction: ExpenseReportTransaction, indent: number) => {
    const prefix = `${format(transaction.date, 'dd/MM/yyyy')}  ${transaction.accountName}  ${transaction.kind}  `;
    const suffix = `  ${formatCurrency(transaction.amount, report.baseCurrency)}`;
    const description = document.splitTextToSize(
      `${prefix}${transaction.description}${suffix}`,
      CONTENT_WIDTH - indent
    ) as string[];
    const comment = transaction.comments
      ? document.splitTextToSize(`Comment: ${transaction.comments}`, CONTENT_WIDTH - indent - 4) as string[]
      : [];
    drawLines(description, PAGE_MARGIN, { indent, fontSize: 8.5, lineHeight: 4.2 });
    if (comment.length > 0) {
      document.setTextColor(90);
      drawLines(comment, PAGE_MARGIN, { indent: indent + 4, fontSize: 8, lineHeight: 4 });
      document.setTextColor(0);
    }
    y += 1.5;
    renderedTransactionCount += 1;
    if (transaction.kind === 'Reimbursement') renderedReimbursementCount += 1;
  };

  document.setFont('helvetica', 'bold');
  document.setFontSize(10);
  document.text('FlowLedger', PAGE_MARGIN, y);
  y += 6;
  document.setFontSize(18);
  document.text('Expense Report', PAGE_MARGIN, y);
  y += 7;
  document.setFont('helvetica', 'normal');
  document.setFontSize(9);
  document.text(`Workspace: ${report.workspaceName}`, PAGE_MARGIN, y);
  y += 4.5;
  document.text(
    `Period: ${format(report.periodStart, 'dd/MM/yyyy')} to ${format(report.periodEnd, 'dd/MM/yyyy')}`,
    PAGE_MARGIN,
    y
  );
  y += 7;

  drawLines([
    `Gross Expenses: ${formatCurrency(report.grossExpenses, report.baseCurrency)}`,
    `Reimbursements: ${formatReimbursement(report.reimbursements, report.baseCurrency)}`,
    `Net Expenses: ${formatCurrency(report.totalExpenses, report.baseCurrency)}`,
    `Contributing transactions: ${report.transactionCount}`,
    `Represented categories: ${report.categoryCount}`,
    ...(report.uncategorizedTotal > 0
      ? [`Uncategorized: ${formatCurrency(report.uncategorizedTotal, report.baseCurrency)}`]
      : []),
    `Monthly averages based on ${report.equivalentMonths.toFixed(2)} equivalent calendar months`,
  ], PAGE_MARGIN, { fontStyle: 'bold', lineHeight: 4.8 });
  y += 3;

  for (const category of visibleReport.categories) {
    renderedCategoryCount += 1;
    const categoryLines = document.splitTextToSize(
      `${category.name}  |  Amount ${formatCurrency(category.netExpense, report.baseCurrency)}  |  Monthly average ${formatCurrency(category.monthlyAverage, report.baseCurrency)}  |  ${formatPercentage(category.percentageOfTotal)}  |  ${category.transactionCount} transactions`,
      CONTENT_WIDTH - 2
    ) as string[];
    const categoryHeight = categoryLines.length * 4.5 + 2;
    ensureSpace(categoryHeight);
    document.setDrawColor(210);
    document.setFillColor(242, 244, 247);
    document.rect(PAGE_MARGIN, y - 4.5, CONTENT_WIDTH, categoryHeight, 'FD');
    drawLines(categoryLines, PAGE_MARGIN + 1, { fontStyle: 'bold', fontSize: 9, lineHeight: 4.5 });

    if (category.isUncategorized) {
      for (const transaction of category.visibleTransactions) drawTransaction(transaction, 6);
      continue;
    }

    for (const subcategory of category.visibleSubcategories) {
      renderedSubcategoryCount += 1;
      const subcategoryLines = document.splitTextToSize(
        `${subcategory.name}  |  Gross ${formatCurrency(subcategory.grossExpense, report.baseCurrency)}  |  Reimbursements ${formatReimbursement(subcategory.reimbursements, report.baseCurrency)}  |  Net ${formatCurrency(subcategory.netExpense, report.baseCurrency)}  |  Monthly average ${formatCurrency(subcategory.monthlyAverage, report.baseCurrency)}  |  ${formatPercentage(subcategory.percentageOfCategory)}  |  ${subcategory.transactionCount} transactions`,
        CONTENT_WIDTH - 6
      ) as string[];
      ensureSpace(subcategoryLines.length * 4.5);
      drawLines(subcategoryLines, PAGE_MARGIN, { indent: 4, fontStyle: 'bold', fontSize: 8.5, lineHeight: 4.5 });
      for (const transaction of subcategory.visibleTransactions) drawTransaction(transaction, 10);
    }
    y += 1.5;
  }

  const pageCount = document.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    document.setPage(pageNumber);
    document.setFont('helvetica', 'normal');
    document.setFontSize(8);
    document.setTextColor(100);
    document.text(
      `Page ${pageNumber} of ${pageCount}`,
      document.internal.pageSize.getWidth() - PAGE_MARGIN,
      pageHeight - 7,
      { align: 'right' }
    );
  }

  return {
    document,
    filename: getExpenseReportFilename(report),
    renderedCategoryCount,
    renderedSubcategoryCount,
    renderedTransactionCount,
    renderedReimbursementCount,
  };
}

export function downloadExpenseReportPdf(
  report: ExpenseReportModel,
  state: ExpenseReportExpansionState
): ExpenseReportPdfResult {
  const result = createExpenseReportPdf(report, state);
  result.document.save(result.filename);
  return result;
}
