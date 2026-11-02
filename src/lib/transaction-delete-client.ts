export type TransactionDeleteClientDependencies = {
  deleteTransaction: (workspaceId: string, transactionId: string) => Promise<unknown>;
  reloadTransactions: () => Promise<unknown> | unknown;
};

export const deleteTransactionAndReload = async (
  workspaceId: string,
  transactionId: string,
  dependencies: TransactionDeleteClientDependencies
) => {
  await dependencies.deleteTransaction(workspaceId, transactionId);
  await dependencies.reloadTransactions();
};
