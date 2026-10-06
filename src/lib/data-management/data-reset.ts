import { canonicalizeStoreRecords, type BackupRecord } from './backup';
import { withDataLock } from './data-lock';
import {
  cloneDefaultSystemCategories,
  cloneDefaultWorkspaces,
} from './default-data';
import { RestoreError } from './restore-errors';
import {
  getDataManagementPaths,
  recoverPendingRestoresUnlocked,
  type DataManagementOperationKind,
} from './restore-recovery';
import {
  replaceStoreSetUnlocked,
  type CompleteStoreSet,
  type StoreReplacementTestHooks,
} from './store-replacement';
import {
  DATA_SCOPE_DEFINITIONS,
  PERSISTED_STORE_KEYS,
  type BackupScope,
  type PersistedStoreKey,
} from './store-manifest';
import { readCompleteStoreSet, validateCompleteStoreSet } from './store-state';

export const DATA_RESET_OPERATIONS = [
  'clear_activity',
  'reset_financial',
  'factory_reset',
] as const;

export type DataResetOperation = (typeof DATA_RESET_OPERATIONS)[number];

export type DataResetPreview = {
  operation: DataResetOperation;
  backupScope: BackupScope;
  currentCounts: Record<PersistedStoreKey, number>;
  resultingCounts: Record<PersistedStoreKey, number>;
  removedCounts: Record<PersistedStoreKey, number>;
  customCategoryCount: number;
  customSubcategoryCount: number;
  replacedStores: PersistedStoreKey[];
  preservedStores: PersistedStoreKey[];
};

export type DataResetResult = {
  completed: true;
  operation: DataResetOperation;
  replacedStores: PersistedStoreKey[];
  resultingCounts: Record<PersistedStoreKey, number>;
  cleanupWarning?: string;
};

export type DataResetOptions = {
  dataDirectory?: string;
  operationsDirectory?: string;
  now?: () => Date;
  hooks?: StoreReplacementTestHooks;
};

type ResetDefinition = {
  operationKind: DataManagementOperationKind;
  backupScope: BackupScope;
};

const RESET_DEFINITIONS: Record<DataResetOperation, ResetDefinition> = {
  clear_activity: {
    operationKind: 'clear-activity',
    backupScope: 'activity',
  },
  reset_financial: {
    operationKind: 'reset-financial',
    backupScope: 'financial_data',
  },
  factory_reset: {
    operationKind: 'factory-reset',
    backupScope: 'everything',
  },
};

export const isDataResetOperation = (value: unknown): value is DataResetOperation =>
  typeof value === 'string' && DATA_RESET_OPERATIONS.includes(value as DataResetOperation);

const cloneStoreSet = (data: CompleteStoreSet): CompleteStoreSet =>
  structuredClone(data) as CompleteStoreSet;

const readCurrentStoreSet = (dataDirectory?: string): CompleteStoreSet => {
  try {
    return readCompleteStoreSet(dataDirectory);
  } catch (error) {
    throw new RestoreError(
      'DATA_OPERATION_FAILURE',
      'Cannot manage data because a canonical store is unreadable, invalid, or inconsistent.',
      { cause: error }
    );
  }
};

const canonicalDefaults = () => ({
  workspaces: cloneDefaultWorkspaces() as BackupRecord[],
  categories: cloneDefaultSystemCategories() as BackupRecord[],
});

const equalRecords = (left: BackupRecord[], right: BackupRecord[]) =>
  JSON.stringify(canonicalizeStoreRecords(left)) === JSON.stringify(canonicalizeStoreRecords(right));

const validateCompleteState = (
  operation: DataResetOperation,
  data: CompleteStoreSet
) => {
  validateCompleteStoreSet(data);

  const defaults = canonicalDefaults();
  if ((operation === 'reset_financial' || operation === 'factory_reset') &&
      !equalRecords(data.categories, defaults.categories)) {
    throw new RestoreError('DATA_OPERATION_FAILURE', 'The resulting category taxonomy does not match canonical defaults.');
  }
  if (operation === 'factory_reset' && !equalRecords(data.workspaces, defaults.workspaces)) {
    throw new RestoreError('DATA_OPERATION_FAILURE', 'The factory-reset workspace does not match the canonical default.');
  }
};

