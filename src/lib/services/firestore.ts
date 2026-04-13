// JSON file-backed store — replaces the in-memory Firestore mock.
// All data is persisted to /data/*.json files on disk.

import { jsonStore } from './json-store';
import type { Transaction } from '../types';

export const db = jsonStore;

export const hasTransactionsForAccount = async (
  workspaceId: string,
  accountId: string
): Promise<boolean> => {
  const snapshot = await db
    .collection(`workspaces/${workspaceId}/transactions`)
    .where('accountId', '==', accountId)
    .get();
  return snapshot.docs.length > 0;
};
