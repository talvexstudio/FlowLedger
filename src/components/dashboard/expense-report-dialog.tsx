'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
  buildVisibleExpenseReport,
  collapseAllExpenseReportSections,
  createCollapsedExpenseReportState,
  EXPENSE_REPORT_CATEGORY_COLUMN_LABELS,
  EXPENSE_REPORT_SUMMARY_LABELS,
  expandAllExpenseReportSections,
  toggleExpenseReportCategory,
  toggleExpenseReportSubcategory,
  type ExpenseReportExpansionState,
  type ExpenseReportModel,
  type ExpenseReportTransaction,
} from '@/lib/expense-report';

type ExpenseReportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: ExpenseReportModel;
};

function TransactionRows({
  transactions,
  currencyFormatter,
  colSpan,
}: {
  transactions: ExpenseReportTransaction[];
  currencyFormatter: Intl.NumberFormat;
  colSpan: number;
}) {
  if (transactions.length === 0) return null;

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="bg-muted/20 px-6 py-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Date</TableHead>
              <TableHead className="w-40">Account</TableHead>
              <TableHead className="w-32">Kind</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Comments</TableHead>
              <TableHead className="w-32 text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((transaction) => (
              <TableRow key={transaction.id}>
                <TableCell className="whitespace-nowrap">{format(transaction.date, 'dd/MM/yyyy')}</TableCell>
                <TableCell>{transaction.accountName}</TableCell>
                <TableCell>
                  <span className={transaction.kind === 'Reimbursement' ? 'font-medium text-green-600' : ''}>
                    {transaction.kind}
                  </span>
                </TableCell>
                <TableCell className="min-w-56 max-w-md whitespace-normal break-words">
                  {transaction.description}
                </TableCell>
                <TableCell className="min-w-40 max-w-sm whitespace-normal break-words text-muted-foreground">
                  {transaction.comments ?? ''}
                </TableCell>
                <TableCell className={`whitespace-nowrap text-right font-medium ${
                  transaction.kind === 'Reimbursement' ? 'text-green-600' : ''
                }`}>
                  {currencyFormatter.format(transaction.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCell>
    </TableRow>
  );
}

export function ExpenseReportDialog({ open, onOpenChange, report }: ExpenseReportDialogProps) {
  const { toast } = useToast();
  const [expansionState, setExpansionState] = useState<ExpenseReportExpansionState>(
    createCollapsedExpenseReportState
  );
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (open) setExpansionState(createCollapsedExpenseReportState());
  }, [open, report.workspaceId, report.periodStart, report.periodEnd]);

  const visibleReport = useMemo(
    () => buildVisibleExpenseReport(report, expansionState),
    [report, expansionState]
  );
  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat('de-DE', { style: 'currency', currency: report.baseCurrency }),
    [report.baseCurrency]
  );
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1 }),
    []
  );
  const formatReimbursement = (amount: number) =>
    currencyFormatter.format(amount > 0 ? -amount : 0);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const { downloadExpenseReportPdf } = await import('@/lib/expense-report-pdf');
      downloadExpenseReportPdf(report, expansionState);
    } catch (error) {
      console.error('Failed to export expense report PDF:', error);
      toast({
        variant: 'destructive',
        title: 'Could not export PDF',
        description: 'The expense report could not be generated. Please try again.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[96vw] max-w-[96vw] flex-col gap-0 p-0 sm:max-w-[90rem]">
        <DialogHeader className="border-b px-6 py-5 pr-12">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <DialogTitle className="text-2xl">Expense Report</DialogTitle>
              <DialogDescription className="mt-2">
                {report.workspaceName} · {format(report.periodStart, 'dd/MM/yyyy')} to {format(report.periodEnd, 'dd/MM/yyyy')}
              </DialogDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setExpansionState(expandAllExpenseReportSections(report))}
              >
                Expand all
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setExpansionState(collapseAllExpenseReportSections())}
              >
                Collapse all
              </Button>
              <Button type="button" size="sm" onClick={handleExport} disabled={isExporting}>
                <Download />
                {isExporting ? 'Exporting…' : 'Export PDF'}
              </Button>
              <DialogClose asChild>
                <Button type="button" variant="outline" size="sm">Close</Button>
              </DialogClose>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">{EXPENSE_REPORT_SUMMARY_LABELS[0]}</p>
              <p className="mt-1 text-xl font-semibold">{currencyFormatter.format(report.totalExpenses)}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">{EXPENSE_REPORT_SUMMARY_LABELS[1]}</p>
              <p className="mt-1 text-xl font-semibold">{currencyFormatter.format(report.monthlyAverage)}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">{EXPENSE_REPORT_SUMMARY_LABELS[2]}</p>
              <p className="mt-1 text-xl font-semibold">{percentFormatter.format(report.percentOfIncome)}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">{EXPENSE_REPORT_SUMMARY_LABELS[3]}</p>
              <p className="mt-1 text-xl font-semibold">{report.transactionCount}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">{EXPENSE_REPORT_SUMMARY_LABELS[4]}</p>
              <p className="mt-1 text-xl font-semibold">{report.categoryCount}</p>
            </div>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Monthly averages based on {report.equivalentMonths.toFixed(2)} equivalent calendar months.
          </p>

          {visibleReport.categories.length === 0 ? (
            <div className="rounded-lg border p-10 text-center text-muted-foreground">
              No confirmed expenses in the selected period.
            </div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{EXPENSE_REPORT_CATEGORY_COLUMN_LABELS[0]}</TableHead>
                    <TableHead className="w-40 text-right">{EXPENSE_REPORT_CATEGORY_COLUMN_LABELS[1]}</TableHead>
                    <TableHead className="w-40 text-right">{EXPENSE_REPORT_CATEGORY_COLUMN_LABELS[2]}</TableHead>
                    <TableHead className="w-40 text-right">{EXPENSE_REPORT_CATEGORY_COLUMN_LABELS[3]}</TableHead>
                    <TableHead className="w-36 text-right">{EXPENSE_REPORT_CATEGORY_COLUMN_LABELS[4]}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleReport.categories.map((category) => (
                    <Fragment key={category.key}>
                      <TableRow className="bg-muted/30 font-medium">
                        <TableCell>
                          <button
                            type="button"
                            className="flex items-center gap-2 text-left font-semibold hover:underline"
                            aria-expanded={category.isExpanded}
                            onClick={() => setExpansionState((current) => toggleExpenseReportCategory(current, category.key))}
                          >
                            {category.isExpanded ? <ChevronDown /> : <ChevronRight />}
                            {category.name}
                          </button>
                        </TableCell>
                        <TableCell className="text-right">{currencyFormatter.format(category.netExpense)}</TableCell>
                        <TableCell className="text-right">{currencyFormatter.format(category.monthlyAverage)}</TableCell>
                        <TableCell className="text-right">{percentFormatter.format(category.percentageOfTotal)}</TableCell>
                        <TableCell className="text-right">{category.transactionCount}</TableCell>
                      </TableRow>

                      {category.isUncategorized ? (
                        <TransactionRows
                          transactions={category.visibleTransactions}
                          currencyFormatter={currencyFormatter}
                          colSpan={5}
                        />
                      ) : category.visibleSubcategories.length > 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={5} className="bg-muted/10 px-6 py-3">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Subcategory</TableHead>
                                  <TableHead className="w-32 text-right">Gross</TableHead>
                                  <TableHead className="w-36 text-right">Reimbursements</TableHead>
                                  <TableHead className="w-32 text-right">Net</TableHead>
                                  <TableHead className="w-36 text-right">Monthly Average</TableHead>
                                  <TableHead className="w-32 text-right">% of Category</TableHead>
                                  <TableHead className="w-28 text-right">Transactions</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {category.visibleSubcategories.map((subcategory) => (
                                  <Fragment key={subcategory.key}>
                                    <TableRow>
                                      <TableCell>
                                        <button
                                          type="button"
                                          className="flex items-center gap-2 text-left hover:underline"
                                          aria-expanded={subcategory.isExpanded}
                                          onClick={() => setExpansionState((current) =>
                                            toggleExpenseReportSubcategory(current, subcategory.key)
                                          )}
                                        >
                                          {subcategory.isExpanded ? <ChevronDown /> : <ChevronRight />}
                                          {subcategory.name}
                                        </button>
                                      </TableCell>
                                      <TableCell className="text-right">{currencyFormatter.format(subcategory.grossExpense)}</TableCell>
                                      <TableCell className="text-right text-green-600">
                                        {formatReimbursement(subcategory.reimbursements)}
                                      </TableCell>
                                      <TableCell className="text-right">{currencyFormatter.format(subcategory.netExpense)}</TableCell>
                                      <TableCell className="text-right">{currencyFormatter.format(subcategory.monthlyAverage)}</TableCell>
                                      <TableCell className="text-right">{percentFormatter.format(subcategory.percentageOfCategory)}</TableCell>
                                      <TableCell className="text-right">{subcategory.transactionCount}</TableCell>
                                    </TableRow>
                                    <TransactionRows
                                      transactions={subcategory.visibleTransactions}
                                      currencyFormatter={currencyFormatter}
                                      colSpan={7}
                                    />
                                  </Fragment>
                                ))}
                              </TableBody>
                            </Table>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
