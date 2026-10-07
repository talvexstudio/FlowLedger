import { canonicalizeStoreRecords, type BackupRecord } from './backup';
import { withDataLock } from './data-lock';
import {
  cloneDefaultBootstrapCategories,
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
import {
  instantiateDefaultCategoryTemplate,
  type CategoryTemplateIdFactory,
} from '../default-category-template';
import { replaceWorkspaceRecords, selectWorkspaceRecords } from './workspace-scope';

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
  workspaceId?: string;
  workspaceName?: string;
  workspaceMode: 'selected' | 'all';
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
  workspaceId?: string | null;
  categoryIdFactory?: CategoryTemplateIdFactory;
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
  categories: cloneDefaultBootstrapCategories() as BackupRecord[],
});

const equalRecords = (left: BackupRecord[], right: BackupRecord[]) =>
  JSON.stringify(canonicalizeStoreRecords(left)) === JSON.stringify(canonicalizeStoreRecords(right));

const validateCompleteState = (
  operation: DataResetOperation,
  data: CompleteStoreSet,
  workspaceId?: string
) => {
  validateCompleteStoreSet(data);

  const defaults = canonicalDefaults();
  if (operation === 'reset_financial') {
    const categories = selectWorkspaceRecords('categories', data.categories, workspaceId!);
    const expected = instantiateDefaultCategoryTemplate(workspaceId!, {
      categoryId: (key) => `shape-category-${key}`,
      subcategoryId: (key, categoryKey) => `shape-subcategory-${categoryKey}-${key}`,
    }) as BackupRecord[];
    const shape = (records: BackupRecord[]) => records.map((category) => ({
      name: category.name,
      type: category.type,
      order: category.order,
      subcategories: (category.subcategories as BackupRecord[]).map((subcategory) => ({
        name: subcategory.name,
        order: subcategory.order,
        flowType: subcategory.flowType,
      })),
    }));
    if (JSON.stringify(shape(categories)) !== JSON.stringify(shape(expected))) {
      throw new RestoreError('DATA_OPERATION_FAILURE', 'The resulting workspace taxonomy does not match the starter template.');
    }
  }
  if (operation === 'factory_reset') {
    if (!equalRecords(data.categories, defaults.categories)) {
      throw new RestoreError('DATA_OPERATION_FAILURE', 'The resulting category taxonomy does not match canonical defaults.');
    }
    if (!equalRecords(data.workspaces, defaults.workspaces)) {
      throw new RestoreError('DATA_OPERATION_FAILURE', 'The factory-reset workspace does not match the canonical default.');
    }
  }
};

const buildResultingState = (
  operation: DataResetOperation,
  current: CompleteStoreSet,
  workspaceId: string | undefined,
  categoryIdFactory?: CategoryTemplateIdFactory
): CompleteStoreSet => {
  const result = cloneStoreSet(current);
  const defaults = canonicalDefaults();

  if (operation === 'clear_activity') {
    result.imports = replaceWorkspaceRecords('imports', result.imports, [], workspaceId!);
    result.transactions = replaceWorkspaceRecords('transactions', result.transactions, [], workspaceId!);
  } else if (operation === 'reset_financial') {
    result.accounts = replaceWorkspaceRecords('accounts', result.accounts, [], workspaceId!);
    result.categories = replaceWorkspaceRecords(
      'categories',
      result.categories,
      instantiateDefaultCategoryTemplate(workspaceId!, categoryIdFactory) as BackupRecord[],
      workspaceId!
    );
    result.imports = replaceWorkspaceRecords('imports', result.imports, [], workspaceId!);
    result.importTemplates = replaceWorkspaceRecords('importTemplates', result.importTemplates, [], workspaceId!);
    result.budgets = replaceWorkspaceRecords('budgets', result.budgets, [], workspaceId!);
    result.rules = replaceWorkspaceRecords('rules', result.rules, [], workspaceId!);
    result.transactions = replaceWorkspaceRecords('transactions', result.transactions, [], workspaceId!);
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

  validateCompleteState(operation, result, workspaceId);
  return result;
};

const storeCounts = (data: CompleteStoreSet) => Object.fromEntries(
  PERSISTED_STORE_KEYS.map((key) => [key, data[key].length])
) as Record<PersistedStoreKey, number>;

const workspaceStoreCounts = (data: CompleteStoreSet, workspaceId: string) => Object.fromEntries(
  PERSISTED_STORE_KEYS.map((key) => [
    key,
    key === 'workspaces'
      ? data.workspaces.filter((workspace) => workspace.id === workspaceId).length
      : selectWorkspaceRecords(key, data[key], workspaceId).length,
  ])
) as Record<PersistedStoreKey, number>;

const buildPreview = (
  operation: DataResetOperation,
  current: CompleteStoreSet,
  resulting: CompleteStoreSet,
  workspaceId?: string
): DataResetPreview => {
  const definition = RESET_DEFINITIONS[operation];
  const targetStores = DATA_SCOPE_DEFINITIONS[definition.backupScope].includedStores;
  const workspaceMode = operation === 'factory_reset' ? 'all' : 'selected';
  const currentCounts = workspaceMode === 'all'
    ? storeCounts(current)
    : workspaceStoreCounts(current, workspaceId!);
  const resultingCounts = workspaceMode === 'all'
    ? storeCounts(resulting)
    : workspaceStoreCounts(resulting, workspaceId!);
  const removedCounts = Object.fromEntries(PERSISTED_STORE_KEYS.map((key) => [
    key,
    Math.max(0, currentCounts[key] - resultingCounts[key]),
  ])) as Record<PersistedStoreKey, number>;
  const relevantCategories = workspaceMode === 'all'
    ? current.categories
    : selectWorkspaceRecords('categories', current.categories, workspaceId!);
  const customCategoryCount = relevantCategories.filter((category) => category.isSystem !== true).length;
  const customSubcategoryCount = relevantCategories.reduce((count, category) =>
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
    workspaceMode,
    ...(workspaceMode === 'selected' ? {
      workspaceId,
      workspaceName: current.workspaces.find((workspace) => workspace.id === workspaceId)?.name as string,
    } : {}),
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
  options: DataResetOptions = {}
): Promise<DataResetPreview> => withDataLock(() => {
  const operation = validateOperation(operationValue);
  recoverPendingRestoresUnlocked(options);
  const current = readCurrentStoreSet(options.dataDirectory);
  const workspaceId = operation === 'factory_reset' ? undefined : options.workspaceId?.trim() || undefined;
  if (operation !== 'factory_reset' && !workspaceId) {
    throw new RestoreError('INVALID_OPERATION', 'Select a workspace before using this operation.');
  }
  if (workspaceId && !current.workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new RestoreError('INVALID_OPERATION', 'The selected workspace no longer exists.');
  }
  const resulting = buildResultingState(operation, current, workspaceId, options.categoryIdFactory);
  return buildPreview(operation, current, resulting, workspaceId);
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
  const workspaceId = operation === 'factory_reset' ? undefined : options.workspaceId?.trim() || undefined;
  if (operation !== 'factory_reset' && !workspaceId) {
    throw new RestoreError('INVALID_OPERATION', 'Select a workspace before using this operation.');
  }
  if (workspaceId && !current.workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new RestoreError('INVALID_OPERATION', 'The selected workspace no longer exists.');
  }
  const resulting = buildResultingState(operation, current, workspaceId, options.categoryIdFactory);
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
    resultingCounts: operation === 'factory_reset'
      ? storeCounts(resulting)
      : workspaceStoreCounts(resulting, workspaceId!),
    cleanupWarning: replacement.cleanupWarning,
  };
});
