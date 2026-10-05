import {
  cloneDefaultSystemCategories,
  cloneDefaultWorkspaces,
  type PersistedRecord,
} from './default-data';
import { STORE_VALIDATORS, type StoreValidator } from './store-validation';

export const BACKUP_SCOPES = ['financial_activity', 'everything'] as const;
export type BackupScope = (typeof BACKUP_SCOPES)[number];

export const PERSISTED_STORE_KEYS = [
  'workspaces',
  'accounts',
  'categories',
  'imports',
  'importTemplates',
  'budgets',
  'rules',
  'transactions',
] as const;

export type PersistedStoreKey = (typeof PERSISTED_STORE_KEYS)[number];

export type PersistedStoreDefinition = {
  key: PersistedStoreKey;
  collectionName: string;
  filename: string;
  schemaVersion: 1;
  workspaceScoped: boolean;
  restoreOrder: number;
  dependencies: readonly PersistedStoreKey[];
  requiredInScopes: readonly BackupScope[];
  validate: StoreValidator;
  defaultInitializer?: () => PersistedRecord[];
};

export const PERSISTED_STORES: Record<PersistedStoreKey, PersistedStoreDefinition> = {
  workspaces: {
    key: 'workspaces', collectionName: 'workspaces', filename: 'workspaces.json', schemaVersion: 1,
    workspaceScoped: false, restoreOrder: 10, dependencies: [], requiredInScopes: ['financial_activity', 'everything'],
    validate: STORE_VALIDATORS.workspaces, defaultInitializer: cloneDefaultWorkspaces,
  },
  accounts: {
    key: 'accounts', collectionName: 'accounts', filename: 'accounts.json', schemaVersion: 1,
    workspaceScoped: true, restoreOrder: 30, dependencies: ['workspaces'], requiredInScopes: ['financial_activity', 'everything'],
    validate: STORE_VALIDATORS.accounts,
  },
  categories: {
    key: 'categories', collectionName: 'categories', filename: 'categories.json', schemaVersion: 1,
    workspaceScoped: false, restoreOrder: 20, dependencies: [], requiredInScopes: ['financial_activity', 'everything'],
    validate: STORE_VALIDATORS.categories, defaultInitializer: cloneDefaultSystemCategories,
  },
  imports: {
    key: 'imports', collectionName: 'imports', filename: 'imports.json', schemaVersion: 1,
    workspaceScoped: true, restoreOrder: 40, dependencies: ['workspaces', 'accounts'], requiredInScopes: ['financial_activity', 'everything'],
    validate: STORE_VALIDATORS.imports,
  },
  importTemplates: {
    key: 'importTemplates', collectionName: 'importTemplates', filename: 'import-templates.json', schemaVersion: 1,
    workspaceScoped: true, restoreOrder: 50, dependencies: ['workspaces', 'accounts'], requiredInScopes: ['everything'],
    validate: STORE_VALIDATORS.importTemplates,
  },
  budgets: {
    key: 'budgets', collectionName: 'budgets', filename: 'budgets.json', schemaVersion: 1,
    workspaceScoped: true, restoreOrder: 60, dependencies: ['workspaces', 'categories'], requiredInScopes: ['everything'],
    validate: STORE_VALIDATORS.budgets,
  },
  rules: {
    key: 'rules', collectionName: 'rules', filename: 'rules.json', schemaVersion: 1,
    workspaceScoped: true, restoreOrder: 70, dependencies: ['workspaces', 'accounts', 'categories'], requiredInScopes: ['everything'],
    validate: STORE_VALIDATORS.rules,
  },
  transactions: {
    key: 'transactions', collectionName: 'transactions', filename: 'transactions.json', schemaVersion: 1,
    workspaceScoped: true, restoreOrder: 80, dependencies: ['workspaces', 'accounts', 'categories', 'imports'], requiredInScopes: ['financial_activity', 'everything'],
    validate: STORE_VALIDATORS.transactions,
  },
};

export const BACKUP_SCOPE_STORES: Record<BackupScope, readonly PersistedStoreKey[]> = {
  financial_activity: ['workspaces', 'accounts', 'categories', 'imports', 'transactions'],
  everything: [...PERSISTED_STORE_KEYS],
};

export const isBackupScope = (value: unknown): value is BackupScope =>
  typeof value === 'string' && BACKUP_SCOPES.includes(value as BackupScope);

export const getStoreDefinitionByCollectionName = (collectionName: string) => {
  const definition = Object.values(PERSISTED_STORES).find(
    (store) => store.collectionName === collectionName || store.key === collectionName
  );
  if (!definition) throw new Error(`Unknown persisted collection: ${collectionName}`);
  return definition;
};
