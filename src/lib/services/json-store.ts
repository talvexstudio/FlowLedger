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

export class JsonStoreWorkspaceError extends Error {
  constructor(message = 'The requested record does not belong to this workspace.') {
    super(message);
    this.name = 'JsonStoreWorkspaceError';
  }
}

export const getDataDirectory = (override?: string) =>
  override ?? process.env.FLOWLEDGER_DATA_DIR ?? path.join(process.cwd(), 'data');

export const buildTemporaryFilePath = (targetPath: string) =>
  path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  );

export const replaceFileAtomically = (sourcePath: string, targetPath: string) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(sourcePath, targetPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EACCES', 'EBUSY', 'EPERM'].includes(code ?? '') || attempt >= 5) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5 * (attempt + 1));
    }
  }
};

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

export const writeFileAtomically = (filePath: string, data: string | Buffer) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = buildTemporaryFilePath(filePath);

  try {
    fs.writeFileSync(temporaryPath, data, { flag: 'wx' });
    replaceFileAtomically(temporaryPath, filePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
};

const writeJsonArrayFile = (filePath: string, data: JsonDocument[]) =>
  writeFileAtomically(filePath, JSON.stringify(data, null, 2));

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

// Persisted IDs are globally unique across workspaces. workspaceId is still an
// ownership boundary and is checked independently for every scoped document operation.
const newId = (prefix: string) => `${prefix}_${randomUUID()}`;

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

      const matchingIndexes = (all: JsonDocument[], id: string) => all
        .map((document, index) => ({ document, index }))
        .filter(({ document }) => document.id === id);

      const findDocumentIndex = (all: JsonDocument[], id: string) => {
        const matches = matchingIndexes(all, id);
        const scopedMatches = workspaceId
          ? matches.filter(({ document }) => document.workspaceId === workspaceId)
          : matches;
        if (scopedMatches.length > 1) {
          throw new Error(`Persisted store contains duplicate id ${id} in ${definition.filename}`);
        }
        return scopedMatches[0]?.index ?? -1;
      };

      const assertWorkspacePayload = (incoming: JsonDocument) => {
        if (
          workspaceId &&
          incoming.workspaceId !== undefined &&
          incoming.workspaceId !== workspaceId
        ) {
          throw new JsonStoreWorkspaceError();
        }
      };

      const missingMutationError = (all: JsonDocument[], id: string) => {
        if (workspaceId && matchingIndexes(all, id).length > 0) {
          return new JsonStoreWorkspaceError();
        }
        return new Error(`Document ${id} not found in ${definition.filename}`);
      };

      return {
        get: async () => {
          const docs = getFiltered();
          return { docs: docs.map((document) => ({ id: document.id, data: () => document })) };
        },

        doc: (id: string) => ({
          get: async () => {
            const all = readStore(storeKey);
            const index = findDocumentIndex(all, id);
            const document = index >= 0 ? all[index] : undefined;
            return { exists: !!document, data: () => document };
          },
          set: async (incoming: JsonDocument, setOptions?: { merge: boolean }) =>
            withDataLock(() => {
              assertWorkspacePayload(incoming);
              const all = readStore(storeKey);
              const index = findDocumentIndex(all, id);
              if (index === -1 && matchingIndexes(all, id).length > 0) {
                throw new JsonStoreWorkspaceError(
                  'A record with this globally unique ID belongs to another workspace.'
                );
              }
              const base = workspaceId ? { workspaceId } : {};
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
              assertWorkspacePayload(patch);
              const all = readStore(storeKey);
              const index = findDocumentIndex(all, id);
              if (index === -1) throw missingMutationError(all, id);
              all[index] = {
                ...all[index],
                ...patch,
                ...(workspaceId ? { workspaceId } : {}),
                id,
                updatedAt: now(),
              };
              writeStore(storeKey, all);
            }),
          delete: async () =>
            withDataLock(() => {
              const all = readStore(storeKey);
              const index = findDocumentIndex(all, id);
              if (index === -1) throw missingMutationError(all, id);
              all.splice(index, 1);
              writeStore(storeKey, all);
            }),
        }),

        add: async (incoming: JsonDocument) =>
          withDataLock(() => {
            assertWorkspacePayload(incoming);
            const all = readStore(storeKey);
            let id = newId(definition.filename.slice(0, 3));
            while (matchingIndexes(all, id).length > 0) {
              id = newId(definition.filename.slice(0, 3));
            }
            const base = workspaceId ? { workspaceId } : {};
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
