import type { BackupScope } from './store-manifest';

export const IMPORT_HISTORY_ACTIONS = [
  'delete_with_transactions',
  'delete_all_with_transactions',
] as const;

export type ImportHistoryAction = (typeof IMPORT_HISTORY_ACTIONS)[number];

export type ImportHistorySummary = {
  id: string;
  workspaceId: string;
  accountId: string;
  accountName: string;
  fileName: string;
  sourceType: 'CSV' | 'XLSX' | 'PDF';
  createdAt: string;
  template: string;
  linkedTransactionCount: number;
  historicalTransactionCount: number;
};

export type ImportHistoryPreview = {
  action: ImportHistoryAction;
  workspaceId: string;
  import?: ImportHistorySummary;
  importSessionCount: number;
  linkedTransactionCount: number;
  transactionsToDelete: number;
  transactionsToPreserve: number;
  blockedLinkedPairCount: number;
  allowed: boolean;
  backupScope: BackupScope;
};

export type ImportHistoryResult = {
  completed: true;
  action: ImportHistoryAction;
  workspaceId: string;
  removedImportSessions: number;
  deletedTransactions: number;
  cleanupWarning?: string;
};

export const IMPORT_HISTORY_ACTION_OPTIONS: Record<ImportHistoryAction, {
  label: string;
  confirmation: string;
  allImports: boolean;
}> = {
  delete_with_transactions: {
    label: 'Delete import and transactions',
    confirmation: 'I understand that this import session and its linked transactions will be permanently removed.',
    allImports: false,
  },
  delete_all_with_transactions: {
    label: 'Delete all imported transactions',
    confirmation: 'I understand that all imported transactions and their import sessions will be removed. Manual transactions will be preserved.',
    allImports: true,
  },
};

export const isImportHistoryAction = (value: unknown): value is ImportHistoryAction =>
  typeof value === 'string' && IMPORT_HISTORY_ACTIONS.includes(value as ImportHistoryAction);
