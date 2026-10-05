'use client';

import { Pie, PieChart, Legend, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useFlowLedger } from '@/hooks/use-flow-ledger';
import { useMemo } from 'react';
import { isWithinInterval } from 'date-fns';
import { toDate } from '@/app/(app)/dashboard/utils';
import { isConfirmedExpense } from '@/lib/transaction-reporting';

const CATEGORY_COLORS = [
  '#4F46E5',
  '#06B6D4',
  '#22C55E',
  '#F97316',
  '#EC4899',
  '#0EA5E9',
  '#A855F7',
];

interface ExpensesChartProps {
  dateRange?: { start: Date; end: Date };
}

export function ExpensesChart({ dateRange }: ExpensesChartProps) {
  const { transactions, categories } = useFlowLedger();

  const { data, total } = useMemo(() => {
    const expenseData = transactions
      .filter(t => isConfirmedExpense(t) && t.categoryId)
      .filter(t => {
        if (!dateRange) return true;
        const date = toDate(t.date);
        return date ? isWithinInterval(date, { start: dateRange.start, end: dateRange.end }) : false;
      })
      .reduce((acc, t) => {
        const categoryId = t.categoryId!;
        acc[categoryId] = (acc[categoryId] || 0) + Math.abs(t.amountBase);
        return acc;
      }, {} as { [key: string]: number });

    const entries = Object.entries(expenseData)
      .map(([categoryId, value]) => {
        const category = categories.find(c => c.id === categoryId);
        return {
          categoryId,
          categoryName: category?.name || 'Uncategorized',
          total: value,
        };
      })
      .filter(entry => entry.total > 0)
      .sort((a, b) => b.total - a.total);

    const totalExpenses = entries.reduce((sum, entry) => sum + entry.total, 0);

    const finalData = entries.map((entry, index) => ({
      ...entry,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    }));

    return { data: finalData, total: totalExpenses };
  }, [transactions, categories]);


  return (
    <Card>
      <CardHeader>
        <CardTitle>Expenses by Category</CardTitle>
        <CardDescription>Breakdown of spending in the selected period.</CardDescription>
      </CardHeader>
      <CardContent className="h-80">
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  borderColor: 'hsl(var(--border))',
                  borderRadius: 'var(--radius)',
                }}
                formatter={(value: number) => `€${value.toFixed(2)}`}
              />
              <Legend
                iconSize={10}
                layout="vertical"
                verticalAlign="middle"
                align="right"
                wrapperStyle={{ right: -20, lineHeight: '24px' }}
              />
              <Pie
                data={data}
                dataKey="total"
                nameKey="categoryName"
                cx="50%"
                cy="50%"
                outerRadius={100}
                labelLine={false}
                label={({ cx, cy, midAngle, innerRadius, outerRadius, percent, index }) => {
                  const RADIAN = Math.PI / 180;
                  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
                  const x = cx + radius * Math.cos(-midAngle * RADIAN);
                  const y = cy + radius * Math.sin(-midAngle * RADIAN);
                  return percent > 0.05 ? (
                    <text x={x} y={y} fill="white" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
                      {`${(percent * 100).toFixed(0)}%`}
                    </text>
                  ) : null;
                }}
              >
                {data.map((entry) => (
                  <Cell key={entry.categoryId} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No expenses recorded in the selected period.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
