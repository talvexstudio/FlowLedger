import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Map Firestore-style collection paths to flat JSON file names
const resolveFile = (collPath: string): { file: string; workspaceId?: string } => {
  const parts = collPath.split('/');
  if (parts.length === 1) {
    return { file: parts[0] };
  }
  if (parts.length === 3 && parts[0] === 'workspaces') {
    const nameMap: Record<string, string> = {
      accounts: 'accounts',
      transactions: 'transactions',
      rules: 'rules',
      imports: 'imports',
      importTemplates: 'import-templates',
    };
    return {
      file: nameMap[parts[2]] ?? parts[2],
      workspaceId: parts[1],
    };
  }
  return { file: parts[parts.length - 1] };
};

const readFile = (file: string): any[] => {
  const filePath = path.join(DATA_DIR, `${file}.json`);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
};

const writeFile = (file: string, data: any[]) => {
  const filePath = path.join(DATA_DIR, `${file}.json`);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
};

const newId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const now = () => new Date().toISOString();

export const jsonStore = {
  collection: (collPath: string) => {
    const { file, workspaceId } = resolveFile(collPath);

    const getFiltered = () => {
      const all = readFile(file);
      return workspaceId ? all.filter((d) => d.workspaceId === workspaceId) : all;
    };

    return {
      get: async () => {
        const docs = getFiltered();
        return { docs: docs.map((doc) => ({ id: doc.id, data: () => doc })) };
      },

      doc: (id: string) => ({
        get: async () => {
          const all = readFile(file);
          const doc = all.find((d) => d.id === id);
          return { exists: !!doc, data: () => doc };
        },
        set: async (incoming: any, options?: { merge: boolean }) => {
          const all = readFile(file);
          const idx = all.findIndex((d) => d.id === id);
          const base = workspaceId && !incoming.workspaceId ? { workspaceId } : {};
          const doc = { ...incoming, ...base, id, updatedAt: now() };
          if (idx > -1) {
            all[idx] = options?.merge ? { ...all[idx], ...doc } : doc;
          } else {
            all.push({ createdAt: now(), ...doc });
          }
          writeFile(file, all);
        },
        update: async (patch: any) => {
          const all = readFile(file);
          const idx = all.findIndex((d) => d.id === id);
          if (idx === -1) throw new Error(`Document ${id} not found in ${file}`);
          all[idx] = { ...all[idx], ...patch, updatedAt: now() };
          writeFile(file, all);
        },
        delete: async () => {
          const all = readFile(file);
          writeFile(file, all.filter((d) => d.id !== id));
        },
      }),

      add: async (incoming: any) => {
        const all = readFile(file);
        const id = newId(file.slice(0, 3));
        const base = workspaceId && !incoming.workspaceId ? { workspaceId } : {};
        const doc = { createdAt: now(), ...incoming, ...base, id, updatedAt: now() };
        all.push(doc);
        writeFile(file, all);
        return { id };
      },

      where: (field: string, op: '==' | 'array-contains', value: any) => ({
        get: async () => {
          const docs = getFiltered().filter((doc) => {
            if (op === '==') return doc[field] === value;
            return false;
          });
          return { docs: docs.map((doc) => ({ id: doc.id, data: () => doc })) };
        },
      }),
    };
  },

  findDoc: async (predicate: (doc: any) => boolean, collectionName: string) => {
    return readFile(collectionName).find(predicate) ?? null;
  },

  clearCollection: (collPath: string) => {
    const { file, workspaceId } = resolveFile(collPath);
    if (workspaceId) {
      const all = readFile(file);
      writeFile(file, all.filter((d) => d.workspaceId !== workspaceId));
    } else {
      writeFile(file, []);
    }
  },

  reset: () => {
    // No-op in production; data is persistent
  },
};
