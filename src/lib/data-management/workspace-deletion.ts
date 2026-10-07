import { withDataLock } from './data-lock';
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
import { PERSISTED_STORE_KEYS, type PersistedStoreKey } from './store-manifest';
import { readCompleteStoreSet, validateCompleteStoreSet } from './store-state';
import { isWorkspaceOwnedRecord, selectWorkspaceRecords } from './workspace-scope';
import type {
  WorkspaceDeletionCounts,
  WorkspaceDeletionPreview,
  WorkspaceDeletionResult,
} from './workspace-deletion-types';

export const LAST_WORKSPACE_DELETE_MESSAGE =
  'You can’t delete the last workspace. Use Factory Reset if you want to reset FlowLedger.';

export class WorkspaceDeletionError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'LAST_WORKSPACE',
    readonly status: number
  ) {
    super(message);
    this.name = 'WorkspaceDeletionError';
  }
}

export type WorkspaceDeletionOptions = {
  dataDirectory?: string;
  operationsDirectory?: string;
  now?: () => Date;
  hooks?: StoreReplacementTestHooks;
};

const requireWorkspaceId = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WorkspaceDeletionError('Workspace ID is required.', 'INVALID_REQUEST', 400);
  }
  return value.trim();
};

const readCurrentState = (dataDirectory?: string) => {
  try {
    return readCompleteStoreSet(dataDirectory);
  } catch (error) {
    throw new RestoreError(
      'DATA_OPERATION_FAILURE',
      'Workspace deletion cannot continue because persisted data is invalid or inconsistent.',
      { cause: error }
    );
  }
};

const ownedRecords = (
  current: CompleteStoreSet,
  key: Exclude<PersistedStoreKey, 'workspaces'>,
  workspaceId: string
) => selectWorkspaceRecords(key, current[key], workspaceId);

const deletionCounts = (
  current: CompleteStoreSet,
  workspaceId: string
): WorkspaceDeletionCounts => {
  const categories = ownedRecords(current, 'categories', workspaceId);
  return {
    accountsCount: ownedRecords(current, 'accounts', workspaceId).length,
    categoriesCount: categories.length,
    subcategoriesCount: categories.reduce((total, category) => (
      total + (Array.isArray(category.subcategories) ? category.subcategories.length : 0)
    ), 0),
    importsCount: ownedRecords(current, 'imports', workspaceId).length,
    importTemplatesCount: ownedRecords(current, 'importTemplates', workspaceId).length,
    budgetsCount: ownedRecords(current, 'budgets', workspaceId).length,
    rulesCount: ownedRecords(current, 'rules', workspaceId).length,
    transactionsCount: ownedRecords(current, 'transactions', workspaceId).length,
  };
};

const buildPreview = (
  current: CompleteStoreSet,
  workspaceId: string
): WorkspaceDeletionPreview => {
  const workspace = current.workspaces.find((record) => record.id === workspaceId);
  if (!workspace) {
    throw new WorkspaceDeletionError('Workspace not found.', 'NOT_FOUND', 404);
  }
  const remaining = current.workspaces.filter((record) => record.id !== workspaceId);
  const canDelete = current.workspaces.length > 1;
  return {
    workspaceId,
    workspaceName: workspace.name as string,
    workspaceBaseCurrency: workspace.baseCurrency as string,
    workspaceCountBefore: current.workspaces.length,
    workspaceCountAfter: remaining.length,
    ...deletionCounts(current, workspaceId),
    canDelete,
    ...(canDelete ? {} : { blockingReason: LAST_WORKSPACE_DELETE_MESSAGE }),
    ...(remaining[0]?.id ? { suggestedNextWorkspaceId: remaining[0].id as string } : {}),
  };
};

const withoutWorkspace = (
  current: CompleteStoreSet,
  workspaceId: string
): CompleteStoreSet => {
  const resulting = structuredClone(current) as CompleteStoreSet;
  for (const key of PERSISTED_STORE_KEYS) {
    resulting[key] = current[key].filter(
      (record) => !isWorkspaceOwnedRecord(key, record, workspaceId)
    );
  }
  return resulting;
};

export const previewWorkspaceDeletion = async (
  workspaceIdValue: unknown,
  options: WorkspaceDeletionOptions = {}
): Promise<WorkspaceDeletionPreview> => withDataLock(() => {
  const workspaceId = requireWorkspaceId(workspaceIdValue);
  recoverPendingRestoresUnlocked(options);
  const current = readCurrentState(options.dataDirectory);
  return buildPreview(current, workspaceId);
});

export const deleteWorkspace = async (
  workspaceIdValue: unknown,
  confirmed: boolean,
  options: WorkspaceDeletionOptions = {}
): Promise<WorkspaceDeletionResult> => withDataLock(() => {
  const workspaceId = requireWorkspaceId(workspaceIdValue);
  if (!confirmed) {
    throw new WorkspaceDeletionError(
      'Explicit confirmation is required to delete a workspace.',
      'INVALID_REQUEST',
      400
    );
  }

  recoverPendingRestoresUnlocked(options);
  const current = readCurrentState(options.dataDirectory);
  const preview = buildPreview(current, workspaceId);
  if (!preview.canDelete || !preview.suggestedNextWorkspaceId) {
    throw new WorkspaceDeletionError(LAST_WORKSPACE_DELETE_MESSAGE, 'LAST_WORKSPACE', 409);
  }

  const resulting = withoutWorkspace(current, workspaceId);
  try {
    validateCompleteStoreSet(resulting);
  } catch (error) {
    throw new RestoreError(
      'DATA_OPERATION_FAILURE',
      'Workspace deletion was blocked because retained data would become inconsistent.',
      { cause: error }
    );
  }

  const replacement = replaceStoreSetUnlocked(resulting, getDataManagementPaths(options), {
    operationKind: 'workspace-delete',
    targetStores: PERSISTED_STORE_KEYS,
    now: options.now,
    hooks: options.hooks,
    executionFailureCode: 'DATA_OPERATION_FAILURE',
    preparationFailureMessage: 'Workspace deletion could not be prepared. Current data was not changed.',
    rollbackSuccessMessage: 'Workspace deletion failed. Original data was restored successfully.',
    cleanupWarningMessage: 'The workspace was deleted, but temporary recovery files could not be fully removed.',
  });

  return {
    deletedWorkspaceId: workspaceId,
    nextSelectedWorkspaceId: preview.suggestedNextWorkspaceId,
    accountsCount: preview.accountsCount,
    categoriesCount: preview.categoriesCount,
    subcategoriesCount: preview.subcategoriesCount,
    importsCount: preview.importsCount,
    importTemplatesCount: preview.importTemplatesCount,
    budgetsCount: preview.budgetsCount,
    rulesCount: preview.rulesCount,
    transactionsCount: preview.transactionsCount,
    cleanupWarning: replacement.cleanupWarning,
  };
});
