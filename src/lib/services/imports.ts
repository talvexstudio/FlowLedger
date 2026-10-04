import { db } from "./firestore";
import type { ImportSession, ImportTemplate, Transaction } from "../types";
import {
  findDuplicateTransactions,
  findPotentialTransfers,
  toPotentialDuplicateMatchContext,
} from "../utils/duplicate-utils";
import {
  deleteTransactionsByImport,
  getTransactions,
  saveTransaction,
} from "./transactions";

const importsCollection = (workspaceId: string) => `workspaces/${workspaceId}/imports`;
const templatesCollection = (workspaceId: string) => `workspaces/${workspaceId}/importTemplates`;

export const saveImportSession = async (
  workspaceId: string,
  session: Omit<ImportSession, "id">
): Promise<ImportSession> => {
  const docRef = await db.collection(importsCollection(workspaceId)).add(session);
  return { ...session, id: docRef.id };
};

export const getImportSessions = async (workspaceId: string): Promise<ImportSession[]> => {
  const snapshot = await db.collection(importsCollection(workspaceId)).get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ImportSession));
};

export const deleteImportSession = async (workspaceId: string, importId: string): Promise<void> => {
  await db.collection(importsCollection(workspaceId)).doc(importId).delete();
};

export const getImportTemplates = async (
  workspaceId: string
): Promise<ImportTemplate[]> => {
  const snapshot = await db.collection(templatesCollection(workspaceId)).get();
  return snapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() } as ImportTemplate)
  );
};

export const saveImportTemplate = async (
  workspaceId: string,
  data: Omit<ImportTemplate, "id" | "createdAt">
): Promise<ImportTemplate> => {
  const coll = db.collection(templatesCollection(workspaceId));
  const payload: Omit<ImportTemplate, "id"> = {
    ...data,
    createdAt: new Date(),
  };
  const docRef = await coll.add(payload);
  return { ...payload, id: docRef.id };
};

export const findMatchingTemplate = async (
  workspaceId: string,
  headerSignature: string[]
): Promise<ImportTemplate | null> => {
  const templates = await getImportTemplates(workspaceId);
  return (
    templates.find(
      (tpl) =>
        JSON.stringify(tpl.headerSignature) === JSON.stringify(headerSignature)
    ) || null
  );
};

export type ImportCommitDependencies = {
  saveSession: typeof saveImportSession;
  deleteSession: typeof deleteImportSession;
  getExistingTransactions: typeof getTransactions;
  saveTransaction: typeof saveTransaction;
  deleteTransactionsByImport: typeof deleteTransactionsByImport;
};

const defaultCommitDependencies: ImportCommitDependencies = {
  saveSession: saveImportSession,
  deleteSession: deleteImportSession,
  getExistingTransactions: getTransactions,
  saveTransaction,
  deleteTransactionsByImport,
};

export class ImportCommitError extends Error {
  rollbackComplete: boolean;

  constructor(message: string, rollbackComplete: boolean, cause?: unknown) {
    super(message, { cause });
    this.name = 'ImportCommitError';
    this.rollbackComplete = rollbackComplete;
  }
}

export const commitImport = async (
  workspaceId: string,
  sessionData: Omit<ImportSession, 'id'>,
  transactionCandidates: Partial<Transaction>[],
  dependencies: ImportCommitDependencies = defaultCommitDependencies
): Promise<{ session: ImportSession; transactions: Transaction[] }> => {
  let session: ImportSession | null = null;

  try {
    session = await dependencies.saveSession(workspaceId, {
      ...sessionData,
      workspaceId,
      transactionCount: transactionCandidates.length,
    });
    const existingTransactions = await dependencies.getExistingTransactions(workspaceId);
    const comparisonTransactions = [...existingTransactions];
    const transactions: Transaction[] = [];

    for (const candidate of transactionCandidates) {
      const { id: _candidateId, ...candidateData } = candidate;
      const transaction: Partial<Transaction> = {
        ...candidateData,
        workspaceId,
        importId: session.id,
      };
      const duplicates = findDuplicateTransactions(transaction, comparisonTransactions);
      const transfers = findPotentialTransfers(transaction, comparisonTransactions);

      if (duplicates.length > 0) {
        transaction.isPotentialDuplicate = true;
        transaction.potentialDuplicateMatch = toPotentialDuplicateMatchContext(duplicates[0]);
        transaction.needsReview = true;
      }
      if (transfers.length > 0) {
        transaction.isPotentialTransfer = true;
        transaction.potentialTransferMatch = transfers[0];
        transaction.needsReview = true;
      }

      const saved = await dependencies.saveTransaction(workspaceId, transaction) as Transaction;
      transactions.push(saved);
      comparisonTransactions.push(saved);
    }

    return { session, transactions };
  } catch (error) {
    if (!session) {
      throw new ImportCommitError('Import failed before any data was written.', true, error);
    }

    let rollbackComplete = true;
    try {
      await dependencies.deleteTransactionsByImport(workspaceId, session.id);
    } catch {
      rollbackComplete = false;
    }
    try {
      await dependencies.deleteSession(workspaceId, session.id);
    } catch {
      rollbackComplete = false;
    }

    const message = rollbackComplete
      ? 'Import failed and all records from this attempt were rolled back.'
      : 'Import failed and automatic rollback was incomplete. Do not retry until the import session is inspected.';
    throw new ImportCommitError(message, rollbackComplete, error);
  }
};
