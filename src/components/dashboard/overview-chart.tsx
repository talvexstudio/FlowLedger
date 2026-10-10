'use client';

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card';
import {
  getOverviewDescription,
  type DashboardRangeGrouping,
  type MonthlyOverviewPoint,
} from '@/app/(app)/dashboard/utils';

type OverviewChartProps = {
  data: MonthlyOverviewPoint[];
  grouping: DashboardRangeGrouping;
};

export function OverviewChart({ data, grouping }: OverviewChartProps) {

  return (
    <Card>
      <CardHeader>
        <CardTitle>Income vs. Expenses</CardTitle>
        <CardDescription>{getOverviewDescription(grouping)}</CardDescription>
      </CardHeader>
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `€${value/1000}k`}/>
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--background))',
                borderColor: 'hsl(var(--border))',
                borderRadius: 'var(--radius)',
              }}
              cursor={{ fill: 'hsla(var(--muted))' }}
            />
            <Legend iconSize={10} />
            <Bar dataKey="income" fill="hsl(var(--primary) / 0.5)" radius={[4, 4, 0, 0]} name="Income"/>
            <Bar dataKey="expenses" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Expenses" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
