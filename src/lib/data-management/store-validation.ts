import type { PersistedRecord } from './default-data';

export class StoreValidationError extends Error {
  constructor(storeKey: string, index: number, detail: string) {
    super(`Invalid ${storeKey} record at index ${index}: ${detail}`);
    this.name = 'StoreValidationError';
  }
}

const isRecord = (value: unknown): value is PersistedRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertRecord = (storeKey: string, value: unknown, index: number): PersistedRecord => {
  if (!isRecord(value)) throw new StoreValidationError(storeKey, index, 'expected an object');
  return value;
};

const assertString = (storeKey: string, record: PersistedRecord, index: number, field: string) => {
  if (typeof record[field] !== 'string' || record[field].trim() === '') {
    throw new StoreValidationError(storeKey, index, `${field} must be a non-empty string`);
  }
};

const assertNumber = (storeKey: string, record: PersistedRecord, index: number, field: string) => {
  if (typeof record[field] !== 'number' || !Number.isFinite(record[field])) {
    throw new StoreValidationError(storeKey, index, `${field} must be a finite number`);
  }
};

const assertBoolean = (storeKey: string, record: PersistedRecord, index: number, field: string) => {
  if (typeof record[field] !== 'boolean') {
    throw new StoreValidationError(storeKey, index, `${field} must be a boolean`);
  }
};

const assertOptionalBoolean = (
  storeKey: string,
  record: PersistedRecord,
  index: number,
  field: string
) => {
  if (record[field] !== undefined) assertBoolean(storeKey, record, index, field);
};

const assertEnum = (
  storeKey: string,
  record: PersistedRecord,
  index: number,
  field: string,
  values: readonly string[]
) => {
  if (typeof record[field] !== 'string' || !values.includes(record[field])) {
    throw new StoreValidationError(storeKey, index, `${field} has an unsupported value`);
  }
};

const assertDate = (storeKey: string, record: PersistedRecord, index: number, field: string) => {
  assertString(storeKey, record, index, field);
  if (Number.isNaN(Date.parse(record[field] as string))) {
    throw new StoreValidationError(storeKey, index, `${field} must be a valid date string`);
  }
};

const assertId = (storeKey: string, record: PersistedRecord, index: number) =>
  assertString(storeKey, record, index, 'id');

export type StoreValidator = (records: unknown[]) => void;

const validateEach = (
  storeKey: string,
  records: unknown[],
  validate: (record: PersistedRecord, index: number) => void
) => records.forEach((value, index) => validate(assertRecord(storeKey, value, index), index));

