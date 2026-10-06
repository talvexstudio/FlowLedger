import type { BackupRecord } from './backup';
import { withDataLock } from './data-lock';
import { RestoreError } from './restore-errors';
import { getDataManagementPaths, recoverPendingRestoresUnlocked } from './restore-recovery';
import {
  replaceStoreSetUnlocked,
  type CompleteStoreSet,
  type StoreReplacementTestHooks,
} from './store-replacement';
import { readCompleteStoreSet, validateCompleteStoreSet } from './store-state';
import type {
  TransactionBulkDeletePreview,
  TransactionBulkDeleteResult,
} from './transaction-bulk-delete-types';

export type TransactionBulkDeleteOptions = {
  dataDirectory?: string;
  operationsDirectory?: string;
  now?: () => Date;
  hooks?: StoreReplacementTestHooks;
};

type ResolvedSelection = {
  workspaceId: string;
  selectedIds: string[];
  selectedIdSet: Set<string>;
  selectedTransactions: BackupRecord[];
  completeLinkedPairCount: number;
  incompleteLinkedPairCount: number;
  affectedImportIds: Set<string>;
  zeroLinkedImportSessionCount: number;
};

const recordString = (record: BackupRecord, key: string) =>
  typeof record[key] === 'string' ? record[key] as string : '';

const readCurrentState = (dataDirectory?: string) => {
  try {
    return readCompleteStoreSet(dataDirectory);
  } catch (error) {
    throw new RestoreError(
      'DATA_OPERATION_FAILURE',
      'Transactions cannot be deleted because the current data is unreadable, invalid, or inconsistent.',
      { cause: error }
    );
  }
};

const requireWorkspace = (state: CompleteStoreSet, workspaceIdValue: unknown) => {
  if (typeof workspaceIdValue !== 'string' || workspaceIdValue.trim() === '') {
    throw new RestoreError('INVALID_OPERATION', 'workspaceId is required.');
  }
  if (!state.workspaces.some((workspace) => workspace.id === workspaceIdValue)) {
    throw new RestoreError('INVALID_OPERATION', 'The selected data scope does not exist.');
  }
  return workspaceIdValue;
};

const normalizeSelectedIds = (transactionIdsValue: unknown) => {
  if (!Array.isArray(transactionIdsValue) || transactionIdsValue.length === 0) {
    throw new RestoreError('INVALID_OPERATION', 'Select at least one transaction to delete.');
  }
  if (!transactionIdsValue.every((id) => typeof id === 'string' && id.trim() !== '')) {
    throw new RestoreError('INVALID_OPERATION', 'The selected transaction IDs are invalid.');
  }
  const ids = [...new Set(transactionIdsValue as string[])];
  if (ids.length === 0) {
    throw new RestoreError('INVALID_OPERATION', 'Select at least one transaction to delete.');
  }
  return ids;
};

const resolveSelection = (
  state: CompleteStoreSet,
  workspaceIdValue: unknown,
  transactionIdsValue: unknown
): ResolvedSelection => {
  const workspaceId = requireWorkspace(state, workspaceIdValue);
  const selectedIds = normalizeSelectedIds(transactionIdsValue);
  const transactionIndex = new Map(
    state.transactions.map((transaction) => [recordString(transaction, 'id'), transaction])
  );
  const selectedTransactions = selectedIds.map((id) => {
    const transaction = transactionIndex.get(id);
    if (!transaction) {
      throw new RestoreError('INVALID_OPERATION', 'One or more selected transactions no longer exist.');
    }
    if (transaction.workspaceId !== workspaceId) {
      throw new RestoreError('INVALID_OPERATION', 'The selected transactions do not belong to the current data scope.');
    }
    return transaction;
  });
  const selectedIdSet = new Set(selectedIds);
  const completePairs = new Set<string>();
  const incompletePairs = new Set<string>();

  for (const transaction of selectedTransactions) {
    const transactionId = recordString(transaction, 'id');
    const linkedTransactionId = recordString(transaction, 'linkedTransactionId');
    if (!linkedTransactionId) continue;
    const pairKey = [transactionId, linkedTransactionId].sort().join('::');
    if (selectedIdSet.has(linkedTransactionId)) completePairs.add(pairKey);
    else incompletePairs.add(pairKey);
  }

  const affectedImportIds = new Set(
    selectedTransactions
      .map((transaction) => recordString(transaction, 'importId'))
      .filter(Boolean)
  );
  const zeroLinkedImportSessionCount = [...affectedImportIds].filter((importId) =>
    !state.transactions.some((transaction) =>
      transaction.importId === importId && !selectedIdSet.has(recordString(transaction, 'id'))
    )
  ).length;

  return {
    workspaceId,
    selectedIds,
    selectedIdSet,
    selectedTransactions,
    completeLinkedPairCount: completePairs.size,
    incompleteLinkedPairCount: incompletePairs.size,
    affectedImportIds,
    zeroLinkedImportSessionCount,
  };
};

