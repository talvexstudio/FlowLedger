import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_WORKSPACES } from './data-management/default-data';
import {
  getWorkspaceSelectorLabel,
  initializeWorkspaceSelection,
  persistWorkspaceId,
  readPersistedWorkspaceId,
  SELECTED_WORKSPACE_STORAGE_KEY,
  type WorkspaceSelectionStorage,
} from './workspace-selection';

const workspaces = [
  { id: 'ws-a', name: 'Personal' },
  { id: 'ws-b', name: 'Business' },
];

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  const writes: Array<{ type: 'set' | 'remove'; key: string; value?: string }> = [];
  const storage: WorkspaceSelectionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
      writes.push({ type: 'set', key, value });
    },
    removeItem: (key) => {
      values.delete(key);
      writes.push({ type: 'remove', key });
    },
  };
  return { storage, values, writes };
};

test('a persisted valid workspace ID is restored', () => {
  const memory = memoryStorage({ [SELECTED_WORKSPACE_STORAGE_KEY]: 'ws-b' });
  assert.equal(initializeWorkspaceSelection(workspaces, memory.storage), 'ws-b');
  assert.equal(readPersistedWorkspaceId(memory.storage), 'ws-b');
});

test('a missing persisted workspace falls back to the first and writes the fallback', () => {
  const memory = memoryStorage({ [SELECTED_WORKSPACE_STORAGE_KEY]: 'missing' });
  assert.equal(initializeWorkspaceSelection(workspaces, memory.storage), 'ws-a');
  assert.equal(memory.values.get(SELECTED_WORKSPACE_STORAGE_KEY), 'ws-a');
});

test('no persisted workspace falls back to and persists the first workspace', () => {
  const memory = memoryStorage();
  assert.equal(initializeWorkspaceSelection(workspaces, memory.storage), 'ws-a');
  assert.deepEqual(memory.writes, [{
    type: 'set', key: SELECTED_WORKSPACE_STORAGE_KEY, value: 'ws-a',
  }]);
});

test('a user selection persists and is restored on reinitialization', () => {
  const memory = memoryStorage();
  persistWorkspaceId(memory.storage, 'ws-b');
  assert.equal(initializeWorkspaceSelection(workspaces, memory.storage), 'ws-b');
});

test('an empty workspace list produces null and removes stale persisted selection', () => {
  const memory = memoryStorage({ [SELECTED_WORKSPACE_STORAGE_KEY]: 'ws1' });
  assert.equal(initializeWorkspaceSelection([], memory.storage), null);
  assert.equal(readPersistedWorkspaceId(memory.storage), null);
  assert.equal(memory.writes.at(-1)?.type, 'remove');
});

test('a single workspace is selected and shown correctly', () => {
  const memory = memoryStorage();
  const single = [{ id: 'only', name: 'Only workspace' }];
  const selected = initializeWorkspaceSelection(single, memory.storage);
  assert.equal(selected, 'only');
  assert.equal(getWorkspaceSelectorLabel(single, selected, false), 'Only workspace');
});

test('the selector uses neutral loading and empty labels without a fake workspace', () => {
  assert.equal(getWorkspaceSelectorLabel([], null, true), 'Loading workspace…');
  assert.equal(getWorkspaceSelectorLabel([], null, false), 'No workspace');
});

test('selection persistence only writes the namespaced browser preference', () => {
  const memory = memoryStorage();
  persistWorkspaceId(memory.storage, 'ws-b');
  assert.deepEqual(memory.writes, [{
    type: 'set', key: 'flowledger:selectedWorkspaceId', value: 'ws-b',
  }]);
});

test('the canonical bootstrap workspace remains ws1', () => {
  assert.equal(DEFAULT_WORKSPACES.length, 1);
  assert.equal(DEFAULT_WORKSPACES[0].id, 'ws1');
  assert.equal(DEFAULT_WORKSPACES[0].name, 'My Finances');
});
