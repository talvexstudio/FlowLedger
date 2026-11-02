'use client';

import { KpiCard } from '@/components/dashboard/kpi-card';
import { OverviewChart } from '@/components/dashboard/overview-chart';
import { ExpensesChart } from '@/components/dashboard/expenses-chart';
import { ReviewTransactions } from '@/components/dashboard/review-transactions';
import { selectTransactionsToReview } from '@/lib/transaction-review';
import { DashboardDateRangePicker, getDefaultDateRange, type DashboardDateRange } from '@/components/dashboard/date-range-picker';
import { DollarSign, ArrowUp, ArrowDown, PiggyBank, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useEffect, useMemo, useState } from 'react';
import { useFlowLedger } from '@/hooks/use-flow-ledger';
import { buildDashboardReport } from '@/app/(app)/dashboard/utils';
import { ExpenseReportDialog } from '@/components/dashboard/expense-report-dialog';
import { buildExpenseReportModel } from '@/lib/expense-report';
import { usePersistedViewState } from '@/hooks/use-persisted-view-state';
import {
  fromDateOnlyString,
  isDashboardViewState,
  toDateOnlyString,
} from '@/lib/screen-view-state';
import { getViewStateStorageKey } from '@/lib/view-state';

export default function DashboardPage() {
  const { 
    accounts,
    workspaces,
    transactions, 
    categories,
    workspaceId
  } = useFlowLedger();

  const [showExpenseReport, setShowExpenseReport] = useState(false);
  const defaultDateRange = useMemo(getDefaultDateRange, []);
  const defaultDashboardViewState = useMemo(() => ({
    start: toDateOnlyString(defaultDateRange.start),
    end: toDateOnlyString(defaultDateRange.end),
    preset: defaultDateRange.preset,
  }), [defaultDateRange]);
  const dashboardViewStateKey = workspaceId
    ? getViewStateStorageKey('dashboard', workspaceId)
    : null;
  const [dashboardViewState, setDashboardViewState] = usePersistedViewState(
    dashboardViewStateKey,
    defaultDashboardViewState,
    isDashboardViewState
  );
  const dateRange = useMemo<DashboardDateRange>(() => ({
    start: fromDateOnlyString(dashboardViewState.start) ?? defaultDateRange.start,
    end: fromDateOnlyString(dashboardViewState.end) ?? defaultDateRange.end,
    preset: dashboardViewState.preset,
  }), [dashboardViewState, defaultDateRange]);

  useEffect(() => {
    setShowExpenseReport(false);
  }, [workspaceId]);

  const dashboardReport = useMemo(
    () => buildDashboardReport(
      transactions,
      categories,
      dateRange.start,
      dateRange.end
    ),
    [transactions, categories, dateRange]
  );

  const { totals, averages, overviewData, expenseCategoryData, grouping } = dashboardReport;

  const currentWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
  const expenseReport = useMemo(
    () => buildExpenseReportModel(
      dashboardReport.selectedPeriodTransactions,
      categories,
      accounts,
      {
        workspaceId: workspaceId ?? '',
        workspaceName: currentWorkspace?.name ?? 'No workspace',
        baseCurrency: currentWorkspace?.baseCurrency ?? 'EUR',
        periodStart: dateRange.start,
        periodEnd: dateRange.end,
      }
    ),
    [dashboardReport.selectedPeriodTransactions, categories, accounts, workspaceId, currentWorkspace, dateRange]
  );

  const currencyFormatter = useMemo(() => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  }, []);

  const percentFormatter = useMemo(() => {
    return new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1 });
  }, []);
  
  const transactionsToReview = selectTransactionsToReview(transactions);

  return (
    <>
      <div className="flex-1 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DashboardDateRangePicker
            value={dateRange}
            onChange={(range) => setDashboardViewState({
              start: toDateOnlyString(range.start),
              end: toDateOnlyString(range.end),
              preset: range.preset,
            })}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <KpiCard
            title="Total Income"
            value={`€${totals.income.toFixed(2)}`}
            icon={<ArrowUp className="h-4 w-4 text-muted-foreground" />}
            description="Selected period"
          />
          <KpiCard
            title="Total Expenses"
            value={`€${totals.expenses.toFixed(2)}`}
            icon={<ArrowDown className="h-4 w-4 text-muted-foreground" />}
            description="Selected period"
          />
          <KpiCard
            title="Net Balance"
            value={`€${totals.net.toFixed(2)}`}
            icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
            description="Income minus expenses"
          />
          <KpiCard
            title="Savings Rate"
            value={`${(totals.savingsRate * 100).toFixed(1)}%`}
            icon={<PiggyBank className="h-4 w-4 text-muted-foreground" />}
            description="Net / Income"
          />
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Monthly Average</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{averages.description}</p>
              <div className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Income</span>
                  <span className="font-semibold">{currencyFormatter.format(averages.income)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Expenses</span>
                  <span className="font-semibold">{currencyFormatter.format(averages.expenses)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Savings rate</span>
                  <span className="font-semibold">{percentFormatter.format(averages.savingsRate)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <div className="col-span-12 lg:col-span-4">
            <OverviewChart data={overviewData} grouping={grouping} />
          </div>
          <div className="col-span-12 lg:col-span-3">
            <ExpensesChart data={expenseCategoryData} onViewReport={() => setShowExpenseReport(true)} />
          </div>
        </div>
        <div className="grid gap-4">
          <ReviewTransactions transactions={transactionsToReview} />
        </div>
      </div>
      <ExpenseReportDialog
        open={showExpenseReport}
        onOpenChange={setShowExpenseReport}
        report={expenseReport}
      />
    </>
  );
}