const previewFromSelection = (
  state: CompleteStoreSet,
  selection: ResolvedSelection
): TransactionBulkDeletePreview => ({
  selectedTransactionCount: selection.selectedIds.length,
  transactionsToDelete: selection.selectedTransactions.length,
  remainingTransactionCount: state.transactions.filter(
    (transaction) => transaction.workspaceId === selection.workspaceId &&
      !selection.selectedIdSet.has(recordString(transaction, 'id'))
  ).length,
  completeLinkedPairCount: selection.completeLinkedPairCount,
  incompleteLinkedPairCount: selection.incompleteLinkedPairCount,
  affectedImportSessionCount: selection.affectedImportIds.size,
  zeroLinkedImportSessionCount: selection.zeroLinkedImportSessionCount,
  allowed: selection.incompleteLinkedPairCount === 0,
});

const buildResultingState = (
  state: CompleteStoreSet,
  selection: ResolvedSelection
) => {
  const result = structuredClone(state) as CompleteStoreSet;
  result.transactions = result.transactions.filter(
    (transaction) => !selection.selectedIdSet.has(recordString(transaction, 'id'))
  );
  validateCompleteStoreSet(result);
  return result;
};

export const previewTransactionBulkDelete = async (
  workspaceIdValue: unknown,
  transactionIdsValue: unknown,
  options: Pick<TransactionBulkDeleteOptions, 'dataDirectory' | 'operationsDirectory'> = {}
): Promise<TransactionBulkDeletePreview> => withDataLock(() => {
  recoverPendingRestoresUnlocked(options);
  const state = readCurrentState(options.dataDirectory);
  return previewFromSelection(state, resolveSelection(state, workspaceIdValue, transactionIdsValue));
});

export const executeTransactionBulkDelete = async (
  workspaceIdValue: unknown,
  transactionIdsValue: unknown,
  confirmDelete: boolean,
  options: TransactionBulkDeleteOptions = {}
): Promise<TransactionBulkDeleteResult> => withDataLock(() => {
  if (confirmDelete !== true) {
    throw new RestoreError('INVALID_OPERATION', 'Explicit confirmation is required to delete selected transactions.');
  }

  recoverPendingRestoresUnlocked(options);
  const state = readCurrentState(options.dataDirectory);
  const selection = resolveSelection(state, workspaceIdValue, transactionIdsValue);
  if (selection.incompleteLinkedPairCount > 0) {
    throw new RestoreError(
      'REFERENTIAL_INTEGRITY_FAILURE',
      `${selection.incompleteLinkedPairCount} linked transfer pair${selection.incompleteLinkedPairCount === 1 ? ' is' : 's are'} incomplete. Select both transfer transactions before deleting.`
    );
  }

  const resulting = buildResultingState(state, selection);
  const replacement = replaceStoreSetUnlocked(resulting, getDataManagementPaths(options), {
    operationKind: 'transaction-bulk-delete',
    targetStores: ['transactions'],
    now: options.now,
    hooks: options.hooks,
    executionFailureCode: 'DATA_OPERATION_FAILURE',
    preparationFailureMessage: 'The transaction deletion could not be prepared. Current data was not changed.',
    rollbackSuccessMessage: 'The transaction deletion failed. Original data was restored successfully.',
    cleanupWarningMessage: 'Transactions were deleted, but temporary recovery files could not be fully removed.',
  });

  const preview = previewFromSelection(state, selection);
  return {
    completed: true,
    deletedTransactions: preview.transactionsToDelete,
    remainingTransactionCount: preview.remainingTransactionCount,
    affectedImportSessionCount: preview.affectedImportSessionCount,
    zeroLinkedImportSessionCount: preview.zeroLinkedImportSessionCount,
    cleanupWarning: replacement.cleanupWarning,
  };
});
