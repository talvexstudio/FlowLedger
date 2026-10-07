import type { Workspace } from './types';
import type { WorkspaceDeletionResult } from './data-management/workspace-deletion-types';

export const isWorkspaceResponseCurrent = (
  activeWorkspaceId: string | null,
  requestedWorkspaceId: string
) => activeWorkspaceId === requestedWorkspaceId;

export const appendCreatedWorkspace = (
  workspaces: readonly Workspace[],
  created: Workspace
) => [...workspaces, created];

export const replaceRenamedWorkspace = (
  workspaces: readonly Workspace[],
  renamed: Workspace
) => workspaces.map((workspace) => workspace.id === renamed.id ? renamed : workspace);

export type WorkspaceDeletionClientState = {
  workspaces: Workspace[];
  selectedWorkspaceId: string | null;
  selectionChanged: boolean;
};

export const applyWorkspaceDeletion = (
  workspaces: readonly Workspace[],
  selectedWorkspaceId: string | null,
  result: Pick<WorkspaceDeletionResult, 'deletedWorkspaceId' | 'nextSelectedWorkspaceId'>
): WorkspaceDeletionClientState => {
  const remaining = workspaces.filter((workspace) => workspace.id !== result.deletedWorkspaceId);
  if (selectedWorkspaceId !== result.deletedWorkspaceId) {
    return { workspaces: remaining, selectedWorkspaceId, selectionChanged: false };
  }

  const nextSelectedWorkspaceId = remaining.some(
    (workspace) => workspace.id === result.nextSelectedWorkspaceId
  )
    ? result.nextSelectedWorkspaceId
    : remaining[0]?.id ?? null;
  return {
    workspaces: remaining,
    selectedWorkspaceId: nextSelectedWorkspaceId,
    selectionChanged: true,
  };
};
