import { randomUUID } from 'node:crypto';
import { withDataLock } from './data-lock';
import { getDataManagementPaths, recoverPendingRestoresUnlocked } from './restore-recovery';
import { replaceStoreSetUnlocked, type CompleteStoreSet, type StoreReplacementTestHooks } from './store-replacement';
import { readCompleteStoreSet, validateCompleteStoreSet } from './store-state';
import { selectWorkspaceRecords } from './workspace-scope';
import type { BackupRecord } from './backup';

export const BUDGET_COPY_MODES = ['fill_empty', 'replace'] as const;
export type BudgetCopyMode = (typeof BUDGET_COPY_MODES)[number];

export type BudgetMonthReference = { year: number; month: number };

export type BudgetCopyInput = {
  workspaceId: string;
  sourceYear: number;
  sourceMonth: number;
  targetYear: number;
  targetMonth: number;
  mode: BudgetCopyMode;
};

export type BudgetCopyPreview = BudgetCopyInput & {
  sourceBudgetCount: number;
  budgetsToCopy: number;
  existingTargetBudgetsPreserved: number;
  targetBudgetsRemoved: number;
  skippedSourceBudgets: number;
};

export type BudgetCopyResult = BudgetCopyPreview & {
  cleanupWarning?: string;
};

export type BudgetCopyOptions = {
  dataDirectory?: string;
  operationsDirectory?: string;
  now?: () => Date;
  idFactory?: () => string;
  hooks?: StoreReplacementTestHooks;
};

export class BudgetCopyError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'BudgetCopyError';
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
  subcategoryId?: string;
  type?: string;
  createdAt?: string;
  updatedAt?: string;
};

type BudgetLineRecord = BudgetRecord & {
  recordType: 'line';
  budgetId: string;
  categoryId: string;
};

const isLine = (record: BackupRecord): record is BudgetLineRecord => record.recordType === 'line';
const lineCategoryKey = (record: BudgetRecord) => record.categoryId ?? '';

const assertMonth = (value: number, label: string) => {
  if (!Number.isInteger(value) || value < 1 || value > 12) {
    throw new BudgetCopyError(`${label} must be an integer from 1 through 12.`);
  }
};

const validateInput = (input: BudgetCopyInput) => {
  if (!input.workspaceId?.trim()) throw new BudgetCopyError('Workspace ID is required.');
  if (!Number.isInteger(input.sourceYear) || !Number.isInteger(input.targetYear)) {
    throw new BudgetCopyError('Source and target years must be integers.');
  }
  assertMonth(input.sourceMonth, 'Source month');
  assertMonth(input.targetMonth, 'Target month');
  if (!BUDGET_COPY_MODES.includes(input.mode)) throw new BudgetCopyError('Unknown budget copy mode.');
  if (input.sourceYear === input.targetYear && input.sourceMonth === input.targetMonth) {
    throw new BudgetCopyError('Source and target months must be different.');
  }
};

const effectiveLinesForMonth = (
  records: BudgetRecord[],
  workspaceId: string,
  year: number,
  month: number
) => {
  const applicable = records.filter((record) => (
    isLine(record) &&
    record.workspaceId === workspaceId &&
    record.year === year &&
    (record.month === month || record.month === undefined)
  ));
  const byCategory = new Map<string, BudgetRecord>();
  for (const line of applicable.filter((record) => record.month === undefined)) {
    byCategory.set(lineCategoryKey(line), line);
  }
  for (const line of applicable.filter((record) => record.month === month)) {
    byCategory.set(lineCategoryKey(line), line);
  }
  return [...byCategory.values()];
};

const uniqueId = (records: BudgetRecord[], idFactory: () => string) => {
  const ids = new Set(records.map((record) => record.id));
  let id = idFactory();
  while (ids.has(id)) id = idFactory();
  return id;
};

