import { randomUUID } from 'node:crypto';
import type { BackupRecord } from './backup';
import { withDataLock } from './data-lock';
import { getDataManagementPaths, recoverPendingRestoresUnlocked } from './restore-recovery';
import { replaceStoreSetUnlocked, type CompleteStoreSet, type StoreReplacementTestHooks } from './store-replacement';
import { readCompleteStoreSet, validateCompleteStoreSet } from './store-state';
import { selectWorkspaceRecords } from './workspace-scope';
import { roundMoneyToNearestCent } from '../money-rounding';

export type BudgetSuggestionApplyInput = {
  workspaceId: string;
  targetYear: number;
  targetMonth: number;
  entries: Array<{ categoryId: string; amount: number }>;
};

export type BudgetSuggestionApplyResult = {
  workspaceId: string;
  targetYear: number;
  targetMonth: number;
  appliedCount: number;
  createdCount: number;
  replacedCount: number;
  cleanupWarning?: string;
};

export type BudgetSuggestionApplyOptions = {
  dataDirectory?: string;
  operationsDirectory?: string;
  now?: () => Date;
  idFactory?: () => string;
  hooks?: StoreReplacementTestHooks;
};

export class BudgetSuggestionApplyError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'BudgetSuggestionApplyError';
  }
}

type BudgetRecord = BackupRecord & {
  id: string;
  workspaceId: string;
  year: number;
  month?: number;
  recordType?: string;
  budgetId?: string;
  categoryId?: string;
  createdAt?: string;
  updatedAt?: string;
};

const isLine = (record: BackupRecord): record is BudgetRecord & {
  recordType: 'line'; budgetId: string; categoryId: string;
} => record.recordType === 'line';

const uniqueId = (records: BudgetRecord[], idFactory: () => string) => {
  const ids = new Set(records.map((record) => record.id));
  let id = idFactory();
  while (ids.has(id)) id = idFactory();
  return id;
};

const validateInput = (input: BudgetSuggestionApplyInput) => {
  if (!input.workspaceId?.trim()) throw new BudgetSuggestionApplyError('Workspace ID is required.');
  if (!Number.isInteger(input.targetYear)) throw new BudgetSuggestionApplyError('Target year must be an integer.');
  if (!Number.isInteger(input.targetMonth) || input.targetMonth < 1 || input.targetMonth > 12) {
    throw new BudgetSuggestionApplyError('Target month must be an integer from 1 through 12.');
  }
  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    throw new BudgetSuggestionApplyError('Select at least one proposed budget to apply.');
  }
  const categoryIds = new Set<string>();
  for (const entry of input.entries) {
    if (!entry.categoryId?.trim()) throw new BudgetSuggestionApplyError('Every proposed budget requires a category.');
    if (categoryIds.has(entry.categoryId)) {
      throw new BudgetSuggestionApplyError('A category may only be applied once.');
    }
    categoryIds.add(entry.categoryId);
    if (!Number.isFinite(entry.amount) || entry.amount < 0) {
      throw new BudgetSuggestionApplyError('Proposed budget amounts must be non-negative numbers.');
    }
  }
};

const materializeTargetYearLegacyLines = (
  records: BudgetRecord[],
  workspaceId: string,
  year: number,
  idFactory: () => string,
  timestamp: string
) => {
  const legacyLines = records.filter((record) => (
    isLine(record) && record.workspaceId === workspaceId && record.year === year && record.month === undefined
  ));
  if (legacyLines.length === 0) return records;

  const result = records.filter((record) => !legacyLines.includes(record));
  for (const line of legacyLines) {
    for (let month = 1; month <= 12; month += 1) {
      const exactExists = result.some((record) => (
        isLine(record) && record.workspaceId === workspaceId && record.year === year &&
        record.month === month && record.categoryId === line.categoryId
      ));
      if (exactExists) continue;
      result.push({
        ...structuredClone(line),
        id: uniqueId(result, idFactory),
        month,
        createdAt: line.createdAt ?? timestamp,
        updatedAt: timestamp,
      });
    }
  }
  return result;
};

