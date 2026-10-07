import { randomUUID } from 'node:crypto';
import {
  categoryBelongsToWorkspace,
  normalizeRuntimeCategory,
  type PersistedCategory,
  type RuntimeCategory,
} from '../category-ownership';
import type { Category, Subcategory } from '../types';
import { db } from './firestore';

const categoriesCollection = () => db.collection('categories');

const requireWorkspace = async (workspaceId: string) => {
  if (!workspaceId) throw new Error('workspaceId is required.');
  const workspace = await db.collection('workspaces').doc(workspaceId).get();
  if (!workspace.exists) throw new Error('Workspace not found.');
};

const getPersistedCategories = async (): Promise<PersistedCategory[]> => {
  const snapshot = await categoriesCollection().get();
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as PersistedCategory));
};

export const getCategories = async (workspaceId: string): Promise<RuntimeCategory[]> => {
  await requireWorkspace(workspaceId);
  const categories = await getPersistedCategories();
  return categories
    .filter((category) => categoryBelongsToWorkspace(category, workspaceId))
    .map(normalizeRuntimeCategory);
};

export const getCategory = async (
  workspaceId: string,
  categoryId: string
): Promise<RuntimeCategory | null> => {
  await requireWorkspace(workspaceId);
  const category = (await getPersistedCategories()).find((candidate) => candidate.id === categoryId);
  if (!category || !categoryBelongsToWorkspace(category, workspaceId)) return null;
  return normalizeRuntimeCategory(category);
};

type CategoryWrite = Omit<Category, 'id' | 'workspaceId'> & {
  id?: string;
  workspaceId?: string;
  subcategories?: Subcategory[];
};

const normalizeSubcategoriesForWrite = (
  workspaceId: string,
  categoryId: string,
  subcategories: Subcategory[] = []
) => subcategories.map((subcategory) => {
  if (subcategory.workspaceId && subcategory.workspaceId !== workspaceId) {
    throw new Error('Subcategory does not belong to the selected workspace.');
  }
  if (subcategory.categoryId && subcategory.categoryId !== categoryId) {
    throw new Error('Subcategory does not belong to the selected category.');
  }
  return { ...subcategory, workspaceId, categoryId };
});

export const saveCategory = async (
  workspaceId: string,
  category: CategoryWrite
): Promise<RuntimeCategory> => {
  await requireWorkspace(workspaceId);
  if (category.workspaceId && category.workspaceId !== workspaceId) {
    throw new Error('Category does not belong to the selected workspace.');
  }
  const coll = categoriesCollection();
  if (category.id) {
    const existing = await getCategory(workspaceId, category.id);
    if (!existing) throw new Error('Category not found in the selected workspace.');
    const { id, ...incoming } = category;
    const subcategories = incoming.subcategories
      ? normalizeSubcategoriesForWrite(workspaceId, id, incoming.subcategories)
      : existing.subcategories;
    const persisted = { ...incoming, workspaceId, subcategories };
    await coll.doc(id).set(persisted, { merge: true });
    return normalizeRuntimeCategory({ ...existing, ...persisted, id });
  }

  const { id: _id, ...incoming } = category;
  const docRef = await coll.add({ ...incoming, workspaceId, subcategories: [] });
  return normalizeRuntimeCategory({
    ...incoming,
    id: docRef.id,
    workspaceId,
    subcategories: [],
  });
};

const newSubcategoryId = () => `sub_${randomUUID()}`;

export const saveSubcategory = async (
  workspaceId: string,
  categoryId: string,
  subcategory: Omit<Subcategory, 'workspaceId'> & { workspaceId?: string }
): Promise<Subcategory> => {
  const category = await getCategory(workspaceId, categoryId);
  if (!category) throw new Error('Category not found in the selected workspace.');
  if (subcategory.workspaceId && subcategory.workspaceId !== workspaceId) {
    throw new Error('Subcategory does not belong to the selected workspace.');
  }
  if (subcategory.categoryId && subcategory.categoryId !== categoryId) {
    throw new Error('Subcategory does not belong to the selected category.');
  }

  const existingIndex = category.subcategories.findIndex(
    (candidate) => candidate.id === subcategory.id
  );
  const id = existingIndex >= 0 ? subcategory.id : newSubcategoryId();
  const normalized: Subcategory = { ...subcategory, id, workspaceId, categoryId };
  const subcategories = [...category.subcategories];
  if (existingIndex >= 0) subcategories[existingIndex] = normalized;
  else subcategories.push(normalized);

  await categoriesCollection().doc(categoryId).set(
    { workspaceId, subcategories },
    { merge: true }
  );
  return normalized;
};

const categoryReferenceExists = async (workspaceId: string, categoryId: string) => {
  for (const collectionName of ['transactions', 'rules', 'budgets'] as const) {
    const snapshot = await db.collection(`workspaces/${workspaceId}/${collectionName}`).get();
    if (snapshot.docs.some((doc) => {
      const data = doc.data();
      return data.categoryId === categoryId || data.action?.categoryId === categoryId;
    })) return true;
  }
  return false;
};

export const deleteCategory = async (workspaceId: string, categoryId: string): Promise<void> => {
  const existing = await getCategory(workspaceId, categoryId);
  if (!existing) throw new Error('Category not found in the selected workspace.');
  if (await categoryReferenceExists(workspaceId, categoryId)) {
    throw new Error('This category is in use and cannot be deleted.');
  }
  await categoriesCollection().doc(categoryId).delete();
};
