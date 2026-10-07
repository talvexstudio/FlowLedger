import type { Workspace } from '@/lib/types';

export const SELECTED_WORKSPACE_STORAGE_KEY = 'flowledger:selectedWorkspaceId';

export type WorkspaceSelectionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const readPersistedWorkspaceId = (
  storage: WorkspaceSelectionStorage | null
): string | null => {
  if (!storage) return null;
  try {
    const value = storage.getItem(SELECTED_WORKSPACE_STORAGE_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
};

export const persistWorkspaceId = (
  storage: WorkspaceSelectionStorage | null,
  workspaceId: string | null
) => {
  if (!storage) return;
  try {
    if (workspaceId) {
      storage.setItem(SELECTED_WORKSPACE_STORAGE_KEY, workspaceId);
    } else {
      storage.removeItem(SELECTED_WORKSPACE_STORAGE_KEY);
    }
  } catch {
    // Selection still works in memory when browser storage is unavailable.
  }
};

export const resolveWorkspaceId = (
  workspaces: readonly Pick<Workspace, 'id'>[],
  persistedWorkspaceId: string | null
): string | null => {
  if (persistedWorkspaceId && workspaces.some((workspace) => workspace.id === persistedWorkspaceId)) {
    return persistedWorkspaceId;
  }
  return workspaces[0]?.id ?? null;
};

export const initializeWorkspaceSelection = (
  workspaces: readonly Pick<Workspace, 'id'>[],
  storage: WorkspaceSelectionStorage | null
) => {
  const workspaceId = resolveWorkspaceId(workspaces, readPersistedWorkspaceId(storage));
  persistWorkspaceId(storage, workspaceId);
  return workspaceId;
};

export const getWorkspaceSelectorLabel = (
  workspaces: readonly Pick<Workspace, 'id' | 'name'>[],
  workspaceId: string | null,
  initializing: boolean
) => workspaces.find((workspace) => workspace.id === workspaceId)?.name
  ?? (initializing ? 'Loading workspace…' : 'No workspace');
