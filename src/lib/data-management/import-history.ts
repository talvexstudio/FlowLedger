import type { BackupRecord } from './backup';
import { withDataLock } from './data-lock';
import {
  IMPORT_HISTORY_ACTION_OPTIONS,
  isImportHistoryAction,
  type ImportHistoryAction,
  type ImportHistoryPreview,
  type ImportHistoryResult,
  type ImportHistorySummary,
} from './import-history-types';
import { RestoreError } from './restore-errors';
import {
  getDataManagementPaths,
  recoverPendingRestoresUnlocked,
} from './restore-recovery';
import {
  replaceStoreSetUnlocked,
  type CompleteStoreSet,
  type StoreReplacementTestHooks,
} from './store-replacement';
import { readCompleteStoreSet, validateCompleteStoreSet } from './store-state';

export type ImportHistoryOptions = {
  dataDirectory?: string;
  operationsDirectory?: string;
  now?: () => Date;
  hooks?: StoreReplacementTestHooks;
};

type ImportHistorySelection = {
  action: ImportHistoryAction;
  workspaceId: string;
  targetImports: BackupRecord[];
  targetImportIds: Set<string>;
  matchingTransactions: BackupRecord[];
  matchingTransactionIds: Set<string>;
  blockedLinkedPairCount: number;
};

const requiredString = (value: unknown, label: string) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RestoreError('INVALID_OPERATION', `${label} is required.`);
  }
  return value;
};

const recordString = (record: BackupRecord, key: string) =>
  typeof record[key] === 'string' ? record[key] as string : '';

const recordNumber = (record: BackupRecord, key: string) =>
  typeof record[key] === 'number' ? record[key] as number : 0;

const readCurrentState = (dataDirectory?: string) => {
  try {
    return readCompleteStoreSet(dataDirectory);
  } catch (error) {
    throw new RestoreError(
      'DATA_OPERATION_FAILURE',
      'Import history cannot be managed because the current data is unreadable, invalid, or inconsistent.',
      { cause: error }
    );
  }
};

const requireWorkspace = (state: CompleteStoreSet, workspaceIdValue: unknown) => {
  const workspaceId = requiredString(workspaceIdValue, 'workspaceId');
  if (!state.workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new RestoreError('INVALID_OPERATION', 'The selected workspace does not exist.');
  }
  return workspaceId;
};

const summaryForImport = (
  importSession: BackupRecord,
  state: CompleteStoreSet,
  linkedTransactionCount?: number
): ImportHistorySummary => {
  const workspaceId = recordString(importSession, 'workspaceId');
  const accountId = recordString(importSession, 'accountId');
  const account = state.accounts.find((record) => record.id === accountId);
  const actualCount = linkedTransactionCount ?? state.transactions.filter(
    (transaction) => transaction.importId === importSession.id
  ).length;

  return {
    id: recordString(importSession, 'id'),
    workspaceId,
    accountId,
    accountName: account ? recordString(account, 'name') : 'Unknown account',
    fileName: recordString(importSession, 'fileName'),
    sourceType: recordString(importSession, 'sourceType') as ImportHistorySummary['sourceType'],
    createdAt: recordString(importSession, 'createdAt'),
    template: recordString(importSession, 'template'),
    linkedTransactionCount: actualCount,
    historicalTransactionCount: recordNumber(importSession, 'transactionCount'),
  };
};

const compareImportSummaries = (left: ImportHistorySummary, right: ImportHistorySummary) => {
  const dateOrder = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  return dateOrder || left.id.localeCompare(right.id);
};

const listFromState = (state: CompleteStoreSet, workspaceId: string) => state.imports
  .filter((importSession) => importSession.workspaceId === workspaceId)
  .map((importSession) => summaryForImport(importSession, state))
  .sort(compareImportSummaries);

const validateAction = (actionValue: unknown) => {
  if (!isImportHistoryAction(actionValue)) {
    throw new RestoreError('INVALID_OPERATION', 'The requested import-history action is not supported.');
  }
  return actionValue;
};

const countBoundaryPairs = (
  state: CompleteStoreSet,
  matchingTransactionIds: Set<string>
) => {
  const blockedPairs = new Set<string>();
  for (const transaction of state.transactions) {
    if (!matchingTransactionIds.has(recordString(transaction, 'id'))) continue;
    const linkedId = recordString(transaction, 'linkedTransactionId');
    if (!linkedId || matchingTransactionIds.has(linkedId)) continue;
    blockedPairs.add([recordString(transaction, 'id'), linkedId].sort().join('::'));
  }
  return blockedPairs.size;
};

