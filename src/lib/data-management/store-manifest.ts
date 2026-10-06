import {
  cloneDefaultSystemCategories,
  cloneDefaultWorkspaces,
  type PersistedRecord,
} from './default-data';
import { STORE_VALIDATORS, type StoreValidator } from './store-validation';

export const BACKUP_SCOPES = ['activity', 'financial_data', 'everything'] as const;
export type BackupScope = (typeof BACKUP_SCOPES)[number];

export const LEGACY_RESTORE_SCOPE = 'financial_activity' as const;
export type LegacyRestoreScope = typeof LEGACY_RESTORE_SCOPE;
export type RestoreScope = BackupScope | LegacyRestoreScope;

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

export type DataScopeDefinition = {
  key: BackupScope;
  label: string;
  description: string;
  includedStores: readonly PersistedStoreKey[];
};

export const DATA_SCOPE_DEFINITIONS: Record<BackupScope, DataScopeDefinition> = {
  activity: {
    key: 'activity',
    label: 'Activity',
    description: 'Transactions and import history',
    includedStores: ['imports', 'transactions'],
  },
  financial_data: {
    key: 'financial_data',
    label: 'Financial Data',
    description: 'Accounts, categories, transactions, imports, import templates, budgets, and rules',
    includedStores: ['accounts', 'categories', 'imports', 'importTemplates', 'budgets', 'rules', 'transactions'],
  },
  everything: {
    key: 'everything',
    label: 'Everything',
    description: 'All FlowLedger data, including workspaces',
    includedStores: [...PERSISTED_STORE_KEYS],
  },
};

export const LEGACY_FINANCIAL_ACTIVITY_STORES = [
  'workspaces',
  'accounts',
  'categories',
  'imports',
  'transactions',
] as const satisfies readonly PersistedStoreKey[];

export const RESTORE_SCOPE_STORES: Record<RestoreScope, readonly PersistedStoreKey[]> = {
  activity: DATA_SCOPE_DEFINITIONS.activity.includedStores,
  financial_data: DATA_SCOPE_DEFINITIONS.financial_data.includedStores,
  everything: DATA_SCOPE_DEFINITIONS.everything.includedStores,
  financial_activity: LEGACY_FINANCIAL_ACTIVITY_STORES,
};

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
    workspaceScoped: false, restoreOrder: 10, dependencies: [], requiredInScopes: ['everything'],
    validate: STORE_VALIDATORS.workspaces, defaultInitializer: cloneDefaultWorkspaces,
  },
  accounts: {
    key: 'accounts', collectionName: 'accounts', filename: 'accounts.json', schemaVersion: 1,
    workspaceScoped: true, restoreOrder: 30, dependencies: ['workspaces'], requiredInScopes: ['financial_data', 'everything'],
    validate: STORE_VALIDATORS.accounts,
  },
  categories: {
    key: 'categories', collectionName: 'categories', filename: 'categories.json', schemaVersion: 1,
    workspaceScoped: false, restoreOrder: 20, dependencies: [], requiredInScopes: ['financial_data', 'everything'],
    validate: STORE_VALIDATORS.categories, defaultInitializer: cloneDefaultSystemCategories,
  },
  imports: {
    key: 'imports', collectionName: 'imports', filename: 'imports.json', schemaVersion: 1,
    workspaceScoped: true, restoreOrder: 40, dependencies: ['workspaces', 'accounts'], requiredInScopes: ['activity', 'financial_data', 'everything'],
    validate: STORE_VALIDATORS.imports,
  },
  importTemplates: {
    key: 'importTemplates', collectionName: 'importTemplates', filename: 'import-templates.json', schemaVersion: 1,
    workspaceScoped: true, restoreOrder: 50, dependencies: ['workspaces', 'accounts'], requiredInScopes: ['financial_data', 'everything'],
    validate: STORE_VALIDATORS.importTemplates,
  },
  budgets: {
    key: 'budgets', collectionName: 'budgets', filename: 'budgets.json', schemaVersion: 1,
    workspaceScoped: true, restoreOrder: 60, dependencies: ['workspaces', 'categories'], requiredInScopes: ['financial_data', 'everything'],
    validate: STORE_VALIDATORS.budgets,
  },
  rules: {
    key: 'rules', collectionName: 'rules', filename: 'rules.json', schemaVersion: 1,
    workspaceScoped: true, restoreOrder: 70, dependencies: ['workspaces', 'accounts', 'categories'], requiredInScopes: ['financial_data', 'everything'],
    validate: STORE_VALIDATORS.rules,
  },
  transactions: {
    key: 'transactions', collectionName: 'transactions', filename: 'transactions.json', schemaVersion: 1,
    workspaceScoped: true, restoreOrder: 80, dependencies: ['workspaces', 'accounts', 'categories', 'imports'], requiredInScopes: ['activity', 'financial_data', 'everything'],
    validate: STORE_VALIDATORS.transactions,
  },
};

export const BACKUP_SCOPE_STORES: Record<BackupScope, readonly PersistedStoreKey[]> = {
  activity: DATA_SCOPE_DEFINITIONS.activity.includedStores,
  financial_data: DATA_SCOPE_DEFINITIONS.financial_data.includedStores,
  everything: DATA_SCOPE_DEFINITIONS.everything.includedStores,
};

export const isBackupScope = (value: unknown): value is BackupScope =>
  typeof value === 'string' && BACKUP_SCOPES.includes(value as BackupScope);

export const isRestoreScope = (value: unknown): value is RestoreScope =>
  isBackupScope(value) || value === LEGACY_RESTORE_SCOPE;

export const getStoreDefinitionByCollectionName = (collectionName: string) => {
  const definition = Object.values(PERSISTED_STORES).find(
    (store) => store.collectionName === collectionName || store.key === collectionName
  );
  if (!definition) throw new Error(`Unknown persisted collection: ${collectionName}`);
  return definition;
};
