'use client';

import { useMemo } from 'react';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Edit, Trash2 } from 'lucide-react';
import type { BudgetLine, Category, Subcategory, Transaction } from '@/lib/types';
import { buildBudgetPlanningRows } from '@/lib/budget-planning';

interface BudgetLinesProps {
  budgetLines: BudgetLine[];
  transactions: Transaction[];
  categories: (Category & { subcategories: Subcategory[] })[];
  selectedMonth: number;
  selectedYear: number;
  onEdit: (categoryId: string, currentAmount: number) => void;
  onDelete: (categoryId: string) => void;
}

export function BudgetLines({
  budgetLines,
  transactions,
  categories,
  selectedMonth,
  selectedYear,
  onEdit,
  onDelete,
}: BudgetLinesProps) {
  const rows = useMemo(
    () => buildBudgetPlanningRows(budgetLines, transactions, categories, selectedMonth, selectedYear),
    [budgetLines, transactions, categories, selectedMonth, selectedYear]
  );

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No expense-capable categories are available. Create an expense category before setting a budget.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[180px]">Category</TableHead>
          <TableHead>Progress</TableHead>
          <TableHead className="text-right">Used</TableHead>
          <TableHead className="text-right">Budget</TableHead>
          <TableHead className="text-right">Remaining</TableHead>
          <TableHead className="w-[80px]"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(row => (
          <TableRow key={row.categoryId}>
            <TableCell className="font-medium">{row.categoryName}</TableCell>
            <TableCell>
              {row.hasBudget ? (
                <div className="flex items-center gap-3">
                  <Progress
                    value={row.progress}
                    className={`w-[60%] ${row.remaining < 0 ? '[&>div]:bg-destructive' : ''}`}
                  />
                  <span className="text-sm text-muted-foreground">{row.progress.toFixed(0)}%</span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground italic">No budget set</span>
              )}
            </TableCell>
            <TableCell className="text-right">€{row.used.toFixed(2)}</TableCell>
            <TableCell className="text-right">
              {row.hasBudget ? `€${row.monthlyBudget.toFixed(2)}` : <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className={`text-right font-medium ${row.remaining < 0 ? 'text-destructive' : ''}`}>
              {row.hasBudget ? `€${row.remaining.toFixed(2)}` : <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell>
              <div className="flex gap-1 justify-end">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => onEdit(row.categoryId, row.monthlyBudget)}
                  title="Set budget"
                >
                  <Edit className="h-3.5 w-3.5" />
                </Button>
                {row.hasBudget && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => onDelete(row.categoryId)}
                    title="Remove budget"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
