import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { withDataLock } from '../data-management/data-lock';
import {
  getStoreDefinitionByCollectionName,
  PERSISTED_STORES,
  type PersistedStoreKey,
} from '../data-management/store-manifest';

type JsonDocument = Record<string, any>;

export class JsonStoreReadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'JsonStoreReadError';
  }
}

export const getDataDirectory = (override?: string) =>
  override ?? process.env.FLOWLEDGER_DATA_DIR ?? path.join(process.cwd(), 'data');

export const buildTemporaryFilePath = (targetPath: string) =>
  path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  );

export const readJsonArrayFile = (
  filePath: string,
  options: { allowMissing?: boolean } = {}
): JsonDocument[] => {
  if (!fs.existsSync(filePath)) {
    if (options.allowMissing !== false) return [];
    throw new JsonStoreReadError(`Required persisted store is missing: ${path.basename(filePath)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    throw new JsonStoreReadError(
      `Persisted store contains malformed JSON: ${path.basename(filePath)}`,
      { cause: error }
    );
  }

  if (!Array.isArray(parsed)) {
    throw new JsonStoreReadError(
      `Persisted store must contain a top-level array: ${path.basename(filePath)}`
    );
  }

  return parsed as JsonDocument[];
};

export const readCanonicalStoreRecords = (
  storeKey: PersistedStoreKey,
  options: { dataDirectory?: string; allowMissing?: boolean } = {}
) => {
  const definition = PERSISTED_STORES[storeKey];
  return readJsonArrayFile(
    path.join(getDataDirectory(options.dataDirectory), definition.filename),
    { allowMissing: options.allowMissing }
  );
};

const writeJsonArrayFile = (filePath: string, data: JsonDocument[]) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = buildTemporaryFilePath(filePath);

  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2), {
      encoding: 'utf-8',
      flag: 'wx',
    });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
};

const resolveStore = (collPath: string) => {
  const parts = collPath.split('/');
  const collectionName = parts.length === 3 && parts[0] === 'workspaces'
    ? parts[2]
    : parts[parts.length - 1];
  const definition = getStoreDefinitionByCollectionName(collectionName);
  return {
    definition,
    workspaceId: parts.length === 3 && parts[0] === 'workspaces' ? parts[1] : undefined,
  };
};

const newId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const now = () => new Date().toISOString();

export const createJsonStore = (options: { dataDirectory?: string } = {}) => {
  const dataDirectory = getDataDirectory(options.dataDirectory);
  fs.mkdirSync(dataDirectory, { recursive: true });

  const readStore = (storeKey: PersistedStoreKey) =>
    readCanonicalStoreRecords(storeKey, { dataDirectory, allowMissing: true });

  const writeStore = (storeKey: PersistedStoreKey, data: JsonDocument[]) =>
    writeJsonArrayFile(path.join(dataDirectory, PERSISTED_STORES[storeKey].filename), data);

  return {
    collection: (collPath: string) => {
      const { definition, workspaceId } = resolveStore(collPath);
      const storeKey = definition.key;

      const getFiltered = () => {
        const all = readStore(storeKey);
        return workspaceId ? all.filter((document) => document.workspaceId === workspaceId) : all;
      };

      return {
        get: async () => {
          const docs = getFiltered();
          return { docs: docs.map((document) => ({ id: document.id, data: () => document })) };
        },

        doc: (id: string) => ({
          get: async () => {
            const all = readStore(storeKey);
            const document = all.find((candidate) => candidate.id === id);
            return { exists: !!document, data: () => document };
          },
          set: async (incoming: JsonDocument, setOptions?: { merge: boolean }) =>
            withDataLock(() => {
              const all = readStore(storeKey);
              const index = all.findIndex((candidate) => candidate.id === id);
              const base = workspaceId && !incoming.workspaceId ? { workspaceId } : {};
              const document = { ...incoming, ...base, id, updatedAt: now() };
              if (index > -1) {
                all[index] = setOptions?.merge ? { ...all[index], ...document } : document;
              } else {
                all.push({ createdAt: now(), ...document });
              }
              writeStore(storeKey, all);
            }),
          update: async (patch: JsonDocument) =>
            withDataLock(() => {
              const all = readStore(storeKey);
              const index = all.findIndex((candidate) => candidate.id === id);
              if (index === -1) throw new Error(`Document ${id} not found in ${definition.filename}`);
              all[index] = { ...all[index], ...patch, updatedAt: now() };
              writeStore(storeKey, all);
            }),
          delete: async () =>
            withDataLock(() => {
              const all = readStore(storeKey);
              writeStore(storeKey, all.filter((document) => document.id !== id));
            }),
        }),

        add: async (incoming: JsonDocument) =>
          withDataLock(() => {
            const all = readStore(storeKey);
            const id = newId(definition.filename.slice(0, 3));
            const base = workspaceId && !incoming.workspaceId ? { workspaceId } : {};
            const document = { createdAt: now(), ...incoming, ...base, id, updatedAt: now() };
            all.push(document);
            writeStore(storeKey, all);
            return { id };
          }),

        where: (field: string, op: '==' | 'array-contains', value: any) => ({
          get: async () => {
            const docs = getFiltered().filter((document) => {
              if (op === '==') return document[field] === value;
              return false;
            });
            return { docs: docs.map((document) => ({ id: document.id, data: () => document })) };
          },
        }),
      };
    },

    findDoc: async (predicate: (document: JsonDocument) => boolean, collectionName: string) => {
      const definition = getStoreDefinitionByCollectionName(collectionName);
      return readStore(definition.key).find(predicate) ?? null;
    },

    clearCollection: async (collPath: string) =>
      withDataLock(() => {
        const { definition, workspaceId } = resolveStore(collPath);
        if (workspaceId) {
          const all = readStore(definition.key);
          writeStore(definition.key, all.filter((document) => document.workspaceId !== workspaceId));
        } else {
          writeStore(definition.key, []);
        }
      }),

    reset: () => {
      // No-op in production; data is persistent.
    },
  };
};

export const jsonStore = createJsonStore();
