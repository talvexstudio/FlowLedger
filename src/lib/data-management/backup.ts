import { createHash } from 'crypto';
import { withDataLock } from './data-lock';
import {
  BACKUP_SCOPE_STORES,
  isBackupScope,
  PERSISTED_STORES,
  type BackupScope,
  type PersistedStoreKey,
} from './store-manifest';
import {
  BACKUP_FORMAT_VERSION,
  FLOWLEDGER_VERSION,
  MINIMUM_COMPATIBLE_FLOWLEDGER_VERSION,
} from './version';
import { recoverPendingRestoresUnlocked } from './restore-recovery';
import { readCompleteStoreSet } from './store-state';
import { selectWorkspaceRecords } from './workspace-scope';

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type BackupRecord = { [key: string]: JsonValue };

export type BackupStoreManifestEntry = {
  key: PersistedStoreKey;
  filename: string;
  schemaVersion: number;
  recordCount: number;
  sha256: string;
};

export type FlowLedgerBackup = {
  backupFormatVersion: number;
  flowLedgerVersion: string;
  minimumCompatibleFlowLedgerVersion: string;
  createdAt: string;
  scope: BackupScope;
  workspaceSelection: BackupWorkspaceSelection;
  containsSensitiveFinancialData: true;
  includedStores: PersistedStoreKey[];
  storeManifest: BackupStoreManifestEntry[];
  data: Partial<Record<PersistedStoreKey, BackupRecord[]>>;
};

export type BackupWorkspaceSelection = {
  mode: 'all';
  ids: string[];
} | {
  mode: 'selected';
  ids: [string];
  sourceWorkspaceId: string;
  sourceWorkspaceName: string;
  sourceWorkspaceBaseCurrency: string;
};

export type CreateBackupOptions = {
  dataDirectory?: string;
  operationsDirectory?: string;
  now?: () => Date;
  workspaceId?: string | null;
};

export class BackupExportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BackupExportError';
  }
}

const canonicalize = (value: unknown): JsonValue => {
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new BackupExportError('Backup data contains a non-finite number.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  throw new BackupExportError(`Backup data contains an unsupported ${typeof value} value.`);
};

const compareRecordIds = (left: Record<string, unknown>, right: Record<string, unknown>) =>
  String(left.id ?? '').localeCompare(String(right.id ?? ''));

export const canonicalizeStoreRecords = (records: Record<string, unknown>[]): BackupRecord[] =>
  [...records]
    .sort(compareRecordIds)
    .map((record) => canonicalize(record) as BackupRecord);

export const calculateStoreChecksum = (records: BackupRecord[]) =>
  createHash('sha256').update(JSON.stringify(records), 'utf-8').digest('hex');

const collectWorkspaceIds = (data: Partial<Record<PersistedStoreKey, BackupRecord[]>>) => {
  const ids = new Set<string>();
  for (const workspace of data.workspaces ?? []) {
    if (typeof workspace.id === 'string') ids.add(workspace.id);
  }
  for (const records of Object.values(data)) {
    for (const record of records ?? []) {
      if (typeof record.workspaceId === 'string') ids.add(record.workspaceId);
    }
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
};

export const createBackup = async (
  scope: BackupScope,
  options: CreateBackupOptions = {}
): Promise<FlowLedgerBackup> => {
  if (!isBackupScope(scope)) throw new BackupExportError('Unsupported backup scope.');

  return withDataLock(() => {
    try {
      recoverPendingRestoresUnlocked(options);
    } catch (error) {
      throw new BackupExportError('Cannot export while unfinished restore recovery requires attention.', {
        cause: error,
      });
    }
    const includedStores = [...BACKUP_SCOPE_STORES[scope]];
    const workspaceScoped = scope !== 'everything';
    const selectedWorkspaceId = options.workspaceId?.trim() || null;
    if (workspaceScoped && !selectedWorkspaceId) {
      throw new BackupExportError('Select a workspace before exporting this backup scope.');
    }

    let completeState;
    try {
      completeState = readCompleteStoreSet(options.dataDirectory);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'persisted data is unreadable or inconsistent';
      throw new BackupExportError(`Cannot export because ${detail}.`, {
        cause: error,
      });
    }
    const selectedWorkspace = selectedWorkspaceId
      ? completeState.workspaces.find((workspace) => workspace.id === selectedWorkspaceId)
      : undefined;
    if (workspaceScoped && !selectedWorkspace) {
      throw new BackupExportError('The selected workspace no longer exists.');
    }

    const data: Partial<Record<PersistedStoreKey, BackupRecord[]>> = {};
    const storeManifest: BackupStoreManifestEntry[] = [];

    for (const key of includedStores) {
      const definition = PERSISTED_STORES[key];
      let rawRecords: Record<string, unknown>[];
      try {
        rawRecords = completeState[key];
        definition.validate(rawRecords);
      } catch (error) {
        throw new BackupExportError(`Cannot export ${definition.filename}: the store is unreadable or invalid.`, {
          cause: error,
        });
      }

      const scopedRecords = workspaceScoped
        ? selectWorkspaceRecords(key, rawRecords as BackupRecord[], selectedWorkspaceId!)
        : rawRecords;
      const records = canonicalizeStoreRecords(scopedRecords);
      data[key] = records;
      storeManifest.push({
        key,
        filename: definition.filename,
        schemaVersion: definition.schemaVersion,
        recordCount: records.length,
        sha256: calculateStoreChecksum(records),
      });
    }

    return {
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      flowLedgerVersion: FLOWLEDGER_VERSION,
      minimumCompatibleFlowLedgerVersion: MINIMUM_COMPATIBLE_FLOWLEDGER_VERSION,
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
      scope,
      workspaceSelection: workspaceScoped
        ? {
            mode: 'selected',
            ids: [selectedWorkspaceId!],
            sourceWorkspaceId: selectedWorkspaceId!,
            sourceWorkspaceName: selectedWorkspace!.name as string,
            sourceWorkspaceBaseCurrency: selectedWorkspace!.baseCurrency as string,
          }
        : { mode: 'all', ids: collectWorkspaceIds(data) },
      containsSensitiveFinancialData: true,
      includedStores,
      storeManifest,
      data,
    };
  });
};

export const createBackupFilename = (createdAt: string, scope: BackupScope) => {
  const timestamp = createdAt.replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
  const scopeName = scope.replace(/_/g, '-');
  return `flowledger-backup-${timestamp}-${scopeName}.json`;
};
