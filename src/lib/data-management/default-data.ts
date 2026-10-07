import {
  CANONICAL_WS1_CATEGORY_ID_FACTORY,
  instantiateDefaultCategoryTemplate,
} from '../default-category-template';

export const DEFAULT_DATA_VERSION = 2;

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

// Canonical reset/bootstrap data uses stable legacy IDs so existing ws1 references
// remain deterministic. Arbitrary future workspaces must call
// instantiateDefaultCategoryTemplate(workspaceId) without this stable factory.
export const DEFAULT_BOOTSTRAP_CATEGORIES: readonly PersistedRecord[] =
  instantiateDefaultCategoryTemplate('ws1', CANONICAL_WS1_CATEGORY_ID_FACTORY) as PersistedRecord[];

// Compatibility aliases for existing backup/reset callers. "System" now means
// seeded provenance only; these runtime records are editable and workspace-owned.
export const DEFAULT_SYSTEM_CATEGORIES = DEFAULT_BOOTSTRAP_CATEGORIES;

export const cloneDefaultWorkspaces = (): PersistedRecord[] =>
  structuredClone(DEFAULT_WORKSPACES) as PersistedRecord[];

export const cloneDefaultBootstrapCategories = (): PersistedRecord[] =>
  structuredClone(DEFAULT_BOOTSTRAP_CATEGORIES) as PersistedRecord[];

export const cloneDefaultSystemCategories = cloneDefaultBootstrapCategories;
