'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import type { ExpenseCategoryPoint } from '@/app/(app)/dashboard/utils';
import { Button } from '@/components/ui/button';
import { buildExpenseCategoryVisualization } from '@/lib/expense-category-visualization';

interface ExpensesChartProps {
  data: ExpenseCategoryPoint[];
  onViewReport: () => void;
}

export function ExpensesChart({ data, onViewReport }: ExpensesChartProps) {
  const currencyFormatter = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  const { pieItems, listItems, hasNonPositiveCategories } = buildExpenseCategoryVisualization(data);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Expenses by Category</CardTitle>
          <CardDescription>Breakdown of spending in the selected period.</CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onViewReport}>
          View expense report
        </Button>
      </CardHeader>
      <CardContent className="h-80">
        {listItems.length > 0 ? (
          <div className="grid h-full min-h-0 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-4">
            <div className="min-w-0">
              {pieItems.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--background))',
                        borderColor: 'hsl(var(--border))',
                        borderRadius: 'var(--radius)',
                      }}
                      formatter={(value: number) => currencyFormatter.format(value)}
                    />
                    <Pie
                      data={pieItems}
                      dataKey="netExpense"
                      nameKey="categoryName"
                      cx="50%"
                      cy="50%"
                      outerRadius="78%"
                      labelLine={false}
                      label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
                        const radians = Math.PI / 180;
                        const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
                        const x = cx + radius * Math.cos(-midAngle * radians);
                        const y = cy + radius * Math.sin(-midAngle * radians);
                        return percent > 0.05 ? (
                          <text
                            x={x}
                            y={y}
                            fill="white"
                            textAnchor={x > cx ? 'start' : 'end'}
                            dominantBaseline="central"
                          >
                            {`${(percent * 100).toFixed(0)}%`}
                          </text>
                        ) : null;
                      }}
                    >
                      {pieItems.map((entry) => (
                        <Cell key={entry.categoryId} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                  No positive net expenses in the selected period.
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-col border-l pl-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Net by category
              </p>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {listItems.map((entry) => (
                  <div key={entry.categoryId} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: entry.color }}
                        aria-hidden="true"
                      />
                      <span className="truncate" title={entry.categoryName}>{entry.categoryName}</span>
                    </span>
                    <span className={`shrink-0 font-medium ${entry.netExpense < 0 ? 'text-green-600' : ''}`}>
                      {currencyFormatter.format(entry.netExpense)}
                    </span>
                  </div>
                ))}
              </div>
              {hasNonPositiveCategories ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Pie shows positive net expenses. Signed values at right include reimbursements.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No expenses recorded in the selected period.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
