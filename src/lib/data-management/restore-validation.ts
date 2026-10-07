import {
  calculateStoreChecksum,
  canonicalizeStoreRecords,
  type BackupRecord,
} from './backup';
import { RestoreError } from './restore-errors';
import {
  DATA_SCOPE_DEFINITIONS,
  isRestoreScope,
  LEGACY_RESTORE_SCOPE,
  PERSISTED_STORE_KEYS,
  PERSISTED_STORES,
  RESTORE_SCOPE_STORES,
  type PersistedStoreKey,
  type RestoreScope,
} from './store-manifest';
import { BACKUP_FORMAT_VERSION } from './version';
import { isWorkspaceOwnedRecord } from './workspace-scope';

type UnknownRecord = Record<string, unknown>;

export type ValidatedRestoreBackup = {
  backupFormatVersion: number;
  flowLedgerVersion: string;
  minimumCompatibleFlowLedgerVersion?: string;
  createdAt: string;
  scope: RestoreScope;
  workspaceIds: string[];
  workspaceSelection: {
    mode: 'all';
    ids: string[];
  } | {
    mode: 'selected';
    ids: [string];
    sourceWorkspaceId: string;
    sourceWorkspaceName: string;
    sourceWorkspaceBaseCurrency: string;
  };
  isLegacyGlobal: boolean;
  includedStores: PersistedStoreKey[];
  data: Record<PersistedStoreKey, BackupRecord[]>;
};

export type RestorePreview = {
  createdAt: string;
  flowLedgerVersion: string;
  scope: RestoreScope;
  scopeLabel: string;
  isLegacy: boolean;
  workspaceCount: number;
  counts: Record<PersistedStoreKey, number>;
  includedStores: PersistedStoreKey[];
  replacementStores: PersistedStoreKey[];
  preservedStores: PersistedStoreKey[];
  storesToClear: PersistedStoreKey[];
  compatibilityStatus: 'compatible';
  validationResult: 'valid';
  workspaceStatus: 'not_applicable' | 'available' | 'missing';
  sourceWorkspaceId?: string;
  sourceWorkspaceName?: string;
  sourceWorkspaceBaseCurrency?: string;
  canRestore: boolean;
  canRecreateWorkspace: boolean;
  recreationBlockReason?: string;
};

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalid = (message: string): never => {
  throw new RestoreError('INVALID_BACKUP', message);
};

const requireString = (record: UnknownRecord, field: string): string => {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '') invalid(`Backup metadata ${field} is missing or invalid.`);
  return value as string;
};

const requireDate = (record: UnknownRecord, field: string) => {
  const value = requireString(record, field);
  if (Number.isNaN(Date.parse(value))) invalid(`Backup metadata ${field} is not a valid date.`);
  return value;
};

const equalMembers = (actual: readonly string[], expected: readonly string[]) =>
  actual.length === expected.length &&
  new Set(actual).size === actual.length &&
  expected.every((item) => actual.includes(item));

const requireStoreKeys = (value: unknown, field: string): PersistedStoreKey[] => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    invalid(`${field} must be an array of persisted store keys.`);
  }
  const keys = value as string[];
  if (!keys.every((key) => PERSISTED_STORE_KEYS.includes(key as PersistedStoreKey))) {
    invalid(`${field} contains an unknown store.`);
  }
  if (new Set(keys).size !== keys.length) invalid(`${field} contains duplicate stores.`);
  return keys as PersistedStoreKey[];
};

const recordId = (record: BackupRecord) => record.id as string;

const indexRecords = (storeKey: PersistedStoreKey, records: BackupRecord[]) => {
  const index = new Map<string, BackupRecord>();
  for (const record of records) {
    const id = recordId(record);
    if (index.has(id)) {
      throw new RestoreError('REFERENTIAL_INTEGRITY_FAILURE', `${storeKey} contains duplicate id ${id}.`);
    }
    index.set(id, record);
  }
  return index;
};

const optionalString = (record: BackupRecord, field: string) =>
  typeof record[field] === 'string' && record[field] !== '' ? record[field] as string : undefined;

const requireReference = (
  collection: Map<string, BackupRecord>,
  id: string | undefined,
  message: string
) => {
  if (id && !collection.has(id)) {
    throw new RestoreError('REFERENTIAL_INTEGRITY_FAILURE', message);
  }
};

