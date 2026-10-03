import type { Category, ClassificationRule, Subcategory } from './types';

export type EditableCategory = Category & { subcategories: Subcategory[] };

const categoryFields: (keyof Category)[] = [
  'name',
  'type',
  'order',
  'isSystem',
  'isActive',
  'isCustom',
];

const subcategoryFields: (keyof Subcategory)[] = [
  'name',
  'order',
  'isSystem',
  'isActive',
  'isCustom',
  'flowType',
];

const differs = <T extends object>(current: T, original: T | undefined, fields: (keyof T)[]) =>
  !original || fields.some(field => current[field] !== original[field]);

export const getCategoryChangeSet = (
  current: EditableCategory[],
  baseline: EditableCategory[]
) => {
  const baselineById = new Map(baseline.map(category => [category.id, category]));
  const categories: Category[] = [];
  const subcategories: { categoryId: string; data: Subcategory }[] = [];

  for (const category of current) {
    const original = baselineById.get(category.id);
    const { subcategories: currentSubcategories, ...categoryData } = category;

    if (differs(categoryData, original, categoryFields)) {
      categories.push(categoryData);
    }

    const originalSubcategories = new Map(
      (original?.subcategories ?? []).map(subcategory => [subcategory.id, subcategory])
    );
    for (const subcategory of currentSubcategories) {
      if (differs(subcategory, originalSubcategories.get(subcategory.id), subcategoryFields)) {
        subcategories.push({
          categoryId: category.id,
          data: { ...subcategory, categoryId: category.id },
        });
      }
    }
  }

  return { categories, subcategories };
};

export const getChangedRules = (
  current: ClassificationRule[],
  baseline: ClassificationRule[]
) => {
  const baselineById = new Map(baseline.map(rule => [rule.id, rule]));
  return current.filter(rule => {
    const original = baselineById.get(rule.id);
    return !original ||
      JSON.stringify(rule.match ?? {}) !== JSON.stringify(original.match ?? {}) ||
      JSON.stringify(rule.action ?? {}) !== JSON.stringify(original.action ?? {});
  });
};
