import type { WorkspaceDeletionPreview } from './workspace-deletion-types';

export const workspaceDeletionBackupRequest = (workspaceId: string) => ({
  scope: 'financial_data' as const,
  workspaceId,
});

export const canSubmitWorkspaceDeletion = (
  preview: WorkspaceDeletionPreview | null,
  confirmed: boolean,
  busy: boolean
) => Boolean(preview?.canDelete && confirmed && !busy);