const requireRequiredReference = (
  collection: Map<string, BackupRecord>,
  id: string | undefined,
  message: string
) => {
  if (!id || !collection.has(id)) {
    throw new RestoreError('REFERENTIAL_INTEGRITY_FAILURE', message);
  }
};

const validateCategoryReference = (
  record: BackupRecord,
  label: string,
  categories: Map<string, BackupRecord>,
  subcategoryParents: Map<string, { categoryId: string; workspaceId: string }>,
  workspaceId: string | undefined,
  categoryRequired = false
) => {
  const categoryId = optionalString(record, 'categoryId');
  const subcategoryId = optionalString(record, 'subcategoryId');
  if (categoryRequired && !categoryId) {
    throw new RestoreError(
      'REFERENTIAL_INTEGRITY_FAILURE',
      `${label} references a missing category.`
    );
  }
  requireReference(categories, categoryId, `${label} references a missing category.`);
  if (categoryId && effectiveCategoryWorkspaceId(categories.get(categoryId)!) !== workspaceId) {
    throw new RestoreError(
      'REFERENTIAL_INTEGRITY_FAILURE',
      `${label} category belongs to a different workspace.`
    );
  }
  if (subcategoryId) {
    const parent = subcategoryParents.get(subcategoryId);
    if (
      !categoryId ||
      parent?.categoryId !== categoryId ||
      parent?.workspaceId !== workspaceId
    ) {
      throw new RestoreError(
        'REFERENTIAL_INTEGRITY_FAILURE',
        `${label} has a subcategory that does not belong to its category.`
      );
    }
  }
};

const effectiveCategoryWorkspaceId = (category: BackupRecord) =>
  optionalString(category, 'workspaceId') ?? 'ws1';

const validateLinkedPair = (
  source: BackupRecord,
  counterpart: BackupRecord
) => {
  if (
    counterpart.linkedTransactionId !== source.id ||
    source.type !== 'InternalTransfer' ||
    counterpart.type !== 'InternalTransfer' ||
    source.isInternalTransfer !== true ||
    counterpart.isInternalTransfer !== true ||
    source.workspaceId !== counterpart.workspaceId ||
    source.accountId === counterpart.accountId ||
    source.destinationAccountId !== counterpart.accountId ||
    counterpart.destinationAccountId !== source.accountId ||
    !(
      (source.internalDirection === 'Out' && counterpart.internalDirection === 'In') ||
      (source.internalDirection === 'In' && counterpart.internalDirection === 'Out')
    ) ||
    (source.internalDirection === 'Out' && Number(source.amountBase) >= 0) ||
    (source.internalDirection === 'In' && Number(source.amountBase) <= 0) ||
    (counterpart.internalDirection === 'Out' && Number(counterpart.amountBase) >= 0) ||
    (counterpart.internalDirection === 'In' && Number(counterpart.amountBase) <= 0) ||
    Math.round(Number(source.amountBase) * 100) + Math.round(Number(counterpart.amountBase) * 100) !== 0
  ) {
    throw new RestoreError(
      'REFERENTIAL_INTEGRITY_FAILURE',
      'A linked InternalTransfer pair is not reciprocal and internally consistent.'
    );
  }
};

