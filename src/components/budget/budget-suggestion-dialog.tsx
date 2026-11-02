'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { apiApplyBudgetSuggestions } from '@/lib/api';
import {
  buildBudgetSuggestionModel,
  buildBudgetSuggestionSelection,
  getDefaultBudgetSuggestionRange,
  type BudgetSuggestionModel,
} from '@/lib/budget-suggestions';
import type { BudgetMonthReference } from '@/lib/data-management/budget-copy';
import type { BudgetLine, Category, Transaction } from '@/lib/types';
import { roundMoneyToNearestCent } from '@/lib/money-rounding';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const monthValue = ({ year, month }: BudgetMonthReference) => `${year}-${String(month).padStart(2, '0')}`;
const monthLabel = ({ year, month }: BudgetMonthReference) => `${MONTH_NAMES[month - 1]} ${year}`;
const parseMonthValue = (value: string): BudgetMonthReference | null => {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return Number.isInteger(year) && month >= 1 && month <= 12 ? { year, month } : null;
};

type BudgetSuggestionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  baseCurrency: string;
  target: BudgetMonthReference;
  transactions: Transaction[];
  categories: Category[];
  budgetLines: BudgetLine[];
  onApplied: () => Promise<void> | void;
};

export function BudgetSuggestionDialog({
  open,
  onOpenChange,
  workspaceId,
  baseCurrency,
  target,
  transactions,
  categories,
  budgetLines,
  onApplied,
}: BudgetSuggestionDialogProps) {
  const { toast } = useToast();
  const defaults = useMemo(() => getDefaultBudgetSuggestionRange(target), [target.year, target.month]);
  const [fromValue, setFromValue] = useState(monthValue(defaults.from));
  const [toValue, setToValue] = useState(monthValue(defaults.to));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [proposedValues, setProposedValues] = useState<Record<string, string>>({});
  const [isApplying, setIsApplying] = useState(false);

  const from = parseMonthValue(fromValue);
  const to = parseMonthValue(toValue);
  const modelResult = useMemo<{ model?: BudgetSuggestionModel; error?: string }>(() => {
    if (!from || !to) return { error: 'Choose a valid From and To month.' };
    try {
      return {
        model: buildBudgetSuggestionModel({
          workspaceId,
          target,
          historyFrom: from,
          historyTo: to,
          transactions,
          categories,
          budgetLines,
        }),
      };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }, [fromValue, toValue, workspaceId, target.year, target.month, transactions, categories, budgetLines]);

  useEffect(() => {
    if (!open) return;
    setFromValue(monthValue(defaults.from));
    setToValue(monthValue(defaults.to));
  }, [open, defaults.from.year, defaults.from.month, defaults.to.year, defaults.to.month]);

  useEffect(() => {
    if (!open || !modelResult.model) return;
    setSelectedIds(new Set(
      modelResult.model.rows.filter((row) => row.selectedByDefault).map((row) => row.categoryId)
    ));
    setProposedValues(Object.fromEntries(
      modelResult.model.rows.map((row) => [
        row.categoryId,
        row.proposedBudget === undefined ? '' : roundMoneyToNearestCent(row.proposedBudget).toFixed(2),
      ])
    ));
  }, [open, modelResult.model]);

  const proposedAmounts = useMemo(() => new Map(
    Object.entries(proposedValues).map(([categoryId, value]) => {
      const amount = value.trim() === '' ? undefined : Number(value);
      return [categoryId, amount] as const;
    })
  ), [proposedValues]);

  const selection = useMemo(() => {
    if (!modelResult.model) return null;
    try {
      return buildBudgetSuggestionSelection(modelResult.model.rows, selectedIds, proposedAmounts);
    } catch {
      return null;
    }
  }, [modelResult.model, selectedIds, proposedAmounts]);

  const formatCurrency = (value: number) => new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: baseCurrency,
  }).format(value);

  const setSelected = (categoryId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(categoryId);
      else next.delete(categoryId);
      return next;
    });
  };

  const handleApply = async () => {
    if (!modelResult.model) return;
    let nextSelection;
    try {
      nextSelection = buildBudgetSuggestionSelection(modelResult.model.rows, selectedIds, proposedAmounts);
      if (nextSelection.entries.length === 0) throw new Error('Select at least one proposed budget to apply.');
    } catch (error) {
      toast({ title: 'Cannot apply suggestions', description: (error as Error).message, variant: 'destructive' });
      return;
    }

    setIsApplying(true);
    try {
      const result = await apiApplyBudgetSuggestions({
        workspaceId,
        targetYear: target.year,
        targetMonth: target.month,
        entries: nextSelection.entries,
      });
      await onApplied();
      toast({
        title: 'Budgets applied',
        description: `${result.appliedCount} budget${result.appliedCount === 1 ? '' : 's'} applied to ${monthLabel(target)}.`,
      });
      onOpenChange(false);
    } catch (error) {
      toast({ title: 'Apply failed', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Suggest budgets from history</DialogTitle>
          <DialogDescription>Target: {monthLabel(target)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="budget-history-from" className="text-sm font-medium">From</label>
              <Input
                id="budget-history-from"
                type="month"
                value={fromValue}
                max={monthValue(defaults.to)}
                onChange={(event) => setFromValue(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="budget-history-to" className="text-sm font-medium">To</label>
              <Input
                id="budget-history-to"
                type="month"
                value={toValue}
                max={monthValue(defaults.to)}
                onChange={(event) => setToValue(event.target.value)}
              />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Based on transactions currently available in FlowLedger for the selected historical period.
          </p>

          {modelResult.error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {modelResult.error}
            </p>
          ) : null}

          {modelResult.model ? (
            <>
              <p className="text-sm text-muted-foreground">
                Historical monthly averages use {modelResult.model.equivalentMonths.toFixed(2)} equivalent calendar months.
              </p>
              <div className="max-h-[45vh] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Select</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Historical Monthly Average</TableHead>
                      <TableHead className="text-right">Current Budget</TableHead>
                      <TableHead className="w-[170px] text-right">Proposed Budget</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modelResult.model.rows.map((row) => (
                      <TableRow key={row.categoryId}>
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(row.categoryId)}
                            onCheckedChange={(checked) => setSelected(row.categoryId, checked === true)}
                            aria-label={`Use suggestion for ${row.categoryName}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{row.categoryName}</TableCell>
                        <TableCell className="text-right">
                          {row.hasHistory && row.historicalMonthlyAverage !== undefined
                            ? formatCurrency(row.historicalMonthlyAverage)
                            : <span className="text-muted-foreground">No history</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.hasTargetBudget && row.currentTargetBudget !== undefined
                            ? formatCurrency(row.currentTargetBudget)
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="text-right"
                            aria-label={`Proposed budget for ${row.categoryName}`}
                            value={proposedValues[row.categoryId] ?? ''}
                            placeholder="—"
                            onChange={(event) => setProposedValues((current) => ({
                              ...current,
                              [row.categoryId]: event.target.value,
                            }))}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-md border p-3 text-sm">
                <p><span className="text-muted-foreground">Target:</span> {monthLabel(target)}</p>
                <p><span className="text-muted-foreground">New budgets:</span> {selection?.newBudgetCount ?? 0}</p>
                <p><span className="text-muted-foreground">Existing budgets to replace:</span> {selection?.replacementCount ?? 0}</p>
                <p className="font-medium">
                  Selected proposed monthly budget total: {formatCurrency(selection?.selectedTotal ?? 0)}
                </p>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isApplying}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={!selection || selection.entries.length === 0 || isApplying}
          >
            {isApplying ? 'Applying…' : 'Apply selected budgets'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
