import { db } from "./firestore";
import type { ImportSession, ImportTemplate } from "../types";

const importsCollection = (workspaceId: string) => `workspaces/${workspaceId}/imports`;
const templatesCollection = (workspaceId: string) => `workspaces/${workspaceId}/importTemplates`;

export const saveImportSession = async (
  workspaceId: string,
  session: Omit<ImportSession, "id">
): Promise<ImportSession> => {
  const docRef = await db.collection(importsCollection(workspaceId)).add(session);
  return { ...session, id: docRef.id };
};

export const getImportSessions = async (workspaceId: string): Promise<ImportSession[]> => {
  const snapshot = await db.collection(importsCollection(workspaceId)).get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ImportSession));
};

export const deleteImportSession = async (workspaceId: string, importId: string): Promise<void> => {
  await db.collection(importsCollection(workspaceId)).doc(importId).delete();
};

export const getImportTemplates = async (
  workspaceId: string
): Promise<ImportTemplate[]> => {
  const snapshot = await db.collection(templatesCollection(workspaceId)).get();
  return snapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() } as ImportTemplate)
  );
};

export const saveImportTemplate = async (
  workspaceId: string,
  data: Omit<ImportTemplate, "id" | "createdAt">
): Promise<ImportTemplate> => {
  const coll = db.collection(templatesCollection(workspaceId));
  const payload: Omit<ImportTemplate, "id"> = {
    ...data,
    createdAt: new Date(),
  };
  const docRef = await coll.add(payload);
  return { ...payload, id: docRef.id };
};

export const findMatchingTemplate = async (
  workspaceId: string,
  headerSignature: string[]
): Promise<ImportTemplate | null> => {
  const templates = await getImportTemplates(workspaceId);
  return (
    templates.find(
      (tpl) =>
        JSON.stringify(tpl.headerSignature) === JSON.stringify(headerSignature)
    ) || null
  );
};