export const validateRestoreReferences = (
  data: Record<PersistedStoreKey, BackupRecord[]>
) => {
  const workspaces = indexRecords('workspaces', data.workspaces);
  const accounts = indexRecords('accounts', data.accounts);
  const categories = indexRecords('categories', data.categories);
  const imports = indexRecords('imports', data.imports);
  const importTemplates = indexRecords('importTemplates', data.importTemplates);
  const budgets = indexRecords('budgets', data.budgets);
  const rules = indexRecords('rules', data.rules);
  const transactions = indexRecords('transactions', data.transactions);
  void importTemplates;
  void rules;

  const subcategoryParents = new Map<string, { categoryId: string; workspaceId: string }>();
  for (const category of categories.values()) {
    const categoryId = recordId(category);
    const categoryWorkspaceId = effectiveCategoryWorkspaceId(category);
    requireReference(
      workspaces,
      categoryWorkspaceId,
      'A category references a missing workspace.'
    );
    for (const value of category.subcategories as BackupRecord[]) {
      const subcategoryId = recordId(value);
      const subcategoryWorkspaceId = optionalString(value, 'workspaceId') ?? categoryWorkspaceId;
      if (
        subcategoryParents.has(subcategoryId) ||
        value.categoryId !== categoryId ||
        subcategoryWorkspaceId !== categoryWorkspaceId
      ) {
        throw new RestoreError(
          'REFERENTIAL_INTEGRITY_FAILURE',
          'The category taxonomy contains an invalid or duplicate subcategory relationship.'
        );
      }
      subcategoryParents.set(subcategoryId, {
        categoryId,
        workspaceId: categoryWorkspaceId,
      });
    }
  }

  for (const account of accounts.values()) {
    requireRequiredReference(workspaces, optionalString(account, 'workspaceId'), 'An account references a missing workspace.');
  }

  for (const importSession of imports.values()) {
    const workspaceId = optionalString(importSession, 'workspaceId');
    const accountId = optionalString(importSession, 'accountId');
    requireRequiredReference(workspaces, workspaceId, 'An import references a missing workspace.');
    requireRequiredReference(accounts, accountId, 'An import references a missing account.');
    if (accountId && accounts.get(accountId)?.workspaceId !== workspaceId) {
      throw new RestoreError('REFERENTIAL_INTEGRITY_FAILURE', 'An import account belongs to a different workspace.');
    }
  }

  for (const template of data.importTemplates) {
    const workspaceId = optionalString(template, 'workspaceId');
    const accountId = optionalString(template, 'defaultAccountId');
    requireRequiredReference(workspaces, workspaceId, 'An import template references a missing workspace.');
    requireReference(accounts, accountId, 'An import template references a missing default account.');
    if (accountId && accounts.get(accountId)?.workspaceId !== workspaceId) {
      throw new RestoreError('REFERENTIAL_INTEGRITY_FAILURE', 'An import template account belongs to a different workspace.');
    }
  }

  for (const rule of data.rules) {
    const workspaceId = optionalString(rule, 'workspaceId');
    requireRequiredReference(workspaces, workspaceId, 'A rule references a missing workspace.');
    const match = rule.match as BackupRecord;
    const action = rule.action as BackupRecord;
    const accountId = optionalString(match, 'accountId');
    requireReference(accounts, accountId, 'A rule references a missing account.');
    if (accountId && accounts.get(accountId)?.workspaceId !== workspaceId) {
      throw new RestoreError('REFERENTIAL_INTEGRITY_FAILURE', 'A rule account belongs to a different workspace.');
    }
    validateCategoryReference(action, 'A rule', categories, subcategoryParents, workspaceId);
  }

  const budgetHeaders = new Map(
    data.budgets
      .filter((record) => record.recordType !== 'line')
      .map((record) => [recordId(record), record])
  );
  const budgetYears = new Set<string>();
  for (const budget of budgets.values()) {
    const workspaceId = optionalString(budget, 'workspaceId');
    requireRequiredReference(workspaces, workspaceId, 'A budget references a missing workspace.');
    if (budget.recordType === 'line') {
      const headerId = optionalString(budget, 'budgetId');
      requireRequiredReference(budgetHeaders, headerId, 'A budget line references a missing budget header.');
      if (headerId && budgetHeaders.get(headerId)?.workspaceId !== workspaceId) {
        throw new RestoreError('REFERENTIAL_INTEGRITY_FAILURE', 'A budget line belongs to a different workspace than its header.');
      }
      if (headerId && budgetHeaders.get(headerId)?.year !== budget.year) {
        throw new RestoreError('REFERENTIAL_INTEGRITY_FAILURE', 'A budget line year does not match its budget header.');
      }
      validateCategoryReference(budget, 'A budget line', categories, subcategoryParents, workspaceId, true);
    } else {
      const budgetYearKey = `${workspaceId ?? ''}:${String(budget.year)}`;
      if (budgetYears.has(budgetYearKey)) {
        throw new RestoreError(
          'REFERENTIAL_INTEGRITY_FAILURE',
          'More than one budget exists for the same workspace and year.'
        );
      }
      budgetYears.add(budgetYearKey);
    }
  }

  for (const transaction of transactions.values()) {
    const transactionId = recordId(transaction);
    const workspaceId = optionalString(transaction, 'workspaceId');
    const accountId = optionalString(transaction, 'accountId');
    const destinationAccountId = optionalString(transaction, 'destinationAccountId');
    const importId = optionalString(transaction, 'importId');
    const linkedTransactionId = optionalString(transaction, 'linkedTransactionId');

    requireRequiredReference(workspaces, workspaceId, 'A transaction references a missing workspace.');
    requireRequiredReference(accounts, accountId, 'A transaction references a missing account.');
    requireReference(accounts, destinationAccountId, 'A transaction references a missing counterpart account.');
    requireReference(imports, importId, 'A transaction references a missing import session.');
    requireReference(transactions, linkedTransactionId, 'A transaction references a missing linked transaction.');
    if (accountId && accounts.get(accountId)?.workspaceId !== workspaceId) {
      throw new RestoreError('REFERENTIAL_INTEGRITY_FAILURE', 'A transaction account belongs to a different workspace.');
    }
    if (destinationAccountId && accounts.get(destinationAccountId)?.workspaceId !== workspaceId) {
      throw new RestoreError('REFERENTIAL_INTEGRITY_FAILURE', 'A transaction counterpart belongs to a different workspace.');
    }
    if (destinationAccountId === accountId) {
      throw new RestoreError('REFERENTIAL_INTEGRITY_FAILURE', 'A transaction cannot use its own account as counterpart.');
    }
    if (importId && imports.get(importId)?.workspaceId !== workspaceId) {
      throw new RestoreError('REFERENTIAL_INTEGRITY_FAILURE', 'A transaction import belongs to a different workspace.');
    }
    validateCategoryReference(transaction, 'A transaction', categories, subcategoryParents, workspaceId);

    if (linkedTransactionId) {
      if (linkedTransactionId === transactionId) {
        throw new RestoreError('REFERENTIAL_INTEGRITY_FAILURE', 'A transaction cannot link to itself.');
      }
      validateLinkedPair(transaction, transactions.get(linkedTransactionId)!);
    }
  }
};