const buildResultingState = (
  operation: DataResetOperation,
  current: CompleteStoreSet
): CompleteStoreSet => {
  const result = cloneStoreSet(current);
  const defaults = canonicalDefaults();

  if (operation === 'clear_activity') {
    result.imports = [];
    result.transactions = [];
  } else if (operation === 'reset_financial') {
    result.accounts = [];
    result.categories = defaults.categories;
    result.imports = [];
    result.importTemplates = [];
    result.budgets = [];
    result.rules = [];
    result.transactions = [];
  } else {
    result.workspaces = defaults.workspaces;
    result.accounts = [];
    result.categories = defaults.categories;
    result.imports = [];
    result.importTemplates = [];
    result.budgets = [];
    result.rules = [];
    result.transactions = [];
  }

  validateCompleteState(operation, result);
  return result;
};

const storeCounts = (data: CompleteStoreSet) => Object.fromEntries(
  PERSISTED_STORE_KEYS.map((key) => [key, data[key].length])
) as Record<PersistedStoreKey, number>;

const buildPreview = (
  operation: DataResetOperation,
  current: CompleteStoreSet,
  resulting: CompleteStoreSet
): DataResetPreview => {
  const definition = RESET_DEFINITIONS[operation];
  const targetStores = DATA_SCOPE_DEFINITIONS[definition.backupScope].includedStores;
  const currentCounts = storeCounts(current);
  const resultingCounts = storeCounts(resulting);
  const removedCounts = Object.fromEntries(PERSISTED_STORE_KEYS.map((key) => [
    key,
    Math.max(0, currentCounts[key] - resultingCounts[key]),
  ])) as Record<PersistedStoreKey, number>;
  const customCategoryCount = current.categories.filter((category) => category.isSystem !== true).length;
  const customSubcategoryCount = current.categories.reduce((count, category) =>
    count + (Array.isArray(category.subcategories)
      ? category.subcategories.filter((subcategory) =>
          typeof subcategory === 'object' && subcategory !== null && !Array.isArray(subcategory) &&
          subcategory.isSystem !== true
        ).length
      : 0), 0);

  return {
    operation,
    backupScope: definition.backupScope,
    currentCounts,
    resultingCounts,
    removedCounts,
    customCategoryCount,
    customSubcategoryCount,
    replacedStores: [...targetStores],
    preservedStores: PERSISTED_STORE_KEYS.filter((key) => !targetStores.includes(key)),
  };
};

const validateOperation = (operation: unknown): DataResetOperation => {
  if (!isDataResetOperation(operation)) {
    throw new RestoreError('INVALID_OPERATION', 'The requested data-management operation is not supported.');
  }
  return operation;
};

export const previewDataReset = async (
  operationValue: unknown,
  options: Pick<DataResetOptions, 'dataDirectory' | 'operationsDirectory'> = {}
): Promise<DataResetPreview> => withDataLock(() => {
  const operation = validateOperation(operationValue);
  recoverPendingRestoresUnlocked(options);
  const current = readCurrentStoreSet(options.dataDirectory);
  const resulting = buildResultingState(operation, current);
  return buildPreview(operation, current, resulting);
});

export const executeDataReset = async (
  operationValue: unknown,
  confirmed: boolean,
  options: DataResetOptions = {}
): Promise<DataResetResult> => withDataLock(() => {
  const operation = validateOperation(operationValue);
  if (confirmed !== true) {
    throw new RestoreError('INVALID_OPERATION', 'Explicit confirmation is required for this destructive operation.');
  }

  recoverPendingRestoresUnlocked(options);
  const current = readCurrentStoreSet(options.dataDirectory);
  const resulting = buildResultingState(operation, current);
  const definition = RESET_DEFINITIONS[operation];
  const targetStores = DATA_SCOPE_DEFINITIONS[definition.backupScope].includedStores;
  const replacement = replaceStoreSetUnlocked(resulting, getDataManagementPaths(options), {
    operationKind: definition.operationKind,
    targetStores,
    now: options.now,
    hooks: options.hooks,
    executionFailureCode: 'DATA_OPERATION_FAILURE',
    preparationFailureMessage: 'The data operation could not be prepared. Current data was not changed.',
    rollbackSuccessMessage: 'The data operation failed. Original data was restored successfully.',
    cleanupWarningMessage: 'The data operation succeeded, but temporary recovery files could not be fully removed.',
  });

  return {
    completed: true,
    operation,
    replacedStores: replacement.replacedStores,
    resultingCounts: storeCounts(resulting),
    cleanupWarning: replacement.cleanupWarning,
  };
});
