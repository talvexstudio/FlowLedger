import type { DateRangePreset } from '@/components/dashboard/date-range-picker';
import {
  INTERNAL_TRANSFER_CATEGORY_FILTER_ID,
  UNCATEGORIZED_CATEGORY_FILTER_ID,
} from './transaction-filtering';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DASHBOARD_PRESETS: DateRangePreset[] = [
  '7d',
  '30d',
  'thisMonth',
  'lastMonth',
  '3m',
  '6m',
  '12m',
  'thisYear',
  'custom',
];

export type TransactionsViewState = {
  searchQuery: string;
  accountIds: string[];
  categoryIds: string[];
  dateFrom?: string;
  dateTo?: string;
  page: number;
};

export type DashboardViewState = {
  start: string;
  end: string;
  preset: DateRangePreset;
};

export type BudgetViewState = {
  month: number;
  year: number;
};

export type SettingsTab = 'profile' | 'workspace' | 'categories' | 'rules' | 'data-storage';
export type SettingsViewState = { tab: SettingsTab };

export const createDefaultTransactionsViewState = (): TransactionsViewState => ({
  searchQuery: '',
  accountIds: [],
  categoryIds: [],
  page: 1,
});

export const isDateOnlyString = (value: unknown): value is string => {
  if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

export const toDateOnlyString = (date: Date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-');

export const fromDateOnlyString = (value?: string): Date | undefined => {
  if (!isDateOnlyString(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const isTransactionsViewState = (value: unknown): value is TransactionsViewState => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TransactionsViewState>;
  const datesAreValid = (candidate.dateFrom === undefined || isDateOnlyString(candidate.dateFrom))
    && (candidate.dateTo === undefined || isDateOnlyString(candidate.dateTo))
    && !(candidate.dateTo && !candidate.dateFrom)
    && !(candidate.dateFrom && candidate.dateTo && candidate.dateFrom > candidate.dateTo);
  return typeof candidate.searchQuery === 'string'
    && Array.isArray(candidate.accountIds)
    && candidate.accountIds.every((id) => typeof id === 'string')
    && Array.isArray(candidate.categoryIds)
    && candidate.categoryIds.every((id) => typeof id === 'string')
    && datesAreValid
    && Number.isInteger(candidate.page)
    && Number(candidate.page) >= 1;
};

export const reconcileTransactionsViewState = (
  state: TransactionsViewState,
  validAccountIds: ReadonlySet<string>,
  validCategoryIds: ReadonlySet<string>
): TransactionsViewState => ({
  ...state,
  accountIds: state.accountIds.filter((id) => validAccountIds.has(id)),
  categoryIds: state.categoryIds.filter((id) =>
    id === UNCATEGORIZED_CATEGORY_FILTER_ID
    || id === INTERNAL_TRANSFER_CATEGORY_FILTER_ID
    || validCategoryIds.has(id)
  ),
});

export const withTransactionsFilterChange = (
  state: TransactionsViewState,
  change: Partial<Omit<TransactionsViewState, 'page'>>
): TransactionsViewState => ({ ...state, ...change, page: 1 });

export const getActiveTransactionFilterCount = (state: TransactionsViewState) => [
  state.searchQuery.trim().length > 0,
  state.accountIds.length > 0,
  state.categoryIds.length > 0,
  Boolean(state.dateFrom),
].filter(Boolean).length;

export const isDashboardViewState = (value: unknown): value is DashboardViewState => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DashboardViewState>;
  return isDateOnlyString(candidate.start)
    && isDateOnlyString(candidate.end)
    && new Date(candidate.start).getTime() <= new Date(candidate.end).getTime()
    && DASHBOARD_PRESETS.includes(candidate.preset as DateRangePreset);
};

export const isBudgetViewState = (value: unknown): value is BudgetViewState => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BudgetViewState>;
  return Number.isInteger(candidate.month)
    && Number(candidate.month) >= 0
    && Number(candidate.month) <= 11
    && Number.isInteger(candidate.year)
    && Number(candidate.year) >= 1900
    && Number(candidate.year) <= 9999;
};

const SETTINGS_TABS: SettingsTab[] = ['profile', 'workspace', 'categories', 'rules', 'data-storage'];

export const isSettingsViewState = (value: unknown): value is SettingsViewState => {
  if (!value || typeof value !== 'object') return false;
  return SETTINGS_TABS.includes((value as Partial<SettingsViewState>).tab as SettingsTab);
};
