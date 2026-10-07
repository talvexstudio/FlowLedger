import type { Account, Transaction, Category, Subcategory, Workspace } from '@/lib/types';

export const mockWorkspaces: Workspace[] = [
  { id: 'ws1', name: 'Personal 2025', baseCurrency: 'EUR', ownerUserId: 'user1', createdAt: new Date(), updatedAt: new Date() },
  { id: 'ws2', name: 'Family', baseCurrency: 'USD', ownerUserId: 'user1', createdAt: new Date(), updatedAt: new Date() },
  { id: 'ws3', name: 'Side Business', baseCurrency: 'GBP', ownerUserId: 'user1', createdAt: new Date(), updatedAt: new Date() },
];

export const mockAccounts: Account[] = [
  { id: 'acc1', workspaceId: 'ws1', name: 'ActivoBank – Checking', type: 'bank', currency: 'EUR', institution: 'ActivoBank', openingBalance: 1000, archived: false, createdAt: new Date(), updatedAt: new Date() },
  { id: 'acc2', workspaceId: 'ws1', name: 'Revolut', type: 'fintech', currency: 'EUR', institution: 'Revolut', openingBalance: 500, archived: false, createdAt: new Date(), updatedAt: new Date() },
  { id: 'acc3', workspaceId: 'ws1', name: 'Visa Card', type: 'credit_card', currency: 'EUR', institution: 'Millennium BCP', openingBalance: 0, archived: false, createdAt: new Date(), updatedAt: new Date() },
];

const mockCategoryDefinitions: (Omit<Category, 'workspaceId'> & {
  subcategories: Omit<Subcategory, 'workspaceId'>[];
})[] = [
    {
        id: 'cat_housing', name: 'Housing', type: 'expense', order: 1, isSystem: true,
        subcategories: [
            { id: 'sub_rent', categoryId: 'cat_housing', name: 'Rent', order: 1, isSystem: true },
            { id: 'sub_mortgage', categoryId: 'cat_housing', name: 'Mortgage', order: 2, isSystem: true },
            { id: 'sub_home_insurance', categoryId: 'cat_housing', name: 'Home Insurance', order: 3, isSystem: true },
            { id: 'sub_maintenance', categoryId: 'cat_housing', name: 'Maintenance', order: 4, isSystem: true },
        ]
    },
    {
        id: 'cat_groceries', name: 'Essential Groceries', type: 'expense', order: 2, isSystem: true,
        subcategories: [
            { id: 'sub_supermarket', categoryId: 'cat_groceries', name: 'Supermarket', order: 1, isSystem: true },
            { id: 'sub_local_market', categoryId: 'cat_groceries', name: 'Local Market', order: 2, isSystem: true },
            { id: 'sub_butcher_fish', categoryId: 'cat_groceries', name: 'Butcher & Fish', order: 3, isSystem: true },
            { id: 'sub_bakery', categoryId: 'cat_groceries', name: 'Bakery', order: 4, isSystem: true },
        ]
    },
    {
        id: 'cat_restaurants', name: 'Restaurants & Cafes', type: 'expense', order: 3, isSystem: true,
        subcategories: [
            { id: 'sub_restaurants', categoryId: 'cat_restaurants', name: 'Restaurants', order: 1, isSystem: true },
            { id: 'sub_cafes', categoryId: 'cat_restaurants', name: 'Cafes', order: 2, isSystem: true },
            { id: 'sub_take_away', categoryId: 'cat_restaurants', name: 'Take-away', order: 3, isSystem: true },
            { id: 'sub_delivery', categoryId: 'cat_restaurants', name: 'Delivery', order: 4, isSystem: true },
        ]
    },
    {
        id: 'cat_transport', name: 'Transport', type: 'expense', order: 4, isSystem: true,
        subcategories: [
            { id: 'sub_fuel', categoryId: 'cat_transport', name: 'Fuel', order: 1, isSystem: true },
            { id: 'sub_public_transport', categoryId: 'cat_transport', name: 'Public Transport', order: 2, isSystem: true },
            { id: 'sub_taxi', categoryId: 'cat_transport', name: 'Taxi & Ride-hailing', order: 3, isSystem: true },
            { id: 'sub_car_repairs', categoryId: 'cat_transport', name: 'Car Repairs', order: 4, isSystem: true },
        ]
    },
     {
        id: 'cat_shopping', name: 'Shopping & Personal', type: 'expense', order: 5, isSystem: true,
        subcategories: [
            { id: 'sub_clothing', categoryId: 'cat_shopping', name: 'Clothing & Shoes', order: 1, isSystem: true },
            { id: 'sub_home_diy', categoryId: 'cat_shopping', name: 'Home & DIY', order: 2, isSystem: true },
            { id: 'sub_electronics', categoryId: 'cat_shopping', name: 'Electronics', order: 3, isSystem: true },
            { id: 'sub_gifts', categoryId: 'cat_shopping', name: 'Gifts', order: 4, isSystem: true },
        ]
    },
    {
        id: 'cat_subscriptions', name: 'Subscriptions & Services', type: 'expense', order: 6, isSystem: true,
        subcategories: [
            { id: 'sub_streaming', categoryId: 'cat_subscriptions', name: 'Streaming', order: 1, isSystem: true },
            { id: 'sub_music', categoryId: 'cat_subscriptions', name: 'Music', order: 2, isSystem: true },
            { id: 'sub_apps', categoryId: 'cat_subscriptions', name: 'Apps & Digital Services', order: 3, isSystem: true },
            { id: 'sub_telecom', categoryId: 'cat_subscriptions', name: 'Telecom', order: 4, isSystem: true },
        ]
    },
    {
        id: 'cat_income', name: 'Salary', type: 'income', order: 1, isSystem: true,
        subcategories: [
            { id: 'sub_salary', categoryId: 'cat_income', name: 'Monthly Salary', order: 1, isSystem: true },
        ]
    },
    {
        id: 'cat_transfers', name: 'Internal Transfers', type: 'both', order: 8, isSystem: true,
        subcategories: [
            { id: 'sub_transfers', categoryId: 'cat_transfers', name: 'Between Accounts', order: 1, isSystem: true },
        ]
    }
];

