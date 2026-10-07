export const isWorkspaceResponseCurrent = (
  activeWorkspaceId: string | null,
  requestedWorkspaceId: string
) => activeWorkspaceId === requestedWorkspaceId;
