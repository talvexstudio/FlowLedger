export const VIEW_STATE_STORAGE_PREFIX = 'flowledger:view:';
export const VIEW_STATE_VERSION = 1;

export type ViewStateScreen = 'transactions' | 'dashboard' | 'budget' | 'settings';

export type ViewStateStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>;

type ViewStateEnvelope<T> = {
  version: number;
  state: T;
};

export const getViewStateStorageKey = (
  screen: ViewStateScreen,
  workspaceId?: string | null
) => workspaceId
  ? `${VIEW_STATE_STORAGE_PREFIX}${screen}:${encodeURIComponent(workspaceId)}`
  : `${VIEW_STATE_STORAGE_PREFIX}${screen}`;

export const getBrowserViewStateStorage = (): ViewStateStorage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const readPersistedViewState = <T>(
  storage: ViewStateStorage | null,
  key: string,
  defaultValue: T,
  validate: (value: unknown) => value is T
): T => {
  if (!storage) return defaultValue;
  try {
    const raw = storage.getItem(key);
    if (!raw) return defaultValue;
    const parsed = JSON.parse(raw) as Partial<ViewStateEnvelope<unknown>>;
    if (parsed.version !== VIEW_STATE_VERSION || !validate(parsed.state)) return defaultValue;
    return parsed.state;
  } catch {
    return defaultValue;
  }
};

export const persistViewState = <T>(
  storage: ViewStateStorage | null,
  key: string,
  state: T
) => {
  if (!storage) return;
  try {
    const envelope: ViewStateEnvelope<T> = { version: VIEW_STATE_VERSION, state };
    storage.setItem(key, JSON.stringify(envelope));
  } catch {
    // The screen remains fully usable in memory when browser storage is unavailable.
  }
};

export const clearPersistedViewState = (
  storage: ViewStateStorage | null,
  key: string
) => {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Clearing a preference is best-effort when browser storage is unavailable.
  }
};

export const clearWorkspaceViewState = (
  storage: ViewStateStorage | null,
  workspaceId: string
) => {
  for (const screen of ['transactions', 'dashboard', 'budget'] as const) {
    clearPersistedViewState(storage, getViewStateStorageKey(screen, workspaceId));
  }
};

export const clearAllPersistedViewState = (storage: ViewStateStorage | null) => {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(VIEW_STATE_STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Factory reset still succeeds even if browser preferences cannot be cleared.
  }
};