const collectWorkspaceIds = (data: Partial<Record<PersistedStoreKey, BackupRecord[]>>) => {
  const ids = new Set<string>();
  for (const workspace of data.workspaces ?? []) {
    if (typeof workspace.id === 'string') ids.add(workspace.id);
  }
  for (const records of Object.values(data)) {
    for (const record of records ?? []) {
      if (typeof record.workspaceId === 'string') ids.add(record.workspaceId);
    }
  }
  return [...ids].sort();
};

export const validateRestoreBackup = (input: unknown): ValidatedRestoreBackup => {
  const backup = isRecord(input)
    ? input
    : invalid('The backup must contain a top-level JSON object.');

  const formatVersion = backup.backupFormatVersion;
  if (!Number.isInteger(formatVersion)) invalid('backupFormatVersion is missing or invalid.');
  if ((formatVersion as number) > BACKUP_FORMAT_VERSION) {
    throw new RestoreError('UNSUPPORTED_VERSION', 'This backup uses a newer format. Update FlowLedger before restoring it.');
  }
  if ((formatVersion as number) < BACKUP_FORMAT_VERSION) {
    throw new RestoreError('UNSUPPORTED_VERSION', 'This older backup format has no supported restore migration.');
  }

  const flowLedgerVersion = requireString(backup, 'flowLedgerVersion');
  if (backup.minimumCompatibleFlowLedgerVersion !== undefined) {
    requireString(backup, 'minimumCompatibleFlowLedgerVersion');
  }
  const createdAt = requireDate(backup, 'createdAt');
  if (!isRestoreScope(backup.scope)) invalid('The backup scope is missing or unsupported.');
  const scope = backup.scope as RestoreScope;
  if (backup.containsSensitiveFinancialData !== true) {
    invalid('containsSensitiveFinancialData is missing or invalid.');
  }

  if (!isRecord(backup.workspaceSelection)) {
    invalid('workspaceSelection is missing or invalid.');
  }
  const workspaceSelection = backup.workspaceSelection as UnknownRecord;
  if (workspaceSelection.mode !== 'all' && workspaceSelection.mode !== 'selected') {
    invalid('workspaceSelection mode is invalid.');
  }
  if (
    !Array.isArray(workspaceSelection.ids) ||
    !workspaceSelection.ids.every((id) => typeof id === 'string' && id.trim() !== '') ||
    new Set(workspaceSelection.ids).size !== workspaceSelection.ids.length
  ) {
    invalid('workspaceSelection.ids is invalid.');
  }

  let validatedWorkspaceSelection: ValidatedRestoreBackup['workspaceSelection'];
  if (workspaceSelection.mode === 'selected') {
    if (scope === 'everything' || scope === LEGACY_RESTORE_SCOPE) {
      invalid('This backup scope cannot use a selected-workspace envelope.');
    }
    const sourceWorkspaceId = requireString(workspaceSelection, 'sourceWorkspaceId');
    const sourceWorkspaceName = requireString(workspaceSelection, 'sourceWorkspaceName');
    const sourceWorkspaceBaseCurrency = requireString(workspaceSelection, 'sourceWorkspaceBaseCurrency');
    const workspaceIds = workspaceSelection.ids as string[];
    if (
      workspaceIds.length !== 1 ||
      workspaceIds[0] !== sourceWorkspaceId
    ) {
      invalid('workspaceSelection.ids must identify the selected source workspace.');
    }
    validatedWorkspaceSelection = {
      mode: 'selected',
      ids: [sourceWorkspaceId],
      sourceWorkspaceId,
      sourceWorkspaceName,
      sourceWorkspaceBaseCurrency,
    };
  } else {
    validatedWorkspaceSelection = {
      mode: 'all',
      ids: [...workspaceSelection.ids as string[]],
    };
  }

  const expectedStores = [...RESTORE_SCOPE_STORES[scope]];
  const includedStores = requireStoreKeys(backup.includedStores, 'includedStores');
  if (!equalMembers(includedStores, expectedStores)) {
    invalid('includedStores does not exactly match the declared backup scope.');
  }

  if (!Array.isArray(backup.storeManifest)) invalid('storeManifest is missing or invalid.');
  if (!isRecord(backup.data)) invalid('The backup data payload is missing or invalid.');
  const storeManifest = backup.storeManifest as unknown[];
  const payload = backup.data as UnknownRecord;
  const dataKeys = requireStoreKeys(Object.keys(payload), 'data');
  if (!equalMembers(dataKeys, expectedStores)) invalid('The backup data stores do not match the declared scope.');

  const manifestKeys: PersistedStoreKey[] = [];
  const canonicalData = {} as Record<PersistedStoreKey, BackupRecord[]>;
  for (const key of PERSISTED_STORE_KEYS) canonicalData[key] = [];

  for (const value of storeManifest) {
    const entry = isRecord(value) ? value : invalid('storeManifest contains an invalid entry.');
    const key = entry.key;
    if (typeof key !== 'string' || !PERSISTED_STORE_KEYS.includes(key as PersistedStoreKey)) {
      invalid('storeManifest contains an unknown store.');
    }
    const storeKey = key as PersistedStoreKey;
    if (manifestKeys.includes(storeKey)) invalid('storeManifest contains duplicate stores.');
    manifestKeys.push(storeKey);
    const definition = PERSISTED_STORES[storeKey];
    if (entry.filename !== definition.filename) invalid(`storeManifest filename is invalid for ${storeKey}.`);
    if (entry.schemaVersion !== definition.schemaVersion) {
      throw new RestoreError(
        'UNSUPPORTED_STORE_SCHEMA',
        `The ${storeKey} store schema is not supported by this FlowLedger version.`
      );
    }
    if (!Number.isInteger(entry.recordCount) || (entry.recordCount as number) < 0) {
      invalid(`storeManifest recordCount is invalid for ${storeKey}.`);
    }
    if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      invalid(`storeManifest checksum is invalid for ${storeKey}.`);
    }

    const rawRecords = payload[storeKey];
    if (!Array.isArray(rawRecords)) invalid(`Backup data for ${storeKey} must be an array.`);
    const storeRecords = rawRecords as unknown[];
    try {
      definition.validate(storeRecords);
    } catch (error) {
      throw new RestoreError('INVALID_BACKUP', `Backup data for ${storeKey} failed validation.`, { cause: error });
    }
    const records = canonicalizeStoreRecords(storeRecords as UnknownRecord[]);
    if (records.length !== entry.recordCount) {
      throw new RestoreError('COUNT_MISMATCH', `The ${storeKey} record count does not match its manifest.`);
    }
    if (calculateStoreChecksum(records) !== entry.sha256) {
      throw new RestoreError('HASH_MISMATCH', `The ${storeKey} checksum does not match its manifest.`);
    }
    canonicalData[storeKey] = records;
  }

  if (!equalMembers(manifestKeys, expectedStores)) {
    invalid('storeManifest does not exactly match the declared backup scope.');
  }

  const representedWorkspaceIds = collectWorkspaceIds(canonicalData);
  const declaredWorkspaceIds = [...workspaceSelection.ids as string[]].sort();
  if (validatedWorkspaceSelection.mode === 'all') {
    if (!equalMembers(declaredWorkspaceIds, representedWorkspaceIds)) {
      invalid('workspaceSelection.ids does not match the workspaces represented in the backup.');
    }
  } else {
    const sourceWorkspaceId = validatedWorkspaceSelection.sourceWorkspaceId;
    if (representedWorkspaceIds.some((workspaceId) => workspaceId !== sourceWorkspaceId)) {
      invalid('The backup payload contains records from outside its selected workspace.');
    }
    for (const key of includedStores) {
      if (!canonicalData[key].every((record) => isWorkspaceOwnedRecord(key, record, sourceWorkspaceId))) {
        invalid(`Backup data for ${key} contains records from outside its selected workspace.`);
      }
    }
  }

  if (scope === 'everything' || scope === LEGACY_RESTORE_SCOPE) {
    validateRestoreReferences(canonicalData);
  } else if (validatedWorkspaceSelection.mode === 'selected' && scope === 'financial_data') {
    validateRestoreReferences({
      ...canonicalData,
      workspaces: [{
        id: validatedWorkspaceSelection.sourceWorkspaceId,
        ownerUserId: 'local',
        name: validatedWorkspaceSelection.sourceWorkspaceName,
        baseCurrency: validatedWorkspaceSelection.sourceWorkspaceBaseCurrency,
        createdAt,
        updatedAt: createdAt,
      }],
    });
  }

  return {
    backupFormatVersion: formatVersion as number,
    flowLedgerVersion,
    minimumCompatibleFlowLedgerVersion: backup.minimumCompatibleFlowLedgerVersion as string | undefined,
    createdAt,
    scope,
    workspaceIds: representedWorkspaceIds,
    workspaceSelection: validatedWorkspaceSelection,
    isLegacyGlobal: scope === LEGACY_RESTORE_SCOPE || (
      scope !== 'everything' && validatedWorkspaceSelection.mode === 'all'
    ),
    includedStores,
    data: canonicalData,
  };
};

