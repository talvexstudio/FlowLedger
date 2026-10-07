import { db } from './firestore';

export class WorkspaceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceIntegrityError';
  }
}

export const assertWorkspaceExists = async (workspaceId: string): Promise<void> => {
  if (!workspaceId) throw new WorkspaceIntegrityError('workspaceId is required.');
  const workspace = await db.collection('workspaces').doc(workspaceId).get();
  if (!workspace.exists) throw new WorkspaceIntegrityError('Workspace not found.');
};

export const assertWorkspaceDocumentExists = async (
  workspaceId: string,
  collectionName: 'accounts' | 'imports' | 'importTemplates' | 'rules' | 'budgets' | 'transactions',
  id: string,
  label: string
): Promise<void> => {
  const snapshot = await db
    .collection(`workspaces/${workspaceId}/${collectionName}`)
    .doc(id)
    .get();
  if (!snapshot.exists) {
    throw new WorkspaceIntegrityError(`${label} not found in the selected workspace.`);
  }
};
