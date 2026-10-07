import type { Workspace } from './types';

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
