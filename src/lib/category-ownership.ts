import type { Category, Subcategory } from './types';

export const LEGACY_CATEGORY_WORKSPACE_ID = 'ws1';

export type PersistedCategory = Omit<Category, 'workspaceId' | 'subcategories'> & {
  workspaceId?: string | null;
  subcategories?: PersistedSubcategory[];
};

export type PersistedSubcategory = Omit<Subcategory, 'workspaceId'> & {
  workspaceId?: string | null;
};

export type RuntimeCategory = Category & { subcategories: Subcategory[] };

export const effectiveCategoryWorkspaceId = (
  category: Pick<PersistedCategory, 'workspaceId'>
) => category.workspaceId || LEGACY_CATEGORY_WORKSPACE_ID;

export const normalizeRuntimeCategory = (category: PersistedCategory): RuntimeCategory => {
  const workspaceId = effectiveCategoryWorkspaceId(category);
  const defaultFlowType: Subcategory['flowType'] =
    category.type === 'income' ? 'Income' : 'Expense';

  return {
    ...category,
    workspaceId,
    isActive: category.isActive !== false,
    subcategories: (category.subcategories || []).map((subcategory) => ({
      ...subcategory,
      workspaceId: subcategory.workspaceId || workspaceId,
      categoryId: category.id,
      isActive: subcategory.isActive !== false,
      flowType: subcategory.flowType ?? defaultFlowType,
    })),
  } as RuntimeCategory;
};

export const categoryBelongsToWorkspace = (
  category: Pick<PersistedCategory, 'workspaceId'>,
  workspaceId: string
) => effectiveCategoryWorkspaceId(category) === workspaceId;

export const validateCategorySelection = (
  categories: RuntimeCategory[],
  workspaceId: string,
  categoryId?: string,
  subcategoryId?: string
): void => {
  if (!categoryId && !subcategoryId) return;
  if (!categoryId) throw new Error('A subcategory requires a category.');
  const category = categories.find((candidate) => candidate.id === categoryId);
  if (!category || category.workspaceId !== workspaceId) {
    throw new Error('Category not found in the selected workspace.');
  }
  if (subcategoryId) {
    const subcategory = category.subcategories.find((candidate) => candidate.id === subcategoryId);
    if (
      !subcategory ||
      subcategory.categoryId !== category.id ||
      subcategory.workspaceId !== workspaceId
    ) {
      throw new Error('Subcategory does not belong to the selected category and workspace.');
    }
  }
};
