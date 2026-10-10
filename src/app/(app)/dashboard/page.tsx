'use client';

import { KpiCard } from '@/components/dashboard/kpi-card';
import { OverviewChart } from '@/components/dashboard/overview-chart';
import { ExpensesChart } from '@/components/dashboard/expenses-chart';
import { ReviewTransactions } from '@/components/dashboard/review-transactions';
import { DashboardDateRangePicker, getDefaultDateRange, type DashboardDateRange } from '@/components/dashboard/date-range-picker';
import { DollarSign, ArrowUp, ArrowDown, PiggyBank, Sparkles, TriangleAlert, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useMemo, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useFlowLedger } from '@/hooks/use-flow-ledger';
import { apiSeedDemoData } from '@/lib/api';
import { buildDashboardReport } from '@/app/(app)/dashboard/utils';

export default function DashboardPage() {
  const { toast } = useToast();
  const { 
    accounts, 
    transactions, 
    categories,
    workspaceId, 
    reloadAccounts, 
    reloadTransactions 
  } = useFlowLedger();

  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [dateRange, setDateRange] = useState<DashboardDateRange>(getDefaultDateRange);

  const loadDemoData = async () => {
    if (!workspaceId) {
      toast({
        variant: 'destructive',
        title: 'No workspace selected',
        description: 'Please select or create a workspace first.',
      });
      return;
    }
    try {
      await apiSeedDemoData(workspaceId, false);
      reloadAccounts();
      reloadTransactions();
      
      toast({
        title: 'Demo Data Loaded',
        description: 'Sample accounts and transactions have been added to your workspace.',
      });
    } catch (error) {
       toast({
        variant: 'destructive',
        title: 'Failed to load demo data',
        description: 'An error occurred while loading the demo data. Please try again.',
      });
    }
  }
  
  const handleLoadDemoClick = () => {
    const isWorkspaceEmpty = accounts.length === 0 && transactions.length === 0;
    if (isWorkspaceEmpty) {
      loadDemoData();
    } else {
      setShowConfirmDialog(true);
    }
  };

  const handleReplaceData = async () => {
    if (!workspaceId) return;

    setShowConfirmDialog(false);
    try {
      await apiSeedDemoData(workspaceId, true);
      reloadAccounts();
      reloadTransactions();
      toast({ title: 'Demo Data Loaded', description: 'Sample accounts and transactions have been added.' });
    } catch(error) {
        toast({
            variant: 'destructive',
            title: 'Failed to replace data',
            description: 'Could not replace existing data. Please try again.',
        });
    }
  };

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

  const currencyFormatter = useMemo(() => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  }, []);

  const percentFormatter = useMemo(() => {
    return new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1 });
  }, []);
  
  const transactionsToReview = transactions.filter(t => t.needsReview);

  return (
    <>
      <div className="flex-1 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DashboardDateRangePicker value={dateRange} onChange={setDateRange} />
          <Button onClick={handleLoadDemoClick} variant="outline">
            <Sparkles className="mr-2 h-4 w-4" />
            Load Demo Data
          </Button>
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
              <CardTitle className="text-sm font-medium">Period Averages</CardTitle>
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
            <ExpensesChart data={expenseCategoryData} />
          </div>
        </div>
        <div className="grid gap-4">
          <ReviewTransactions transactions={transactionsToReview} />
        </div>
      </div>
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center">
               <TriangleAlert className="text-destructive mr-2" />
               Replace existing data with demo data?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This workspace already contains accounts and transactions. If you continue, all existing data in this workspace will be deleted and replaced with demo data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReplaceData} className="bg-destructive hover:bg-destructive/90">Replace Data</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}



