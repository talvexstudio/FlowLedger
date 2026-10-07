import { withDataLock } from './data-lock';
import {
  getDataManagementPaths,
  recoverPendingRestoresUnlocked,
} from './restore-recovery';
import {
  buildRestorePreview,
  parseAndValidateRestoreBackup,
  type RestorePreview,
  type ValidatedRestoreBackup,
} from './restore-validation';
import {
  replaceStoreSetUnlocked,
  STORE_REPLACEMENT_ORDER,
  type StoreReplacementContext,
  type StoreReplacementTestHooks,
} from './store-replacement';
import {
  LEGACY_RESTORE_SCOPE,
  PERSISTED_STORE_KEYS,
  RESTORE_SCOPE_STORES,
  type PersistedStoreKey,
} from './store-manifest';
import { readCompleteStoreSet, validateCompleteStoreSet } from './store-state';
import { RestoreError } from './restore-errors';
import { replaceWorkspaceRecords } from './workspace-scope';
import { normalizeWorkspaceName } from './workspace-lifecycle';

export const RESTORE_WRITE_ORDER = STORE_REPLACEMENT_ORDER;
export type RestoreOperationContext = StoreReplacementContext;
export type RestoreTestHooks = StoreReplacementTestHooks;

export type RestoreOptions = {
  dataDirectory?: string;
  operationsDirectory?: string;
  now?: () => Date;
  hooks?: RestoreTestHooks;
  recreateMissingWorkspace?: boolean;
  recreatedWorkspaceName?: string;
};

export type RestoreResult = {
  restored: true;
  scope: ValidatedRestoreBackup['scope'];
  restoredStores: PersistedStoreKey[];
  clearedStores: PersistedStoreKey[];
  cleanupWarning?: string;
  recreatedWorkspaceId?: string;
};

const prepareRestoreState = (
  backup: ValidatedRestoreBackup,
  options: Pick<RestoreOptions, 'dataDirectory' | 'now' | 'recreateMissingWorkspace' | 'recreatedWorkspaceName'>
) => {
  const requiresPreservedState = backup.scope === 'activity' || backup.scope === 'financial_data';
  let resultingState = structuredClone(backup.data) as ValidatedRestoreBackup['data'];
  let recreatedWorkspaceId: string | undefined;

  if (requiresPreservedState) {
    try {
      resultingState = readCompleteStoreSet(options.dataDirectory);
    } catch (error) {
      throw new RestoreError(
        'REFERENTIAL_INTEGRITY_FAILURE',
        'Current preserved data is unreadable or inconsistent, so this scoped backup cannot be restored safely.',
        { cause: error }
      );
    }
    if (backup.workspaceSelection.mode === 'selected') {
      const sourceWorkspaceId = backup.workspaceSelection.sourceWorkspaceId;
      const existingWorkspace = resultingState.workspaces.find((workspace) => workspace.id === sourceWorkspaceId);
      if (!existingWorkspace) {
        if (!options.recreateMissingWorkspace) {
          throw new RestoreError(
            'SOURCE_WORKSPACE_MISSING',
            `Workspace "${backup.workspaceSelection.sourceWorkspaceName}" no longer exists.`
          );
        }
        const name = normalizeWorkspaceName(
          options.recreatedWorkspaceName ?? backup.workspaceSelection.sourceWorkspaceName
        );
        const timestamp = (options.now ?? (() => new Date()))().toISOString();
        resultingState.workspaces.push({
          id: sourceWorkspaceId,
          ownerUserId: 'local',
          name,
          baseCurrency: backup.workspaceSelection.sourceWorkspaceBaseCurrency,
          createdAt: backup.createdAt,
          updatedAt: timestamp,
        });
        recreatedWorkspaceId = sourceWorkspaceId;
      } else if (options.recreateMissingWorkspace) {
        throw new RestoreError(
          'WORKSPACE_ID_CONFLICT',
          'The source workspace ID already exists and cannot be recreated.'
        );
      }

      for (const key of backup.includedStores) {
        resultingState[key] = replaceWorkspaceRecords(
          key,
          resultingState[key],
          backup.data[key],
          sourceWorkspaceId
        );
      }
    } else {
      // Backups created before workspace-aware scopes retain their historical
      // global replacement semantics.
      for (const key of backup.includedStores) {
        resultingState[key] = structuredClone(backup.data[key]);
      }
    }
  }

  validateCompleteStoreSet(resultingState);
  const targetStores = backup.scope === LEGACY_RESTORE_SCOPE
    ? [...PERSISTED_STORE_KEYS]
    : [
        ...(recreatedWorkspaceId ? ['workspaces' as const] : []),
        ...RESTORE_SCOPE_STORES[backup.scope],
      ];
  return { resultingState, targetStores, recreatedWorkspaceId };
};

export const previewRestore = async (
  backupJson: string,
  options: Pick<RestoreOptions, 'dataDirectory' | 'operationsDirectory'> = {}
): Promise<RestorePreview> => withDataLock(() => {
  recoverPendingRestoresUnlocked(options);
  const backup = parseAndValidateRestoreBackup(backupJson);
  if (backup.workspaceSelection.mode === 'selected') {
    const sourceWorkspaceId = backup.workspaceSelection.sourceWorkspaceId;
    let current;
    try {
      current = readCompleteStoreSet(options.dataDirectory);
    } catch (error) {
      throw new RestoreError(
        'REFERENTIAL_INTEGRITY_FAILURE',
        'Current data is unreadable or inconsistent, so this backup cannot be previewed safely.',
        { cause: error }
      );
    }
    const sourceExists = current.workspaces.some(
      (workspace) => workspace.id === sourceWorkspaceId
    );
    if (!sourceExists) {
      try {
        prepareRestoreState(backup, { ...options, recreateMissingWorkspace: true });
        return buildRestorePreview(backup, 'missing', { canRecreateWorkspace: true });
      } catch (error) {
        return buildRestorePreview(backup, 'missing', {
          canRecreateWorkspace: false,
          recreationBlockReason: error instanceof Error
            ? `The workspace cannot be recreated safely: ${error.message}`
            : 'The workspace cannot be recreated safely from this backup.',
        });
      }
    }
  }
  prepareRestoreState(backup, options);
  return buildRestorePreview(backup);
});

export const restoreBackup = async (
  backupJson: string,
  options: RestoreOptions = {}
): Promise<RestoreResult> => withDataLock(() => {
  recoverPendingRestoresUnlocked(options);
  const backup = parseAndValidateRestoreBackup(backupJson);
  const { resultingState, targetStores, recreatedWorkspaceId } = prepareRestoreState(backup, options);
  const replacement = replaceStoreSetUnlocked(resultingState, getDataManagementPaths(options), {
    operationKind: 'restore',
    targetStores,
    now: options.now,
    hooks: options.hooks,
    executionFailureCode: 'RESTORE_EXECUTION_FAILURE',
    preparationFailureMessage: 'Restore preparation failed before current data was replaced.',
    rollbackSuccessMessage: 'Restore failed. The original data was restored successfully.',
    cleanupWarningMessage: 'Restore succeeded, but temporary recovery files could not be fully removed.',
  });

  return {
    restored: true,
    scope: backup.scope,
    restoredStores: [...replacement.replacedStores],
    clearedStores: backup.scope === LEGACY_RESTORE_SCOPE
      ? PERSISTED_STORE_KEYS.filter((key) => !backup.includedStores.includes(key))
      : [],
    cleanupWarning: replacement.cleanupWarning,
    recreatedWorkspaceId,
  };
});
