import fs from 'fs';
import path from 'path';
import { withDataLock } from './data-lock';
import {
  PERSISTED_STORE_KEYS,
  PERSISTED_STORES,
  type PersistedStoreKey,
} from './store-manifest';
import { RestoreError } from './restore-errors';
import { getDataDirectory, writeFileAtomically } from '../services/json-store';

export const RESTORE_JOURNAL_VERSION = 1;
export const RESTORE_JOURNAL_FILENAME = 'restore-journal.json';

export type RestoreJournalState = 'prepared' | 'replacing' | 'rollback_failed' | 'rolled_back' | 'completed';

export type RestoreJournal = {
  journalVersion: 1;
  operationId: string;
  createdAt: string;
  state: RestoreJournalState;
  targetStores: PersistedStoreKey[];
  snapshotDirectory: 'snapshot';
  stagedFiles: Partial<Record<PersistedStoreKey, string>>;
  originalPresence: Record<PersistedStoreKey, boolean>;
  replacedStores: PersistedStoreKey[];
};

export type DataManagementPaths = {
  dataDirectory: string;
  operationsDirectory: string;
};

export const getDataManagementPaths = (options: {
  dataDirectory?: string;
  operationsDirectory?: string;
} = {}): DataManagementPaths => ({
  dataDirectory: getDataDirectory(options.dataDirectory),
  operationsDirectory:
    options.operationsDirectory ??
    process.env.FLOWLEDGER_DATA_MANAGEMENT_DIR ??
    path.join(process.cwd(), '.local', 'data-management'),
});

const isStoreKey = (value: unknown): value is PersistedStoreKey =>
  typeof value === 'string' && PERSISTED_STORE_KEYS.includes(value as PersistedStoreKey);

const readJournal = (journalPath: string): RestoreJournal => {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
  } catch (error) {
    throw new RestoreError(
      'ROLLBACK_FAILURE',
      'An unfinished restore journal could not be read. Manual recovery is required.',
      { cause: error }
    );
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RestoreError('ROLLBACK_FAILURE', 'An unfinished restore journal is invalid. Manual recovery is required.');
  }
  const journal = value as Partial<RestoreJournal>;
  if (
    journal.journalVersion !== RESTORE_JOURNAL_VERSION ||
    typeof journal.operationId !== 'string' ||
    !Array.isArray(journal.targetStores) ||
    !journal.targetStores.every(isStoreKey) ||
    !journal.originalPresence ||
    typeof journal.originalPresence !== 'object' ||
    !journal.stagedFiles ||
    typeof journal.stagedFiles !== 'object' ||
    !Array.isArray(journal.replacedStores)
  ) {
    throw new RestoreError('ROLLBACK_FAILURE', 'An unfinished restore journal is invalid. Manual recovery is required.');
  }
  return journal as RestoreJournal;
};

export const writeRestoreJournal = (operationDirectory: string, journal: RestoreJournal) => {
  fs.mkdirSync(operationDirectory, { recursive: true });
  writeFileAtomically(
    path.join(operationDirectory, RESTORE_JOURNAL_FILENAME),
    JSON.stringify(journal, null, 2)
  );
};

const removeStagedFiles = (paths: DataManagementPaths, journal: RestoreJournal) => {
  for (const stagedName of Object.values(journal.stagedFiles)) {
    if (!stagedName) continue;
    fs.rmSync(path.join(paths.dataDirectory, path.basename(stagedName)), { force: true });
  }
};

export const cleanupRestoreOperation = (
  paths: DataManagementPaths,
  operationDirectory: string,
  journal: RestoreJournal
) => {
  removeStagedFiles(paths, journal);
  fs.rmSync(operationDirectory, { recursive: true, force: true });
};

export const rollbackRestoreFromSnapshot = (
  paths: DataManagementPaths,
  operationDirectory: string,
  journal: RestoreJournal
) => {
  const snapshotDirectory = path.join(operationDirectory, journal.snapshotDirectory);
  for (const key of PERSISTED_STORE_KEYS) {
    const targetPath = path.join(paths.dataDirectory, PERSISTED_STORES[key].filename);
    if (journal.originalPresence[key]) {
      const snapshotPath = path.join(snapshotDirectory, PERSISTED_STORES[key].filename);
      if (!fs.existsSync(snapshotPath)) {
        throw new Error(`Missing rollback snapshot for ${PERSISTED_STORES[key].filename}`);
      }
      writeFileAtomically(targetPath, fs.readFileSync(snapshotPath));
    } else {
      fs.rmSync(targetPath, { force: true });
    }
  }
};

export const recoverPendingRestoresUnlocked = (options: {
  dataDirectory?: string;
  operationsDirectory?: string;
} = {}) => {
  const paths = getDataManagementPaths(options);
  if (!fs.existsSync(paths.operationsDirectory)) return;

  const operationDirectories = fs.readdirSync(paths.operationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(paths.operationsDirectory, entry.name))
    .filter((directory) => fs.existsSync(path.join(directory, RESTORE_JOURNAL_FILENAME)))
    .sort();

  for (const operationDirectory of operationDirectories) {
    const journalPath = path.join(operationDirectory, RESTORE_JOURNAL_FILENAME);
    const journal = readJournal(journalPath);
    try {
      if (journal.state !== 'completed' && journal.state !== 'rolled_back') {
        rollbackRestoreFromSnapshot(paths, operationDirectory, journal);
      }
      cleanupRestoreOperation(paths, operationDirectory, journal);
    } catch (error) {
      const failedJournal = { ...journal, state: 'rollback_failed' as const };
      try {
        writeRestoreJournal(operationDirectory, failedJournal);
      } catch {
        // Preserve the original recovery error. Existing artifacts remain for manual recovery.
      }
      throw new RestoreError(
        'ROLLBACK_FAILURE',
        'Automatic recovery of an unfinished restore failed. The recovery artifacts were preserved.',
        { cause: error }
      );
    }
  }
};

export const recoverPendingRestores = (options: {
  dataDirectory?: string;
  operationsDirectory?: string;
} = {}) => withDataLock(() => recoverPendingRestoresUnlocked(options));
