export type WorkspaceMenuDialogAction = 'create' | 'rename' | 'delete';

/**
 * Modal workspace dialogs open only after the Radix dropdown has committed its
 * closed state. This avoids overlapping dismissable-layer pointer/focus locks.
 */
export const resolveQueuedWorkspaceDialog = (
  menuOpen: boolean,
  pendingAction: WorkspaceMenuDialogAction | null
) => menuOpen ? null : pendingAction;
