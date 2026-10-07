// JSON file-backed store — replaces the in-memory Firestore mock.
// All data is persisted to /data/*.json files on disk.

import { jsonStore } from './json-store';

export const db = jsonStore;

export const hasTransactionsForAccount = async (
  workspaceId: string,
  accountId: string
): Promise<boolean> => {
  const snapshot = await db
    .collection(`workspaces/${workspaceId}/transactions`)
    .get();
  return snapshot.docs.some((doc) => {
    const transaction = doc.data();
    return transaction.accountId === accountId || transaction.destinationAccountId === accountId;
  });
};
