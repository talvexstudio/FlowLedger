import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearAllPersistedViewState,
  clearPersistedViewState,
  clearWorkspaceViewState,
  getViewStateStorageKey,
  persistViewState,
  readPersistedViewState,
  VIEW_STATE_VERSION,
  type ViewStateStorage,
} from './view-state';

class MemoryStorage implements ViewStateStorage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}

const isExampleState = (value: unknown): value is { page: number } =>
  Boolean(value)
  && typeof value === 'object'
  && Number.isInteger((value as { page?: number }).page);

test('missing state returns defaults and valid versioned state restores', () => {
  const storage = new MemoryStorage();
  const key = getViewStateStorageKey('transactions', 'ws1');
  assert.deepEqual(readPersistedViewState(storage, key, { page: 1 }, isExampleState), { page: 1 });

  persistViewState(storage, key, { page: 4 });
  assert.deepEqual(readPersistedViewState(storage, key, { page: 1 }, isExampleState), { page: 4 });
});

test('malformed JSON and unsupported versions are safely ignored', () => {
  const storage = new MemoryStorage();
  const key = getViewStateStorageKey('dashboard', 'ws1');
  storage.setItem(key, '{broken');
  assert.deepEqual(readPersistedViewState(storage, key, { page: 1 }, isExampleState), { page: 1 });

  storage.setItem(key, JSON.stringify({ version: VIEW_STATE_VERSION + 1, state: { page: 9 } }));
  assert.deepEqual(readPersistedViewState(storage, key, { page: 1 }, isExampleState), { page: 1 });
});

test('workspace-scoped keys isolate view state', () => {
  const storage = new MemoryStorage();
  const personal = getViewStateStorageKey('transactions', 'ws-personal');
  const business = getViewStateStorageKey('transactions', 'ws-business');
  assert.equal(personal, 'flowledger:view:transactions:ws-personal');
  assert.equal(getViewStateStorageKey('settings'), 'flowledger:view:settings');
  persistViewState(storage, personal, { page: 2 });
  persistViewState(storage, business, { page: 7 });

  assert.deepEqual(readPersistedViewState(storage, personal, { page: 1 }, isExampleState), { page: 2 });
  assert.deepEqual(readPersistedViewState(storage, business, { page: 1 }, isExampleState), { page: 7 });
});

test('individual, workspace, and factory-reset clearing remove only intended view keys', () => {
  const storage = new MemoryStorage();
  const ws1Transactions = getViewStateStorageKey('transactions', 'ws1');
  const ws1Dashboard = getViewStateStorageKey('dashboard', 'ws1');
  const ws2Transactions = getViewStateStorageKey('transactions', 'ws2');
  const settings = getViewStateStorageKey('settings');
  [ws1Transactions, ws1Dashboard, ws2Transactions, settings].forEach((key) =>
    persistViewState(storage, key, { page: 2 })
  );
  storage.setItem('flowledger:selectedWorkspaceId', 'ws1');

  clearPersistedViewState(storage, ws1Transactions);
  assert.equal(storage.getItem(ws1Transactions), null);
  clearWorkspaceViewState(storage, 'ws1');
  assert.equal(storage.getItem(ws1Dashboard), null);
  assert.notEqual(storage.getItem(ws2Transactions), null);

  clearAllPersistedViewState(storage);
  assert.equal(storage.getItem(ws2Transactions), null);
  assert.equal(storage.getItem(settings), null);
  assert.equal(storage.getItem('flowledger:selectedWorkspaceId'), 'ws1');
});

test('unavailable or throwing storage never crashes view-state operations', () => {
  const unavailable: ViewStateStorage = {
    get length(): number { throw new Error('blocked'); },
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
    key() { throw new Error('blocked'); },
  };
  const key = getViewStateStorageKey('settings');
  assert.deepEqual(readPersistedViewState(null, key, { page: 1 }, isExampleState), { page: 1 });
  assert.deepEqual(readPersistedViewState(unavailable, key, { page: 1 }, isExampleState), { page: 1 });
  assert.doesNotThrow(() => persistViewState(unavailable, key, { page: 2 }));
  assert.doesNotThrow(() => clearAllPersistedViewState(unavailable));
});
