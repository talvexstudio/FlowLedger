import type { Workspace } from './types';

export const WORKSPACE_NAME_MAX_LENGTH = 80;

export const SUPPORTED_WORKSPACE_CURRENCIES = [
  'EUR',
  'USD',
  'GBP',
  'CHF',
] as const;

export type SupportedWorkspaceCurrency = (typeof SUPPORTED_WORKSPACE_CURRENCIES)[number];

export const WORKSPACE_CATEGORY_MODES = ['default', 'copy', 'empty'] as const;
export type WorkspaceCategoryMode = (typeof WORKSPACE_CATEGORY_MODES)[number];

export type CreateWorkspaceInput = {
  name: string;
  baseCurrency?: SupportedWorkspaceCurrency;
  categoryMode: WorkspaceCategoryMode;
  sourceWorkspaceId?: string;
};

export type CreateWorkspaceResult = {
  workspace: Workspace;
  categoryCount: number;
  cleanupWarning?: string;
};

export type RenameWorkspaceInput = {
  workspaceId: string;
  name: string;
};

export const isSupportedWorkspaceCurrency = (
  value: unknown
): value is SupportedWorkspaceCurrency =>
  typeof value === 'string' &&
  SUPPORTED_WORKSPACE_CURRENCIES.includes(value as SupportedWorkspaceCurrency);

export const isWorkspaceCategoryMode = (
  value: unknown
): value is WorkspaceCategoryMode =>
  typeof value === 'string' &&
  WORKSPACE_CATEGORY_MODES.includes(value as WorkspaceCategoryMode);

export const canCopyWorkspaceCategories = (
  workspaces: readonly Pick<Workspace, 'id'>[]
) => workspaces.length > 0;