const selectOperation = (
  state: CompleteStoreSet,
  workspaceIdValue: unknown,
  actionValue: unknown,
  importIdValue?: unknown
): ImportHistorySelection => {
  const action = validateAction(actionValue);
  const workspaceId = requireWorkspace(state, workspaceIdValue);
  const definition = IMPORT_HISTORY_ACTION_OPTIONS[action];
  let targetImports: BackupRecord[];

  if (definition.allImports) {
    targetImports = state.imports.filter((importSession) => importSession.workspaceId === workspaceId);
  } else {
    const importId = requiredString(importIdValue, 'importId');
    const importSession = state.imports.find((candidate) => candidate.id === importId);
    if (!importSession) {
      throw new RestoreError('INVALID_OPERATION', 'The selected import session does not exist.');
    }
    if (importSession.workspaceId !== workspaceId) {
      throw new RestoreError('INVALID_OPERATION', 'The selected import session belongs to a different workspace.');
    }
    targetImports = [importSession];
  }

  const targetImportIds = new Set(targetImports.map((record) => recordString(record, 'id')));
  const matchingTransactions = state.transactions.filter(
    (transaction) => transaction.workspaceId === workspaceId &&
      targetImportIds.has(recordString(transaction, 'importId'))
  );
  const matchingTransactionIds = new Set(
    matchingTransactions.map((transaction) => recordString(transaction, 'id'))
  );
  const blockedLinkedPairCount = countBoundaryPairs(state, matchingTransactionIds);

  return {
    action,
    workspaceId,
    targetImports,
    targetImportIds,
    matchingTransactions,
    matchingTransactionIds,
    blockedLinkedPairCount,
  };
};

const previewFromSelection = (
  state: CompleteStoreSet,
  selection: ImportHistorySelection
): ImportHistoryPreview => {
  const workspaceTransactionCount = state.transactions.filter(
    (transaction) => transaction.workspaceId === selection.workspaceId
  ).length;
  const linkedTransactionCount = selection.matchingTransactions.length;

  return {
    action: selection.action,
    workspaceId: selection.workspaceId,
    import: IMPORT_HISTORY_ACTION_OPTIONS[selection.action].allImports || selection.targetImports.length === 0
      ? undefined
      : summaryForImport(selection.targetImports[0], state, linkedTransactionCount),
    importSessionCount: selection.targetImports.length,
    linkedTransactionCount,
    transactionsToDelete: linkedTransactionCount,
    transactionsToPreserve: workspaceTransactionCount - linkedTransactionCount,
    blockedLinkedPairCount: selection.blockedLinkedPairCount,
    allowed: selection.blockedLinkedPairCount === 0,
    backupScope: 'activity',
  };
};

const buildResultingState = (
  state: CompleteStoreSet,
  selection: ImportHistorySelection
): CompleteStoreSet => {
  const result = structuredClone(state) as CompleteStoreSet;
  result.imports = result.imports.filter(
    (importSession) => !selection.targetImportIds.has(recordString(importSession, 'id'))
  );

  result.transactions = result.transactions.filter(
    (transaction) => !selection.matchingTransactionIds.has(recordString(transaction, 'id'))
  );

  validateCompleteStoreSet(result);
  return result;
};

export const listImportHistory = async (
  workspaceIdValue: unknown,
  options: Pick<ImportHistoryOptions, 'dataDirectory' | 'operationsDirectory'> = {}
): Promise<ImportHistorySummary[]> => withDataLock(() => {
  recoverPendingRestoresUnlocked(options);
  const state = readCurrentState(options.dataDirectory);
  const workspaceId = requireWorkspace(state, workspaceIdValue);
  return listFromState(state, workspaceId);
});

export const previewImportHistoryAction = async (
  workspaceIdValue: unknown,
  actionValue: unknown,
  importIdValue?: unknown,
  options: Pick<ImportHistoryOptions, 'dataDirectory' | 'operationsDirectory'> = {}
): Promise<ImportHistoryPreview> => withDataLock(() => {
  recoverPendingRestoresUnlocked(options);
  const state = readCurrentState(options.dataDirectory);
  const selection = selectOperation(state, workspaceIdValue, actionValue, importIdValue);
  return previewFromSelection(state, selection);
});

export const executeImportHistoryAction = async (
  workspaceIdValue: unknown,
  actionValue: unknown,
  importIdValue: unknown,
  confirmed: boolean,
  options: ImportHistoryOptions = {}
): Promise<ImportHistoryResult> => withDataLock(() => {
  const action = validateAction(actionValue);
  if (confirmed !== true) {
    throw new RestoreError('INVALID_OPERATION', 'Explicit confirmation is required for this import-history operation.');
  }

  recoverPendingRestoresUnlocked(options);
  const state = readCurrentState(options.dataDirectory);
  const selection = selectOperation(state, workspaceIdValue, action, importIdValue);
  if (selection.blockedLinkedPairCount > 0) {
    throw new RestoreError(
      'REFERENTIAL_INTEGRITY_FAILURE',
      `${selection.blockedLinkedPairCount} linked transfer pair${selection.blockedLinkedPairCount === 1 ? '' : 's'} cross the import boundary. Both legs must be included in the same deletion.`
    );
  }

  const resulting = buildResultingState(state, selection);
  const replacement = replaceStoreSetUnlocked(resulting, getDataManagementPaths(options), {
    operationKind: 'import-history-delete',
    targetStores: ['imports', 'transactions'],
    now: options.now,
    hooks: options.hooks,
    executionFailureCode: 'DATA_OPERATION_FAILURE',
    preparationFailureMessage: 'The import-history operation could not be prepared. Current data was not changed.',
    rollbackSuccessMessage: 'The import-history operation failed. Original data was restored successfully.',
    cleanupWarningMessage: 'The import-history operation succeeded, but temporary recovery files could not be fully removed.',
  });

  return {
    completed: true,
    action,
    workspaceId: selection.workspaceId,
    removedImportSessions: selection.targetImports.length,
    deletedTransactions: selection.matchingTransactions.length,
    cleanupWarning: replacement.cleanupWarning,
  };
});
