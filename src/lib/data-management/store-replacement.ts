import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { BackupRecord } from './backup';
import { RestoreError, type RestoreErrorCode } from './restore-errors';
import {
  cleanupRestoreOperation,
  rollbackRestoreFromSnapshot,
  writeRestoreJournal,
  type DataManagementOperationKind,
  type DataManagementPaths,
  type RestoreJournal,
} from './restore-recovery';
import {
  PERSISTED_STORE_KEYS,
  PERSISTED_STORES,
  type PersistedStoreKey,
} from './store-manifest';
import { replaceFileAtomically } from '../services/json-store';

export type CompleteStoreSet = Record<PersistedStoreKey, BackupRecord[]>;

export const STORE_REPLACEMENT_ORDER = [...PERSISTED_STORE_KEYS]
  .sort((left, right) => PERSISTED_STORES[left].restoreOrder - PERSISTED_STORES[right].restoreOrder);

export type StoreReplacementContext = {
  operationDirectory: string;
  snapshotDirectory: string;
  stagedPaths: Record<PersistedStoreKey, string>;
};

export type StoreReplacementTestHooks = {
  onSnapshotCreated?: (context: StoreReplacementContext) => void;
  beforeReplace?: (storeKey: PersistedStoreKey, index: number, context: StoreReplacementContext) => void;
  afterReplace?: (storeKey: PersistedStoreKey, index: number, context: StoreReplacementContext) => void;
  beforeRollback?: (context: StoreReplacementContext) => void;
};

export type StoreReplacementOptions = {
  operationKind: DataManagementOperationKind;
  targetStores: readonly PersistedStoreKey[];
  now?: () => Date;
  hooks?: StoreReplacementTestHooks;
  executionFailureCode: RestoreErrorCode;
  preparationFailureMessage: string;
  rollbackSuccessMessage: string;
  cleanupWarningMessage: string;
};

export type StoreReplacementResult = {
  replacedStores: PersistedStoreKey[];
  cleanupWarning?: string;
};

const createOperationContext = (
  paths: DataManagementPaths,
  operationKind: DataManagementOperationKind,
  operationId: string
): StoreReplacementContext => {
  const operationDirectory = path.join(paths.operationsDirectory, `${operationKind}-${operationId}`);
  const snapshotDirectory = path.join(operationDirectory, 'snapshot');
  fs.mkdirSync(snapshotDirectory, { recursive: true });
  const stagedPaths = {} as Record<PersistedStoreKey, string>;
  for (const key of PERSISTED_STORE_KEYS) {
    stagedPaths[key] = path.join(
      paths.dataDirectory,
      `.flowledger-${operationKind}-${operationId}-${randomUUID()}-${PERSISTED_STORES[key].filename}.stage`
    );
  }
  return { operationDirectory, snapshotDirectory, stagedPaths };
};

const snapshotCurrentStores = (
  paths: DataManagementPaths,
  context: StoreReplacementContext
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
  data: CompleteStoreSet,
  targetStores: readonly PersistedStoreKey[],
  context: StoreReplacementContext
) => {
  fs.mkdirSync(path.dirname(context.stagedPaths.workspaces), { recursive: true });
  for (const key of targetStores) {
    fs.writeFileSync(context.stagedPaths[key], JSON.stringify(data[key], null, 2), {
      encoding: 'utf-8',
      flag: 'wx',
    });
  }
};

const cleanupWithoutJournal = (context: StoreReplacementContext) => {
  for (const stagedPath of Object.values(context.stagedPaths)) {
    fs.rmSync(stagedPath, { force: true });
  }
  fs.rmSync(context.operationDirectory, { recursive: true, force: true });
};

export const replaceStoreSetUnlocked = (
  data: CompleteStoreSet,
  paths: DataManagementPaths,
  options: StoreReplacementOptions
): StoreReplacementResult => {
  const targetStores = STORE_REPLACEMENT_ORDER.filter((key) => options.targetStores.includes(key));
  if (targetStores.length !== new Set(options.targetStores).size) {
    throw new RestoreError(options.executionFailureCode, 'The data replacement store set is invalid.');
  }

  const operationId = randomUUID();
  const context = createOperationContext(paths, options.operationKind, operationId);
  let journal: RestoreJournal | null = null;

  try {
    const originalPresence = snapshotCurrentStores(paths, context);
    options.hooks?.onSnapshotCreated?.(context);
    writeStagedStores(data, targetStores, context);

    journal = {
      journalVersion: 1,
      operationKind: options.operationKind,
      operationId,
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
      state: 'prepared',
      targetStores,
      snapshotDirectory: 'snapshot',
      stagedFiles: Object.fromEntries(
        targetStores.map((key) => [key, path.basename(context.stagedPaths[key])])
      ),
      originalPresence,
      replacedStores: [],
    } as RestoreJournal;
    writeRestoreJournal(context.operationDirectory, journal);

    journal.state = 'replacing';
    writeRestoreJournal(context.operationDirectory, journal);
    targetStores.forEach((key, index) => {
      options.hooks?.beforeReplace?.(key, index, context);
      const targetPath = path.join(paths.dataDirectory, PERSISTED_STORES[key].filename);
      replaceFileAtomically(context.stagedPaths[key], targetPath);
      journal!.replacedStores.push(key);
      writeRestoreJournal(context.operationDirectory, journal!);
      options.hooks?.afterReplace?.(key, index, context);
    });

    journal.state = 'completed';
    writeRestoreJournal(context.operationDirectory, journal);
  } catch (error) {
    if (!journal) {
      cleanupWithoutJournal(context);
      throw new RestoreError(options.executionFailureCode, options.preparationFailureMessage, { cause: error });
    }

    try {
      options.hooks?.beforeRollback?.(context);
      rollbackRestoreFromSnapshot(paths, context.operationDirectory, journal);
    } catch (rollbackError) {
      journal.state = 'rollback_failed';
      try {
        writeRestoreJournal(context.operationDirectory, journal);
      } catch {
        // Preserve the rollback error and all remaining recovery artifacts.
      }
      throw new RestoreError(
        'ROLLBACK_FAILURE',
        'The data operation failed and automatic rollback could not complete. Recovery artifacts were preserved.',
        { cause: rollbackError }
      );
    }

    journal.state = 'rolled_back';
    try {
      writeRestoreJournal(context.operationDirectory, journal);
      cleanupRestoreOperation(paths, context.operationDirectory, journal);
    } catch {
      // Original data is restored. A later data-management access only has cleanup left to do.
    }

    throw new RestoreError(options.executionFailureCode, options.rollbackSuccessMessage, { cause: error });
  }

  let cleanupWarning: string | undefined;
  try {
    cleanupRestoreOperation(paths, context.operationDirectory, journal);
  } catch {
    cleanupWarning = options.cleanupWarningMessage;
  }

  return { replacedStores: targetStores, cleanupWarning };
};
