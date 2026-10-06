import { canonicalizeStoreRecords } from './backup';
import { validateRestoreReferences } from './restore-validation';
import type { CompleteStoreSet } from './store-replacement';
import { PERSISTED_STORE_KEYS, PERSISTED_STORES } from './store-manifest';
import { readCanonicalStoreRecords } from '../services/json-store';

export const validateCompleteStoreSet = (data: CompleteStoreSet) => {
  for (const key of PERSISTED_STORE_KEYS) PERSISTED_STORES[key].validate(data[key]);
  validateRestoreReferences(data);
};

export const readCompleteStoreSet = (dataDirectory?: string): CompleteStoreSet => {
  const data = {} as CompleteStoreSet;
  for (const key of PERSISTED_STORE_KEYS) {
    const records = readCanonicalStoreRecords(key, { dataDirectory, allowMissing: false });
    PERSISTED_STORES[key].validate(records);
    data[key] = canonicalizeStoreRecords(records);
  }
  validateCompleteStoreSet(data);
  return data;
};
