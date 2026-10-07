import { effectiveCategoryWorkspaceId, type PersistedCategory } from '../category-ownership';
import type { BackupRecord } from './backup';
import type { PersistedStoreKey } from './store-manifest';

export const isWorkspaceOwnedRecord = (
  storeKey: PersistedStoreKey,
  record: BackupRecord,
  workspaceId: string
) => {
  if (storeKey === 'workspaces') return record.id === workspaceId;
  if (storeKey === 'categories') {
    return effectiveCategoryWorkspaceId(record as PersistedCategory) === workspaceId;
  }
  return record.workspaceId === workspaceId;
};

export const selectWorkspaceRecords = (
  storeKey: PersistedStoreKey,
  records: BackupRecord[],
  workspaceId: string
) => records.filter((record) => isWorkspaceOwnedRecord(storeKey, record, workspaceId));

export const replaceWorkspaceRecords = (
  storeKey: PersistedStoreKey,
  current: BackupRecord[],
  replacement: BackupRecord[],
  workspaceId: string
) => [
  ...current.filter((record) => !isWorkspaceOwnedRecord(storeKey, record, workspaceId)),
  ...structuredClone(replacement),
];