export const parseAndValidateRestoreBackup = (json: string) => {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new RestoreError('INVALID_BACKUP', 'The selected file does not contain valid JSON.', { cause: error });
  }
  return validateRestoreBackup(value);
};

export const buildRestorePreview = (
  backup: ValidatedRestoreBackup,
  workspaceStatus: RestorePreview['workspaceStatus'] = backup.workspaceSelection.mode === 'selected'
    ? 'available'
    : 'not_applicable',
  recreation?: { canRecreateWorkspace: boolean; recreationBlockReason?: string }
): RestorePreview => ({
  createdAt: backup.createdAt,
  flowLedgerVersion: backup.flowLedgerVersion,
  scope: backup.scope,
  scopeLabel: backup.scope === LEGACY_RESTORE_SCOPE
    ? 'Legacy Financial activity'
    : backup.isLegacyGlobal
      ? `Legacy global ${DATA_SCOPE_DEFINITIONS[backup.scope].label}`
      : DATA_SCOPE_DEFINITIONS[backup.scope].label,
  isLegacy: backup.isLegacyGlobal,
  workspaceCount: backup.workspaceSelection.ids.length,
  counts: Object.fromEntries(
    PERSISTED_STORE_KEYS.map((key) => [key, backup.data[key].length])
  ) as Record<PersistedStoreKey, number>,
  includedStores: [...backup.includedStores],
  replacementStores: backup.scope === LEGACY_RESTORE_SCOPE
    ? [...PERSISTED_STORE_KEYS]
    : [...backup.includedStores],
  preservedStores: backup.scope === LEGACY_RESTORE_SCOPE
    ? []
    : PERSISTED_STORE_KEYS.filter((key) => !backup.includedStores.includes(key)),
  storesToClear: backup.scope === LEGACY_RESTORE_SCOPE
    ? PERSISTED_STORE_KEYS.filter((key) => !backup.includedStores.includes(key))
    : [],
  compatibilityStatus: 'compatible',
  validationResult: 'valid',
  workspaceStatus,
  ...(backup.workspaceSelection.mode === 'selected' ? {
    sourceWorkspaceId: backup.workspaceSelection.sourceWorkspaceId,
    sourceWorkspaceName: backup.workspaceSelection.sourceWorkspaceName,
    sourceWorkspaceBaseCurrency: backup.workspaceSelection.sourceWorkspaceBaseCurrency,
  } : {}),
  canRestore: workspaceStatus !== 'missing',
  canRecreateWorkspace: workspaceStatus === 'missing' && recreation?.canRecreateWorkspace === true,
  ...(recreation?.recreationBlockReason ? { recreationBlockReason: recreation.recreationBlockReason } : {}),
});
