import type { Transaction } from './types';

export const UNCATEGORIZED_SELECTION = '__uncategorized__';
export const NO_SUBCATEGORY_SELECTION = '__no_subcategory__';

export const categorySelectionPatch = (
  selection: string
): Pick<Partial<Transaction>, 'categoryId' | 'subcategoryId'> => selection === UNCATEGORIZED_SELECTION
  ? { categoryId: undefined, subcategoryId: undefined }
  : { categoryId: selection, subcategoryId: undefined };

export const subcategorySelectionPatch = (
  selection: string
): Pick<Partial<Transaction>, 'subcategoryId'> => ({
  subcategoryId: selection === NO_SUBCATEGORY_SELECTION ? undefined : selection,
});
