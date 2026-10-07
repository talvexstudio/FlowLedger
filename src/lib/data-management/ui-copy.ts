import type { DataResetOperation } from './data-reset';
import type { BackupScope } from './store-manifest';

export const CLEAR_RESET_SECTION_TITLE = 'Clear & Reset Data';
export const CLEAR_RESET_SECTION_DESCRIPTION =
  'Review the exact impact before clearing or resetting local FlowLedger data.';

export const RESET_OPTIONS: Record<DataResetOperation, {
  title: string;
  description: string;
  confirmation: string;
  action: string;
}> = {
  clear_activity: {
    title: 'Clear Activity',
    description: 'Remove transactions and import history from the selected workspace while keeping its financial setup.',
    confirmation: "I understand that this workspace's transactions and import history will be removed.",
    action: 'Clear activity',
  },
  reset_financial: {
    title: 'Reset Financial Data',
    description: 'Reset the selected workspace’s financial data and categories while preserving the workspace itself.',
    confirmation: "I understand that this workspace's financial data will be reset.",
    action: 'Reset financial data',
  },
  factory_reset: {
    title: 'Factory Reset',
    description: 'Remove all local FlowLedger data and return to the default workspace and starter categories.',
    confirmation: 'I understand that all FlowLedger data will be replaced with the default local setup.',
    action: 'Factory reset',
  },
};

export const formatCount = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

export const isWorkspaceScopedBackup = (scope: BackupScope) => scope !== 'everything';

export const canUseBackupScope = (scope: BackupScope, workspaceId: string | null) =>
  !isWorkspaceScopedBackup(scope) || Boolean(workspaceId);

export const canUseDataReset = (operation: DataResetOperation, workspaceId: string | null) =>
  operation === 'factory_reset' || Boolean(workspaceId);

export const backupScopeDescription = (
  scope: BackupScope,
  workspaceName?: string
) => {
  if (scope === 'everything') return 'All FlowLedger data across all workspaces';
  if (!workspaceName) return 'Select a workspace to use this scope';
  return scope === 'activity'
    ? `Transactions and import history in ${workspaceName}`
    : `Accounts, categories, transactions, imports, templates, budgets, and rules in ${workspaceName}`;
};

export const dataResetTargetLabel = (
  operation: DataResetOperation,
  workspaceName?: string
) => operation === 'factory_reset'
  ? 'All workspaces'
  : workspaceName
    ? `Current workspace: ${workspaceName}`
    : 'No workspace selected';
