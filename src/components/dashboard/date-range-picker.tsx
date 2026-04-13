'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { format, subDays, subMonths, startOfMonth, endOfMonth, startOfYear, endOfYear, subYears } from 'date-fns';
import type { DateRange } from 'react-day-picker';

export type DateRangePreset = '7d' | '30d' | 'thisMonth' | 'lastMonth' | '3m' | '6m' | '12m' | 'thisYear' | 'custom';

export interface DashboardDateRange {
  start: Date;
  end: Date;
  preset: DateRangePreset;
}

function getPresetRange(preset: DateRangePreset): { start: Date; end: Date } | null {
  const now = new Date();
  switch (preset) {
    case '7d':
      return { start: subDays(now, 6), end: now };
    case '30d':
      return { start: subDays(now, 29), end: now };
    case 'thisMonth':
      return { start: startOfMonth(now), end: now };
    case 'lastMonth': {
      const lastMonth = subMonths(now, 1);
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
    }
    case '3m':
      return { start: subMonths(now, 3), end: now };
    case '6m':
      return { start: subMonths(now, 6), end: now };
    case '12m':
      return { start: subMonths(now, 12), end: now };
    case 'thisYear':
      return { start: startOfYear(now), end: now };
    default:
      return null;
  }
}

const PRESETS: { label: string; value: DateRangePreset }[] = [
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'This month', value: 'thisMonth' },
  { label: 'Last month', value: 'lastMonth' },
  { label: 'Last 3 months', value: '3m' },
  { label: 'Last 6 months', value: '6m' },
  { label: 'Last 12 months', value: '12m' },
  { label: 'This year', value: 'thisYear' },
  { label: 'Custom range', value: 'custom' },
];

interface DateRangePickerProps {
  value: DashboardDateRange;
  onChange: (range: DashboardDateRange) => void;
}

export function DashboardDateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [calendarRange, setCalendarRange] = useState<DateRange | undefined>({
    from: value.start,
    to: value.end,
  });

  const handlePresetClick = (preset: DateRangePreset) => {
    if (preset === 'custom') return; // handled via calendar
    const range = getPresetRange(preset);
    if (range) {
      onChange({ ...range, preset });
      setOpen(false);
    }
  };

  const handleCalendarSelect = (range: DateRange | undefined) => {
    setCalendarRange(range);
    if (range?.from && range?.to) {
      onChange({ start: range.from, end: range.to, preset: 'custom' });
      setOpen(false);
    }
  };

  const label = value.preset === 'custom'
    ? `${format(value.start, 'MMM d, yyyy')} - ${format(value.end, 'MMM d, yyyy')}`
    : PRESETS.find(p => p.value === value.preset)?.label ?? 'Select period';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2">
          <CalendarDays className="h-4 w-4" />
          {label}
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0 flex">
        <div className="flex flex-col gap-1 p-2 border-r min-w-[160px]">
          {PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => handlePresetClick(preset.value)}
              className={`text-left px-3 py-1.5 rounded text-sm transition-colors ${
                value.preset === preset.value
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="p-2">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={calendarRange?.from ?? subMonths(new Date(), 1)}
            selected={calendarRange}
            onSelect={handleCalendarSelect}
            numberOfMonths={2}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function getDefaultDateRange(): DashboardDateRange {
  const range = getPresetRange('30d')!;
  return { ...range, preset: '30d' };
}