export const STORE_VALIDATORS = {
  workspaces: (records: unknown[]) => validateEach('workspaces', records, (record, index) => {
    assertId('workspaces', record, index);
    assertString('workspaces', record, index, 'ownerUserId');
    assertString('workspaces', record, index, 'name');
    assertString('workspaces', record, index, 'baseCurrency');
    assertDate('workspaces', record, index, 'createdAt');
    assertDate('workspaces', record, index, 'updatedAt');
  }),
  accounts: (records: unknown[]) => validateEach('accounts', records, (record, index) => {
    assertId('accounts', record, index);
    assertString('accounts', record, index, 'workspaceId');
    assertString('accounts', record, index, 'name');
    assertEnum('accounts', record, index, 'type', ['bank', 'credit_card', 'fintech', 'cash', 'investment', 'other']);
    assertString('accounts', record, index, 'currency');
    assertString('accounts', record, index, 'institution');
    assertNumber('accounts', record, index, 'openingBalance');
    assertBoolean('accounts', record, index, 'archived');
  }),
  categories: (records: unknown[]) => validateEach('categories', records, (record, index) => {
    assertId('categories', record, index);
    assertString('categories', record, index, 'name');
    assertEnum('categories', record, index, 'type', ['expense', 'income', 'both']);
    assertNumber('categories', record, index, 'order');
    assertBoolean('categories', record, index, 'isSystem');
    if (!Array.isArray(record.subcategories)) {
      throw new StoreValidationError('categories', index, 'subcategories must be an array');
    }
    record.subcategories.forEach((value, subIndex) => {
      const sub = assertRecord('categories.subcategories', value, subIndex);
      assertId('categories.subcategories', sub, subIndex);
      assertString('categories.subcategories', sub, subIndex, 'categoryId');
      assertString('categories.subcategories', sub, subIndex, 'name');
      assertNumber('categories.subcategories', sub, subIndex, 'order');
      assertBoolean('categories.subcategories', sub, subIndex, 'isSystem');
    });
  }),
  imports: (records: unknown[]) => validateEach('imports', records, (record, index) => {
    assertId('imports', record, index);
    assertString('imports', record, index, 'workspaceId');
    assertString('imports', record, index, 'accountId');
    assertString('imports', record, index, 'fileName');
    assertEnum('imports', record, index, 'sourceType', ['CSV', 'XLSX', 'PDF']);
    assertString('imports', record, index, 'template');
    assertNumber('imports', record, index, 'transactionCount');
    assertDate('imports', record, index, 'createdAt');
  }),
  importTemplates: (records: unknown[]) => validateEach('importTemplates', records, (record, index) => {
    assertId('importTemplates', record, index);
    assertString('importTemplates', record, index, 'workspaceId');
    assertString('importTemplates', record, index, 'name');
    assertEnum('importTemplates', record, index, 'sourceType', ['CSV', 'XLSX']);
    if (!Array.isArray(record.headerSignature) || !record.headerSignature.every((item) => typeof item === 'string')) {
      throw new StoreValidationError('importTemplates', index, 'headerSignature must be a string array');
    }
    if (!isRecord(record.mapping)) {
      throw new StoreValidationError('importTemplates', index, 'mapping must be an object');
    }
    assertDate('importTemplates', record, index, 'createdAt');
  }),
  budgets: (records: unknown[]) => validateEach('budgets', records, (record, index) => {
    assertId('budgets', record, index);
    assertString('budgets', record, index, 'workspaceId');
    assertNumber('budgets', record, index, 'year');
    if (record.recordType === 'line') {
      assertString('budgets', record, index, 'budgetId');
      assertString('budgets', record, index, 'categoryId');
      assertEnum('budgets', record, index, 'type', ['Expense', 'Income']);
    } else {
      assertNumber('budgets', record, index, 'createdFromSampleMonths');
      assertString('budgets', record, index, 'samplePeriodFrom');
      assertString('budgets', record, index, 'samplePeriodTo');
      assertDate('budgets', record, index, 'createdAt');
    }
  }),
  rules: (records: unknown[]) => validateEach('rules', records, (record, index) => {
    assertId('rules', record, index);
    assertString('rules', record, index, 'workspaceId');
    if (!isRecord(record.match)) throw new StoreValidationError('rules', index, 'match must be an object');
    if (!isRecord(record.action)) throw new StoreValidationError('rules', index, 'action must be an object');
    assertDate('rules', record, index, 'createdAt');
  }),
  transactions: (records: unknown[]) => validateEach('transactions', records, (record, index) => {
    assertId('transactions', record, index);
    assertString('transactions', record, index, 'workspaceId');
    assertString('transactions', record, index, 'accountId');
    assertDate('transactions', record, index, 'date');
    assertString('transactions', record, index, 'description');
    assertNumber('transactions', record, index, 'amountOriginal');
    assertString('transactions', record, index, 'currencyOriginal');
    assertNumber('transactions', record, index, 'amountBase');
    assertEnum('transactions', record, index, 'type', ['Expense', 'Income', 'InternalTransfer', 'Adjustment']);
    assertBoolean('transactions', record, index, 'needsReview');
    assertBoolean('transactions', record, index, 'isInternalTransfer');
    assertOptionalBoolean('transactions', record, index, 'isPotentialDuplicate');
    assertOptionalBoolean('transactions', record, index, 'isInconsistent');
  }),
} satisfies Record<string, StoreValidator>;
