import type { Category, Subcategory } from './types';

type CategoryType = Category['type'];
type FlowType = NonNullable<Subcategory['flowType']>;

export type CategoryTemplateEntry = {
  key: string;
  name: string;
  type: CategoryType;
  order: number;
  flowType: FlowType;
  subcategories: readonly { key: string; name: string }[];
};

export const DEFAULT_CATEGORY_TEMPLATE: readonly CategoryTemplateEntry[] = [
  { key: 'housing', name: 'Housing', type: 'expense', order: 1, flowType: 'Expense', subcategories: [{ key: 'rent', name: 'Rent' }, { key: 'mortgage', name: 'Mortgage' }, { key: 'home_insurance', name: 'Home Insurance' }, { key: 'maintenance', name: 'Maintenance' }] },
  { key: 'groceries', name: 'Essential Groceries', type: 'expense', order: 2, flowType: 'Expense', subcategories: [{ key: 'supermarket', name: 'Supermarket' }, { key: 'local_market', name: 'Local Market' }, { key: 'butcher_fish', name: 'Butcher & Fish' }, { key: 'bakery', name: 'Bakery' }] },
  { key: 'restaurants', name: 'Restaurants & Cafes', type: 'expense', order: 3, flowType: 'Expense', subcategories: [{ key: 'restaurants', name: 'Restaurants' }, { key: 'cafes', name: 'Cafes' }, { key: 'take_away', name: 'Take-away' }, { key: 'delivery', name: 'Delivery' }] },
  { key: 'transport', name: 'Transport', type: 'expense', order: 4, flowType: 'Expense', subcategories: [{ key: 'fuel', name: 'Fuel' }, { key: 'public_transport', name: 'Public Transport' }, { key: 'taxi', name: 'Taxi & Ride-hailing' }, { key: 'car_repairs', name: 'Car Repairs' }] },
  { key: 'shopping', name: 'Shopping & Personal', type: 'expense', order: 5, flowType: 'Expense', subcategories: [{ key: 'clothing', name: 'Clothing & Shoes' }, { key: 'home_diy', name: 'Home & DIY' }, { key: 'electronics', name: 'Electronics' }, { key: 'gifts', name: 'Gifts' }] },
  { key: 'subscriptions', name: 'Subscriptions & Services', type: 'expense', order: 6, flowType: 'Expense', subcategories: [{ key: 'streaming', name: 'Streaming' }, { key: 'music', name: 'Music' }, { key: 'apps', name: 'Apps & Digital Services' }, { key: 'telecom', name: 'Telecom' }] },
  { key: 'education', name: 'Education', type: 'expense', order: 7, flowType: 'Expense', subcategories: [{ key: 'tuition', name: 'Tuition & Fees' }, { key: 'books_courses', name: 'Books & Courses' }, { key: 'student_supplies', name: 'Student Supplies' }] },
  { key: 'health', name: 'Health', type: 'expense', order: 8, flowType: 'Expense', subcategories: [{ key: 'medical', name: 'Medical Expenses' }, { key: 'prescriptions', name: 'Prescriptions' }, { key: 'dental', name: 'Dental' }, { key: 'eye_care', name: 'Eye Care' }, { key: 'therapy', name: 'Therapy' }] },
  { key: 'utilities', name: 'Utilities', type: 'expense', order: 9, flowType: 'Expense', subcategories: [{ key: 'electricity', name: 'Electricity' }, { key: 'water', name: 'Water' }, { key: 'gas', name: 'Gas' }, { key: 'internet', name: 'Internet' }] },
  { key: 'entertainment', name: 'Entertainment', type: 'expense', order: 10, flowType: 'Expense', subcategories: [{ key: 'movies_events', name: 'Movies & Events' }, { key: 'hobbies', name: 'Hobbies' }, { key: 'games', name: 'Games' }, { key: 'travel', name: 'Travel & Holidays' }] },
  { key: 'insurance', name: 'Insurance', type: 'expense', order: 11, flowType: 'Expense', subcategories: [{ key: 'health_ins', name: 'Health Insurance' }, { key: 'car_ins', name: 'Car Insurance' }, { key: 'home_ins', name: 'Home Insurance' }, { key: 'life_ins', name: 'Life Insurance' }] },
  { key: 'personal_care', name: 'Personal Care', type: 'expense', order: 12, flowType: 'Expense', subcategories: [{ key: 'haircut', name: 'Haircut & Beauty' }, { key: 'gym', name: 'Gym & Fitness' }, { key: 'spa', name: 'Spa & Wellness' }] },
  { key: 'childcare', name: 'Childcare', type: 'expense', order: 13, flowType: 'Expense', subcategories: [{ key: 'daycare', name: 'Daycare' }, { key: 'babysitter', name: 'Babysitter' }, { key: 'school_activities', name: 'School Activities' }] },
  { key: 'pet_care', name: 'Pet Care', type: 'expense', order: 14, flowType: 'Expense', subcategories: [{ key: 'pet_food', name: 'Pet Food' }, { key: 'vet', name: 'Vet' }, { key: 'pet_grooming', name: 'Pet Grooming' }] },
  { key: 'gifts_donations', name: 'Gifts & Donations', type: 'expense', order: 15, flowType: 'Expense', subcategories: [{ key: 'gifts_giving', name: 'Gifts' }, { key: 'charitable', name: 'Charitable Giving' }] },
  { key: 'income', name: 'Salary & Income', type: 'income', order: 16, flowType: 'Income', subcategories: [{ key: 'salary', name: 'Monthly Salary' }, { key: 'freelance', name: 'Freelance' }, { key: 'investment_income', name: 'Investment Returns' }, { key: 'other_income', name: 'Other Income' }] },
  { key: 'transfers', name: 'Internal Transfers', type: 'both', order: 17, flowType: 'Expense', subcategories: [{ key: 'transfers', name: 'Between Accounts' }] },
] as const;

export type CategoryTemplateIdFactory = {
  categoryId: (templateKey: string) => string;
  subcategoryId: (templateKey: string, categoryKey: string) => string;
};

const newRuntimeId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

const generatedIdFactory: CategoryTemplateIdFactory = {
  categoryId: () => `cat_${newRuntimeId()}`,
  subcategoryId: () => `sub_${newRuntimeId()}`,
};

export const CANONICAL_WS1_CATEGORY_ID_FACTORY: CategoryTemplateIdFactory = {
  categoryId: (key) => `cat_${key}`,
  subcategoryId: (key) => `sub_${key}`,
};

export const instantiateDefaultCategoryTemplate = (
  workspaceId: string,
  idFactory: CategoryTemplateIdFactory = generatedIdFactory
): (Category & { subcategories: Subcategory[] })[] => DEFAULT_CATEGORY_TEMPLATE.map((template) => {
  const categoryId = idFactory.categoryId(template.key);
  return {
    id: categoryId,
    workspaceId,
    name: template.name,
    type: template.type,
    order: template.order,
    // Legacy field retained only as seed provenance. It does not make the record immutable.
    isSystem: true,
    isActive: true,
    subcategories: template.subcategories.map((subcategory, index) => ({
      id: idFactory.subcategoryId(subcategory.key, template.key),
      workspaceId,
      categoryId,
      name: subcategory.name,
      order: index + 1,
      isSystem: true,
      isActive: true,
      flowType: template.flowType,
    })),
  };
});
