import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { withDataLock } from './data-lock';
import { RestoreError } from './restore-errors';
import {
  cleanupRestoreOperation,
  getDataManagementPaths,
  recoverPendingRestoresUnlocked,
  rollbackRestoreFromSnapshot,
  writeRestoreJournal,
  type DataManagementPaths,
  type RestoreJournal,
} from './restore-recovery';
import {
  buildRestorePreview,
  parseAndValidateRestoreBackup,
  type RestorePreview,
  type ValidatedRestoreBackup,
} from './restore-validation';
import {
  PERSISTED_STORE_KEYS,
  PERSISTED_STORES,
  type PersistedStoreKey,
} from './store-manifest';

export const RESTORE_WRITE_ORDER = [...PERSISTED_STORE_KEYS]
  .sort((left, right) => PERSISTED_STORES[left].restoreOrder - PERSISTED_STORES[right].restoreOrder);

export type RestoreOperationContext = {
  operationDirectory: string;
  snapshotDirectory: string;
  stagedPaths: Record<PersistedStoreKey, string>;
};

export type RestoreTestHooks = {
  onSnapshotCreated?: (context: RestoreOperationContext) => void;
  beforeReplace?: (storeKey: PersistedStoreKey, index: number, context: RestoreOperationContext) => void;
  afterReplace?: (storeKey: PersistedStoreKey, index: number, context: RestoreOperationContext) => void;
  beforeRollback?: (context: RestoreOperationContext) => void;
};

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

const createOperationContext = (
  paths: DataManagementPaths,
  operationId: string
): RestoreOperationContext => {
  const operationDirectory = path.join(paths.operationsDirectory, `restore-${operationId}`);
  const snapshotDirectory = path.join(operationDirectory, 'snapshot');
  fs.mkdirSync(snapshotDirectory, { recursive: true });
  const stagedPaths = {} as Record<PersistedStoreKey, string>;
  for (const key of PERSISTED_STORE_KEYS) {
    stagedPaths[key] = path.join(
      paths.dataDirectory,
      `.flowledger-restore-${operationId}-${randomUUID()}-${PERSISTED_STORES[key].filename}.stage`
    );
  }
  return { operationDirectory, snapshotDirectory, stagedPaths };
};

const snapshotCurrentStores = (
  paths: DataManagementPaths,
  context: RestoreOperationContext
): Record<PersistedStoreKey, boolean> => {
  const originalPresence = {} as Record<PersistedStoreKey, boolean>;
  for (const key of PERSISTED_STORE_KEYS) {
    const filename = PERSISTED_STORES[key].filename;
    const source = path.join(paths.dataDirectory, filename);
    const destination = path.join(context.snapshotDirectory, filename);
    originalPresence[key] = fs.existsSync(source);
    if (originalPresence[key]) fs.copyFileSync(source, destination);
  }
  return originalPresence;
};

const writeStagedStores = (
  backup: ValidatedRestoreBackup,
  context: RestoreOperationContext
) => {
  fs.mkdirSync(path.dirname(context.stagedPaths.workspaces), { recursive: true });
  for (const key of PERSISTED_STORE_KEYS) {
    fs.writeFileSync(context.stagedPaths[key], JSON.stringify(backup.data[key], null, 2), {
      encoding: 'utf-8',
      flag: 'wx',
    });
  }
};

const cleanupWithoutJournal = (context: RestoreOperationContext) => {
  for (const stagedPath of Object.values(context.stagedPaths)) {
    fs.rmSync(stagedPath, { force: true });
  }
  fs.rmSync(context.operationDirectory, { recursive: true, force: true });
};

const executeValidatedRestore = (
  backup: ValidatedRestoreBackup,
  paths: DataManagementPaths,
  options: RestoreOptions
): RestoreResult => {
  const operationId = randomUUID();
  const context = createOperationContext(paths, operationId);
  let journal: RestoreJournal | null = null;

  try {
    const originalPresence = snapshotCurrentStores(paths, context);
    options.hooks?.onSnapshotCreated?.(context);
    writeStagedStores(backup, context);

    journal = {
      journalVersion: 1,
      operationId,
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
      state: 'prepared',
      targetStores: [...RESTORE_WRITE_ORDER],
      snapshotDirectory: 'snapshot',
      stagedFiles: Object.fromEntries(
        PERSISTED_STORE_KEYS.map((key) => [key, path.basename(context.stagedPaths[key])])
      ),
      originalPresence,
      replacedStores: [],
    } as RestoreJournal;
    writeRestoreJournal(context.operationDirectory, journal);

    journal.state = 'replacing';
    writeRestoreJournal(context.operationDirectory, journal);
    RESTORE_WRITE_ORDER.forEach((key, index) => {
      options.hooks?.beforeReplace?.(key, index, context);
      const targetPath = path.join(paths.dataDirectory, PERSISTED_STORES[key].filename);
      fs.renameSync(context.stagedPaths[key], targetPath);
      journal!.replacedStores.push(key);
      writeRestoreJournal(context.operationDirectory, journal!);
      options.hooks?.afterReplace?.(key, index, context);
    });

    journal.state = 'completed';
    writeRestoreJournal(context.operationDirectory, journal);
  } catch (error) {
    if (!journal) {
      cleanupWithoutJournal(context);
      throw new RestoreError(
        'RESTORE_EXECUTION_FAILURE',
        'Restore preparation failed before current data was replaced.',
        { cause: error }
      );
    }

    try {
      options.hooks?.beforeRollback?.(context);
      rollbackRestoreFromSnapshot(paths, context.operationDirectory, journal);
    } catch (rollbackError) {
      journal.state = 'rollback_failed';
      try {
        writeRestoreJournal(context.operationDirectory, journal);
      } catch {
        // Preserve the rollback error; artifacts remain where possible.
      }
      throw new RestoreError(
        'ROLLBACK_FAILURE',
        'Restore failed and automatic rollback could not complete. Recovery artifacts were preserved.',
        { cause: rollbackError }
      );
    }

    journal.state = 'rolled_back';
    try {
      writeRestoreJournal(context.operationDirectory, journal);
      cleanupRestoreOperation(paths, context.operationDirectory, journal);
    } catch {
      // Original data is already restored. A later recovery access will only clean artifacts.
    }

    throw new RestoreError(
      'RESTORE_EXECUTION_FAILURE',
      'Restore failed. The original data was restored successfully.',
      { cause: error }
    );
  }

  let cleanupWarning: string | undefined;
  try {
    cleanupRestoreOperation(paths, context.operationDirectory, journal);
  } catch {
    cleanupWarning = 'Restore succeeded, but temporary recovery files could not be fully removed.';
  }

  return {
    restored: true,
    scope: backup.scope,
    restoredStores: [...PERSISTED_STORE_KEYS],
    clearedStores: PERSISTED_STORE_KEYS.filter((key) => !backup.includedStores.includes(key)),
    cleanupWarning,
  };
};

export const previewRestore = async (
  backupJson: string,
  options: Pick<RestoreOptions, 'dataDirectory' | 'operationsDirectory'> = {}
): Promise<RestorePreview> => withDataLock(() => {
  recoverPendingRestoresUnlocked(options);
  return buildRestorePreview(parseAndValidateRestoreBackup(backupJson));
});

export const restoreBackup = async (
  backupJson: string,
  options: RestoreOptions = {}
): Promise<RestoreResult> => withDataLock(() => {
  recoverPendingRestoresUnlocked(options);
  const backup = parseAndValidateRestoreBackup(backupJson);
  return executeValidatedRestore(backup, getDataManagementPaths(options), options);
});
