import { db } from "./firestore";
import type { Workspace } from "../types";

const WORKSPACES_COLLECTION = 'workspaces';

export const getWorkspaces = async (userId: string): Promise<Workspace[]> => {
    const snapshot = await db.collection(WORKSPACES_COLLECTION).where('ownerUserId', '==', userId).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Workspace));
}
