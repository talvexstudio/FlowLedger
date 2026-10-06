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

export const RESTORE_WRITE_ORDER = STORE_REPLACEMENT_ORDER;
export type RestoreOperationContext = StoreReplacementContext;
export type RestoreTestHooks = StoreReplacementTestHooks;

export type RestoreOptions = {
  dataDirectory?: string;
  operationsDirectory?: string;
  now?: () => Date;
  hooks?: RestoreTestHooks;
};

export type RestoreResult = {
  restored: true;
  scope: ValidatedRestoreBackup['scope'];
  restoredStores: PersistedStoreKey[];
  clearedStores: PersistedStoreKey[];
  cleanupWarning?: string;
};

const prepareRestoreState = (
  backup: ValidatedRestoreBackup,
  options: Pick<RestoreOptions, 'dataDirectory'>
) => {
  const requiresPreservedState = backup.scope === 'activity' || backup.scope === 'financial_data';
  let resultingState = structuredClone(backup.data) as ValidatedRestoreBackup['data'];

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
    for (const key of backup.includedStores) {
      resultingState[key] = structuredClone(backup.data[key]);
    }
  }

  validateCompleteStoreSet(resultingState);
  const targetStores = backup.scope === LEGACY_RESTORE_SCOPE
    ? [...PERSISTED_STORE_KEYS]
    : [...RESTORE_SCOPE_STORES[backup.scope]];
  return { resultingState, targetStores };
};

export const previewRestore = async (
  backupJson: string,
  options: Pick<RestoreOptions, 'dataDirectory' | 'operationsDirectory'> = {}
): Promise<RestorePreview> => withDataLock(() => {
  recoverPendingRestoresUnlocked(options);
  const backup = parseAndValidateRestoreBackup(backupJson);
  prepareRestoreState(backup, options);
  return buildRestorePreview(backup);
});

export const restoreBackup = async (
  backupJson: string,
  options: RestoreOptions = {}
): Promise<RestoreResult> => withDataLock(() => {
  recoverPendingRestoresUnlocked(options);
  const backup = parseAndValidateRestoreBackup(backupJson);
  const { resultingState, targetStores } = prepareRestoreState(backup, options);
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
  };
});
