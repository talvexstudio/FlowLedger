'use client';

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BudgetLines } from '@/components/budget/budget-lines';
import { useFlowLedger } from '@/hooks/use-flow-ledger';
import { useToast } from '@/hooks/use-toast';
import { apiSaveBudgetLine, apiDeleteBudgetLine } from '@/lib/api';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function BudgetPage() {
  const { categories, transactions, budgetLines, budgetYear, workspaceId, reloadBudget } = useFlowLedger();
  const { toast } = useToast();

  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const [editModal, setEditModal] = useState<{ open: boolean; categoryId: string; categoryName: string; currentAmount: number } | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const yearOptions = Array.from(new Set([
    selectedYear - 1,
    selectedYear,
    selectedYear + 1,
    new Date().getFullYear(),
  ])).sort();

  useEffect(() => {
    reloadBudget(selectedYear);
  }, [selectedYear]);

  const handlePrevMonth = () => {
    setSelectedMonth(m => {
      if (m === 0) { setSelectedYear(y => y - 1); return 11; }
      return m - 1;
    });
  };

  const handleNextMonth = () => {
    setSelectedMonth(m => {
      if (m === 11) { setSelectedYear(y => y + 1); return 0; }
      return m + 1;
    });
  };

  const handleYearChange = useCallback((year: string) => {
    setSelectedYear(Number(year));
    // useEffect above handles reloadBudget when selectedYear changes
  }, []);

  const handleOpenEdit = (categoryId: string, currentAmount: number) => {
    const category = categories.find(c => c.id === categoryId);
    setEditModal({
      open: true,
      categoryId,
      categoryName: category?.name ?? categoryId,
      currentAmount,
    });
    setAmountInput(currentAmount > 0 ? currentAmount.toFixed(2) : '');
  };

  const handleSaveBudgetLine = async () => {
    if (!editModal || !workspaceId) return;
    const amount = parseFloat(amountInput);
    if (isNaN(amount) || amount < 0) {
      toast({ title: 'Invalid amount', description: 'Please enter a valid positive number.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      await apiSaveBudgetLine(workspaceId, selectedYear, {
        categoryId: editModal.categoryId,
        budgetId: String(selectedYear),
        type: 'Expense',
        subcategoryId: '',
        userAdjustedMonthly: amount,
        monthlyAverage: amount,
        annualBudget: amount * 12,
        totalSample: 0,
        percentageOfType: 0,
      });
      await reloadBudget(selectedYear);
      toast({ title: 'Budget saved', description: `Monthly budget for ${editModal.categoryName} set to €${amount.toFixed(2)}.` });
      setEditModal(null);
    } catch (e) {
      toast({ title: 'Save failed', description: 'Could not save budget line.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteBudgetLine = async (categoryId: string) => {
    if (!workspaceId) return;
    try {
      await apiDeleteBudgetLine(workspaceId, selectedYear, categoryId);
      await reloadBudget(selectedYear);
      toast({ title: 'Budget removed', description: 'Budget line has been removed.' });
    } catch (e) {
      toast({ title: 'Delete failed', description: 'Could not remove budget line.', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Budget</h1>
          <p className="text-muted-foreground">Monitor and adjust your monthly spending goals.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(selectedYear)} onValueChange={handleYearChange}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Monthly Budget</CardTitle>
              <CardDescription>
                Spending vs budget for {MONTH_NAMES[selectedMonth]} {selectedYear}.
              </CardDescription>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={handlePrevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium w-28 text-center">
                {MONTH_NAMES[selectedMonth]}
              </span>
              <Button variant="outline" size="icon" onClick={handleNextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <BudgetLines
            budgetLines={budgetLines}
            transactions={transactions}
            categories={categories}
            selectedMonth={selectedMonth}
            selectedYear={selectedYear}
            onEdit={handleOpenEdit}
            onDelete={handleDeleteBudgetLine}
          />
        </CardContent>
      </Card>

      {editModal?.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
            <h2 className="text-lg font-semibold mb-1">Set Monthly Budget</h2>
            <p className="text-sm text-gray-600 mb-6">
              Monthly spending limit for <strong>{editModal.categoryName}</strong>.
            </p>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1">Amount (€)</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 300.00"
                  value={amountInput}
                  onChange={e => setAmountInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveBudgetLine()}
                  autoFocus
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-8 pt-4 border-t">
              <Button variant="outline" onClick={() => setEditModal(null)} disabled={isSaving}>
                Cancel
              </Button>
              <Button onClick={handleSaveBudgetLine} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
