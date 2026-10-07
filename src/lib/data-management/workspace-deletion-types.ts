export type WorkspaceDeletionCounts = {
  accountsCount: number;
  categoriesCount: number;
  subcategoriesCount: number;
  importsCount: number;
  importTemplatesCount: number;
  budgetsCount: number;
  rulesCount: number;
  transactionsCount: number;
};

export type WorkspaceDeletionPreview = WorkspaceDeletionCounts & {
  workspaceId: string;
  workspaceName: string;
  workspaceBaseCurrency: string;
  workspaceCountBefore: number;
  workspaceCountAfter: number;
  canDelete: boolean;
  blockingReason?: string;
  suggestedNextWorkspaceId?: string;
};

export type WorkspaceDeletionResult = WorkspaceDeletionCounts & {
  deletedWorkspaceId: string;
  nextSelectedWorkspaceId: string;
  cleanupWarning?: string;
};
