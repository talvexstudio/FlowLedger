export type TransactionBulkDeletePreview = {
  selectedTransactionCount: number;
  transactionsToDelete: number;
  remainingTransactionCount: number;
  completeLinkedPairCount: number;
  incompleteLinkedPairCount: number;
  affectedImportSessionCount: number;
  zeroLinkedImportSessionCount: number;
  allowed: boolean;
};

export type TransactionBulkDeleteResult = {
  completed: true;
  deletedTransactions: number;
  remainingTransactionCount: number;
  affectedImportSessionCount: number;
  zeroLinkedImportSessionCount: number;
  cleanupWarning?: string;
};
