export const DEFAULT_DATA_VERSION = 1;

export type PersistedRecord = Record<string, unknown>;

export const DEFAULT_WORKSPACES: readonly PersistedRecord[] = [
  {
    id: 'ws1',
    name: 'My Finances',
    baseCurrency: 'EUR',
    ownerUserId: 'local',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
];

type CategoryType = 'expense' | 'income' | 'both';
type FlowType = 'Expense' | 'Income';

type SystemCategoryDefinition = {
  id: string;
  name: string;
  type: CategoryType;
  order: number;
  flowType: FlowType;
  subcategories: readonly (readonly [id: string, name: string])[];
};

const SYSTEM_CATEGORY_DEFINITIONS = [
  {
    id: 'cat_housing', name: 'Housing', type: 'expense', order: 1, flowType: 'Expense',
    subcategories: [['sub_rent', 'Rent'], ['sub_mortgage', 'Mortgage'], ['sub_home_insurance', 'Home Insurance'], ['sub_maintenance', 'Maintenance']],
  },
  {
    id: 'cat_groceries', name: 'Essential Groceries', type: 'expense', order: 2, flowType: 'Expense',
    subcategories: [['sub_supermarket', 'Supermarket'], ['sub_local_market', 'Local Market'], ['sub_butcher_fish', 'Butcher & Fish'], ['sub_bakery', 'Bakery']],
  },
  {
    id: 'cat_restaurants', name: 'Restaurants & Cafes', type: 'expense', order: 3, flowType: 'Expense',
    subcategories: [['sub_restaurants', 'Restaurants'], ['sub_cafes', 'Cafes'], ['sub_take_away', 'Take-away'], ['sub_delivery', 'Delivery']],
  },
  {
    id: 'cat_transport', name: 'Transport', type: 'expense', order: 4, flowType: 'Expense',
    subcategories: [['sub_fuel', 'Fuel'], ['sub_public_transport', 'Public Transport'], ['sub_taxi', 'Taxi & Ride-hailing'], ['sub_car_repairs', 'Car Repairs']],
  },
  {
    id: 'cat_shopping', name: 'Shopping & Personal', type: 'expense', order: 5, flowType: 'Expense',
    subcategories: [['sub_clothing', 'Clothing & Shoes'], ['sub_home_diy', 'Home & DIY'], ['sub_electronics', 'Electronics'], ['sub_gifts', 'Gifts']],
  },
  {
    id: 'cat_subscriptions', name: 'Subscriptions & Services', type: 'expense', order: 6, flowType: 'Expense',
    subcategories: [['sub_streaming', 'Streaming'], ['sub_music', 'Music'], ['sub_apps', 'Apps & Digital Services'], ['sub_telecom', 'Telecom']],
  },
  {
    id: 'cat_education', name: 'Education', type: 'expense', order: 7, flowType: 'Expense',
    subcategories: [['sub_tuition', 'Tuition & Fees'], ['sub_books_courses', 'Books & Courses'], ['sub_student_supplies', 'Student Supplies']],
  },
  {
    id: 'cat_health', name: 'Health', type: 'expense', order: 8, flowType: 'Expense',
    subcategories: [['sub_medical', 'Medical Expenses'], ['sub_prescriptions', 'Prescriptions'], ['sub_dental', 'Dental'], ['sub_eye_care', 'Eye Care'], ['sub_therapy', 'Therapy']],
  },
  {
    id: 'cat_utilities', name: 'Utilities', type: 'expense', order: 9, flowType: 'Expense',
    subcategories: [['sub_electricity', 'Electricity'], ['sub_water', 'Water'], ['sub_gas', 'Gas'], ['sub_internet', 'Internet']],
  },
  {
    id: 'cat_entertainment', name: 'Entertainment', type: 'expense', order: 10, flowType: 'Expense',
    subcategories: [['sub_movies_events', 'Movies & Events'], ['sub_hobbies', 'Hobbies'], ['sub_games', 'Games'], ['sub_travel', 'Travel & Holidays']],
  },
  {
    id: 'cat_insurance', name: 'Insurance', type: 'expense', order: 11, flowType: 'Expense',
    subcategories: [['sub_health_ins', 'Health Insurance'], ['sub_car_ins', 'Car Insurance'], ['sub_home_ins', 'Home Insurance'], ['sub_life_ins', 'Life Insurance']],
  },
  {
    id: 'cat_personal_care', name: 'Personal Care', type: 'expense', order: 12, flowType: 'Expense',
    subcategories: [['sub_haircut', 'Haircut & Beauty'], ['sub_gym', 'Gym & Fitness'], ['sub_spa', 'Spa & Wellness']],
  },
  {
    id: 'cat_childcare', name: 'Childcare', type: 'expense', order: 13, flowType: 'Expense',
    subcategories: [['sub_daycare', 'Daycare'], ['sub_babysitter', 'Babysitter'], ['sub_school_activities', 'School Activities']],
  },
  {
    id: 'cat_pet_care', name: 'Pet Care', type: 'expense', order: 14, flowType: 'Expense',
    subcategories: [['sub_pet_food', 'Pet Food'], ['sub_vet', 'Vet'], ['sub_pet_grooming', 'Pet Grooming']],
  },
  {
    id: 'cat_gifts_donations', name: 'Gifts & Donations', type: 'expense', order: 15, flowType: 'Expense',
    subcategories: [['sub_gifts_giving', 'Gifts'], ['sub_charitable', 'Charitable Giving']],
  },
  {
    id: 'cat_income', name: 'Salary & Income', type: 'income', order: 16, flowType: 'Income',
    subcategories: [['sub_salary', 'Monthly Salary'], ['sub_freelance', 'Freelance'], ['sub_investment_income', 'Investment Returns'], ['sub_other_income', 'Other Income']],
  },
  {
    id: 'cat_transfers', name: 'Internal Transfers', type: 'both', order: 17, flowType: 'Expense',
    subcategories: [['sub_transfers', 'Between Accounts']],
  },
] as const satisfies readonly SystemCategoryDefinition[];

export const DEFAULT_SYSTEM_CATEGORIES: readonly PersistedRecord[] =
  SYSTEM_CATEGORY_DEFINITIONS.map((category) => ({
    id: category.id,
    name: category.name,
    type: category.type,
    order: category.order,
    isSystem: true,
    isActive: true,
    subcategories: category.subcategories.map(([id, name], index) => ({
      id,
      categoryId: category.id,
      name,
      order: index + 1,
      isSystem: true,
      isActive: true,
      flowType: category.flowType,
    })),
  }));

export const cloneDefaultWorkspaces = (): PersistedRecord[] =>
  structuredClone(DEFAULT_WORKSPACES) as PersistedRecord[];

export const cloneDefaultSystemCategories = (): PersistedRecord[] =>
  structuredClone(DEFAULT_SYSTEM_CATEGORIES) as PersistedRecord[];