export const mockCategories: (Category & { subcategories: Subcategory[] })[] =
  mockCategoryDefinitions.map((category) => ({
    ...category,
    workspaceId: 'ws1',
    subcategories: category.subcategories.map((subcategory) => ({
      ...subcategory,
      workspaceId: 'ws1',
    })),
  }));

export const mockTransactions: Transaction[] = [
  {
    id: 'txn1', workspaceId: 'ws1', accountId: 'acc2', date: new Date('2024-07-20'),
    description: 'Netflix Subscription', rawDescription: 'NETFLIX.COM',
    amountOriginal: -9.99, currencyOriginal: 'EUR', amountBase: -9.99,
    type: 'Expense', categoryId: 'cat_subscriptions', subcategoryId: 'sub_streaming',
    needsReview: false, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false,
    createdAt: new Date(), updatedAt: new Date()
  },
  {
    id: 'txn2', workspaceId: 'ws1', accountId: 'acc1', date: new Date('2024-07-19'),
    description: 'Supermarket purchase', rawDescription: 'MERCADONA ONLINE',
    amountOriginal: -75.40, currencyOriginal: 'EUR', amountBase: -75.40,
    type: 'Expense', categoryId: 'cat_groceries', subcategoryId: 'sub_supermarket',
    needsReview: true, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false,
    createdAt: new Date(), updatedAt: new Date()
  },
  {
    id: 'txn3', workspaceId: 'ws1', accountId: 'acc1', date: new Date('2024-07-18'),
    description: 'Dinner with friends', rawDescription: 'UBER EATS',
    amountOriginal: -32.50, currencyOriginal: 'EUR', amountBase: -32.50,
    type: 'Expense', categoryId: 'cat_restaurants', subcategoryId: 'sub_delivery',
    needsReview: true, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false,
    createdAt: new Date(), updatedAt: new Date()
  },
  {
    id: 'txn4', workspaceId: 'ws1', accountId: 'acc1', date: new Date('2024-07-15'),
    description: 'Monthly Salary', rawDescription: 'SALARY TRANSFER ACME INC',
    amountOriginal: 3000, currencyOriginal: 'EUR', amountBase: 3000,
    type: 'Income', categoryId: 'cat_income', subcategoryId: 'sub_salary',
    needsReview: false, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false,
    createdAt: new Date(), updatedAt: new Date()
  },
    {
    id: 'txn5', workspaceId: 'ws1', accountId: 'acc3', date: new Date('2024-06-25'),
    description: 'New shoes', rawDescription: 'ZALANDO SE',
    amountOriginal: -120.00, currencyOriginal: 'EUR', amountBase: -120.00,
    type: 'Expense', categoryId: 'cat_shopping', subcategoryId: 'sub_clothing',
    needsReview: false, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false,
    createdAt: new Date(), updatedAt: new Date()
  },
  {
    id: 'txn6', workspaceId: 'ws1', accountId: 'acc2', date: new Date('2024-06-22'),
    description: 'Coffee', rawDescription: 'STARBUCKS',
    amountOriginal: -4.50, currencyOriginal: 'EUR', amountBase: -4.50,
    type: 'Expense', categoryId: 'cat_restaurants', subcategoryId: 'sub_cafes',
    needsReview: true, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false,
    createdAt: new Date(), updatedAt: new Date()
  },
  {
    id: 'txn7', workspaceId: 'ws1', accountId: 'acc1', date: new Date('2024-06-15'),
    description: 'Monthly Salary', rawDescription: 'SALARY TRANSFER ACME INC',
    amountOriginal: 3000, currencyOriginal: 'EUR', amountBase: 3000,
    type: 'Income', categoryId: 'cat_income', subcategoryId: 'sub_salary',
    needsReview: false, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false,
    createdAt: new Date(), updatedAt: new Date()
  },
  {
    id: 'txn8', workspaceId: 'ws1', accountId: 'acc2', date: new Date('2024-07-21'),
    description: 'Bolt Ride', rawDescription: 'BOLT.EU',
    amountOriginal: -8.70, currencyOriginal: 'EUR', amountBase: -8.70,
    type: 'Expense', categoryId: 'cat_transport', subcategoryId: 'sub_taxi',
    needsReview: true, isInternalTransfer: false, isPotentialDuplicate: false, isInconsistent: false,
    createdAt: new Date(), updatedAt: new Date()
  },
  {
    id: 'txn9', workspaceId: 'ws1', accountId: 'acc1', date: new Date('2024-07-22'),
    description: 'Transfer to Revolut', rawDescription: 'TRANSFER TO REV',
    amountOriginal: -200, currencyOriginal: 'EUR', amountBase: -200,
    type: 'InternalTransfer', categoryId: 'cat_transfers', subcategoryId: 'sub_transfers',
    needsReview: false, isInternalTransfer: true, isPotentialDuplicate: false, isInconsistent: false,
    createdAt: new Date(), updatedAt: new Date()
  },
  {
    id: 'txn10', workspaceId: 'ws1', accountId: 'acc2', date: new Date('2024-07-22'),
    description: 'Transfer from ActivoBank', rawDescription: 'TRANSFER FROM ACTB',
    amountOriginal: 200, currencyOriginal: 'EUR', amountBase: 200,
    type: 'InternalTransfer', categoryId: 'cat_transfers', subcategoryId: 'sub_transfers',
    needsReview: false, isInternalTransfer: true, isPotentialDuplicate: false, isInconsistent: false,
    createdAt: new Date(), updatedAt: new Date()
  },
];