export function buildBudgetSuggestionApplyState(
  current: CompleteStoreSet,
  input: BudgetSuggestionApplyInput,
  options: Pick<BudgetSuggestionApplyOptions, 'now' | 'idFactory'> = {}
): { resulting: CompleteStoreSet; result: Omit<BudgetSuggestionApplyResult, 'cleanupWarning'> } {
  validateInput(input);
  if (!current.workspaces.some((workspace) => workspace.id === input.workspaceId)) {
    throw new BudgetSuggestionApplyError('Workspace not found.', 404);
  }

  const availableCategories = new Set(
    selectWorkspaceRecords('categories', current.categories, input.workspaceId)
      .filter((category) => category.type === 'expense' || category.type === 'both')
      .map((category) => String(category.id))
  );
  for (const entry of input.entries) {
    if (!availableCategories.has(entry.categoryId)) {
      throw new BudgetSuggestionApplyError('A selected category is unavailable or cannot receive an expense budget.', 409);
    }
  }

  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const idFactory = options.idFactory ?? (() => `bud_${randomUUID()}`);
  let records = materializeTargetYearLegacyLines(
    structuredClone(current.budgets) as BudgetRecord[],
    input.workspaceId,
    input.targetYear,
    idFactory,
    timestamp
  );
  let header = records.find((record) => (
    !isLine(record) && record.workspaceId === input.workspaceId && record.year === input.targetYear
  ));
  if (!header) {
    header = {
      id: uniqueId(records, idFactory),
      workspaceId: input.workspaceId,
      year: input.targetYear,
      createdFromSampleMonths: 0,
      samplePeriodFrom: `${input.targetYear}-01`,
      samplePeriodTo: `${input.targetYear}-12`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    records.push(header);
  }

  let createdCount = 0;
  let replacedCount = 0;
  for (const entry of input.entries) {
    const existingIndex = records.findIndex((record) => (
      isLine(record) && record.workspaceId === input.workspaceId && record.year === input.targetYear &&
      record.month === input.targetMonth && record.categoryId === entry.categoryId
    ));
    const existing = existingIndex >= 0 ? records[existingIndex] : undefined;
    const amount = roundMoneyToNearestCent(entry.amount);
    const line: BudgetRecord = {
      id: existing?.id ?? uniqueId(records, idFactory),
      workspaceId: input.workspaceId,
      recordType: 'line',
      budgetId: header.id,
      year: input.targetYear,
      month: input.targetMonth,
      type: 'Expense',
      categoryId: entry.categoryId,
      subcategoryId: '',
      totalSample: 0,
      monthlyAverage: amount,
      annualBudget: amount * 12,
      percentageOfType: 0,
      userAdjustedMonthly: amount,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    if (existingIndex >= 0) {
      records[existingIndex] = line;
      replacedCount += 1;
    } else {
      records.push(line);
      createdCount += 1;
    }
  }

  const resulting = structuredClone(current) as CompleteStoreSet;
  resulting.budgets = records;
  return {
    resulting,
    result: {
      workspaceId: input.workspaceId,
      targetYear: input.targetYear,
      targetMonth: input.targetMonth,
      appliedCount: input.entries.length,
      createdCount,
      replacedCount,
    },
  };
}

export const applyBudgetSuggestions = async (
  input: BudgetSuggestionApplyInput,
  options: BudgetSuggestionApplyOptions = {}
): Promise<BudgetSuggestionApplyResult> => withDataLock(() => {
  recoverPendingRestoresUnlocked(options);
  const current = readCompleteStoreSet(options.dataDirectory);
  const { resulting, result } = buildBudgetSuggestionApplyState(current, input, options);
  validateCompleteStoreSet(resulting);
  const replacement = replaceStoreSetUnlocked(resulting, getDataManagementPaths(options), {
    operationKind: 'budget-suggestion-apply',
    targetStores: ['budgets'],
    now: options.now,
    hooks: options.hooks,
    executionFailureCode: 'DATA_OPERATION_FAILURE',
    preparationFailureMessage: 'Suggested budgets could not be prepared. Current budgets were not changed.',
    rollbackSuccessMessage: 'Applying suggested budgets failed. Original budgets were restored successfully.',
    cleanupWarningMessage: 'Suggested budgets were applied, but temporary recovery files could not be fully removed.',
  });
  return { ...result, cleanupWarning: replacement.cleanupWarning };
});