const materializeLegacyLines = (
  records: BudgetRecord[],
  workspaceId: string,
  year: number,
  idFactory: () => string,
  timestamp: string
) => {
  const legacy = records.filter((record) => (
    isLine(record) && record.workspaceId === workspaceId && record.year === year && record.month === undefined
  ));
  if (legacy.length === 0) return records;

  const result = records.filter((record) => !legacy.includes(record));
  for (const line of legacy) {
    for (let month = 1; month <= 12; month += 1) {
      const alreadyExists = result.some((record) => (
        isLine(record) &&
        record.workspaceId === workspaceId &&
        record.year === year &&
        record.month === month &&
        lineCategoryKey(record) === lineCategoryKey(line)
      ));
      if (alreadyExists) continue;
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

const targetHeader = (
  records: BudgetRecord[],
  workspaceId: string,
  year: number
) => records.find((record) => !isLine(record) && record.workspaceId === workspaceId && record.year === year);

const ensureTargetHeader = (
  records: BudgetRecord[],
  workspaceId: string,
  year: number,
  idFactory: () => string,
  timestamp: string
) => {
  const existing = targetHeader(records, workspaceId, year);
  if (existing) return { records, header: existing };
  const header: BudgetRecord = {
    id: uniqueId(records, idFactory),
    workspaceId,
    year,
    createdFromSampleMonths: 0,
    samplePeriodFrom: `${year}-01`,
    samplePeriodTo: `${year}-12`,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return { records: [...records, header], header };
};

export function buildBudgetCopyState(
  current: CompleteStoreSet,
  input: BudgetCopyInput,
  options: Pick<BudgetCopyOptions, 'now' | 'idFactory'> = {}
): { resulting: CompleteStoreSet; preview: BudgetCopyPreview } {
  validateInput(input);
  if (!current.workspaces.some((workspace) => workspace.id === input.workspaceId)) {
    throw new BudgetCopyError('Workspace not found.', 404);
  }

  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const idFactory = options.idFactory ?? (() => `bud_${randomUUID()}`);
  let budgetRecords = structuredClone(current.budgets) as BudgetRecord[];
  budgetRecords = materializeLegacyLines(
    budgetRecords,
    input.workspaceId,
    input.targetYear,
    idFactory,
    timestamp
  );

  const budgetableCategoryIds = new Set(
    selectWorkspaceRecords('categories', current.categories, input.workspaceId)
      .filter((category) => category.type === 'expense' || category.type === 'both')
      .map((category) => String(category.id))
  );
  const sourceLines = effectiveLinesForMonth(
    budgetRecords,
    input.workspaceId,
    input.sourceYear,
    input.sourceMonth
  );
  if (sourceLines.length === 0) throw new BudgetCopyError('The selected source month has no budgets.', 409);

  const eligibleSourceLines = sourceLines.filter((line) => (
    Boolean(line.categoryId) && budgetableCategoryIds.has(line.categoryId!)
  ));
  const skippedSourceBudgets = sourceLines.length - eligibleSourceLines.length;
  const targetLines = effectiveLinesForMonth(
    budgetRecords,
    input.workspaceId,
    input.targetYear,
    input.targetMonth
  ).filter((line) => line.month === input.targetMonth);
  const targetByCategory = new Map(targetLines.map((line) => [lineCategoryKey(line), line]));
  const sourceByCategory = new Map(eligibleSourceLines.map((line) => [lineCategoryKey(line), line]));

  const linesToCopy = input.mode === 'fill_empty'
    ? eligibleSourceLines.filter((line) => !targetByCategory.has(lineCategoryKey(line)))
    : eligibleSourceLines;
  const existingTargetBudgetsPreserved = input.mode === 'fill_empty' ? targetLines.length : 0;
  const targetBudgetsRemoved = input.mode === 'replace'
    ? targetLines.filter((line) => !sourceByCategory.has(lineCategoryKey(line))).length
    : 0;

  if (input.mode === 'replace') {
    budgetRecords = budgetRecords.filter((record) => !(
      isLine(record) &&
      record.workspaceId === input.workspaceId &&
      record.year === input.targetYear &&
      record.month === input.targetMonth
    ));
  }

  let header = targetHeader(budgetRecords, input.workspaceId, input.targetYear);
  if (linesToCopy.length > 0 && !header) {
    const ensured = ensureTargetHeader(
      budgetRecords,
      input.workspaceId,
      input.targetYear,
      idFactory,
      timestamp
    );
    budgetRecords = ensured.records;
    header = ensured.header;
  }

  for (const source of linesToCopy) {
    const existing = targetByCategory.get(lineCategoryKey(source));
    const copied = structuredClone(source) as BudgetRecord;
    copied.id = input.mode === 'replace' && existing
      ? existing.id
      : uniqueId(budgetRecords, idFactory);
    copied.workspaceId = input.workspaceId;
    copied.year = input.targetYear;
    copied.month = input.targetMonth;
    copied.budgetId = header!.id;
    copied.createdAt = input.mode === 'replace' && existing
      ? existing.createdAt ?? timestamp
      : timestamp;
    copied.updatedAt = timestamp;
    budgetRecords.push(copied);
  }

  const resulting = structuredClone(current) as CompleteStoreSet;
  resulting.budgets = budgetRecords;
  return {
    resulting,
    preview: {
      ...input,
      sourceBudgetCount: sourceLines.length,
      budgetsToCopy: linesToCopy.length,
      existingTargetBudgetsPreserved,
      targetBudgetsRemoved,
      skippedSourceBudgets,
    },
  };
}

const readCurrent = (options: BudgetCopyOptions) => {
  recoverPendingRestoresUnlocked(options);
  return readCompleteStoreSet(options.dataDirectory);
};

export const listBudgetCopySources = async (
  workspaceId: string,
  options: BudgetCopyOptions = {}
): Promise<BudgetMonthReference[]> => withDataLock(() => {
  if (!workspaceId?.trim()) throw new BudgetCopyError('Workspace ID is required.');
  const current = readCurrent(options);
  if (!current.workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new BudgetCopyError('Workspace not found.', 404);
  }
  const records = current.budgets as BudgetRecord[];
  const periods = new Map<string, BudgetMonthReference>();
  for (const line of records.filter((record) => isLine(record) && record.workspaceId === workspaceId)) {
    const months = line.month === undefined
      ? Array.from({ length: 12 }, (_, index) => index + 1)
      : [line.month];
    for (const month of months) periods.set(`${line.year}-${month}`, { year: line.year, month });
  }
  return [...periods.values()].sort((left, right) => right.year - left.year || right.month - left.month);
});

export const previewBudgetCopy = async (
  input: BudgetCopyInput,
  options: BudgetCopyOptions = {}
): Promise<BudgetCopyPreview> => withDataLock(() => {
  const current = readCurrent(options);
  const { resulting, preview } = buildBudgetCopyState(current, input, options);
  validateCompleteStoreSet(resulting);
  return preview;
});

export const copyBudgets = async (
  input: BudgetCopyInput,
  options: BudgetCopyOptions = {}
): Promise<BudgetCopyResult> => withDataLock(() => {
  const current = readCurrent(options);
  const { resulting, preview } = buildBudgetCopyState(current, input, options);
  validateCompleteStoreSet(resulting);
  const replacement = replaceStoreSetUnlocked(resulting, getDataManagementPaths(options), {
    operationKind: 'budget-copy',
    targetStores: ['budgets'],
    now: options.now,
    hooks: options.hooks,
    executionFailureCode: 'DATA_OPERATION_FAILURE',
    preparationFailureMessage: 'Budget copy could not be prepared. Current budgets were not changed.',
    rollbackSuccessMessage: 'Budget copy failed. Original budgets were restored successfully.',
    cleanupWarningMessage: 'Budgets were copied, but temporary recovery files could not be fully removed.',
  });
  return { ...preview, cleanupWarning: replacement.cleanupWarning };
});
