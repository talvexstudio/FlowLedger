'use client';

import { Pie, PieChart, Legend, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import type { ExpenseCategoryPoint } from '@/app/(app)/dashboard/utils';

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
  data: ExpenseCategoryPoint[];
}

export function ExpensesChart({ data }: ExpensesChartProps) {
  const chartData = data.map((entry, index) => ({
    ...entry,
    color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
  }));


  return (
    <Card>
      <CardHeader>
        <CardTitle>Expenses by Category</CardTitle>
        <CardDescription>Breakdown of spending in the selected period.</CardDescription>
      </CardHeader>
      <CardContent className="h-80">
        {chartData.length > 0 ? (
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
                data={chartData}
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
                {chartData.map((entry) => (
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
