'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clearPersistedViewState,
  getBrowserViewStateStorage,
  persistViewState,
  readPersistedViewState,
} from '@/lib/view-state';

type PersistedEntry<T> = {
  key: string | null;
  value: T;
};

export function usePersistedViewState<T>(
  storageKey: string | null,
  defaultValue: T,
  validate: (value: unknown) => value is T
) {
  const defaultRef = useRef(defaultValue);
  const validateRef = useRef(validate);
  const skipNextWriteRef = useRef(false);
  defaultRef.current = defaultValue;
  validateRef.current = validate;

  const [entry, setEntry] = useState<PersistedEntry<T>>({
    key: null,
    value: defaultValue,
  });

  useEffect(() => {
    if (!storageKey) return;
    const restored = readPersistedViewState(
      getBrowserViewStateStorage(),
      storageKey,
      defaultRef.current,
      validateRef.current
    );
    setEntry((current) => current.key === storageKey
      ? current
      : { key: storageKey, value: restored });
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || entry.key !== storageKey) return;
    if (skipNextWriteRef.current) {
      skipNextWriteRef.current = false;
      return;
    }
    persistViewState(getBrowserViewStateStorage(), storageKey, entry.value);
  }, [entry, storageKey]);

  const value = entry.key === storageKey ? entry.value : defaultValue;
  const restored = Boolean(storageKey && entry.key === storageKey);

  const setValue = useCallback<React.Dispatch<React.SetStateAction<T>>>((update) => {
    if (!storageKey) return;
    setEntry((current) => {
      const currentValue = current.key === storageKey ? current.value : defaultRef.current;
      const nextValue = typeof update === 'function'
        ? (update as (previous: T) => T)(currentValue)
        : update;
      return { key: storageKey, value: nextValue };
    });
  }, [storageKey]);

  const clear = useCallback(() => {
    if (!storageKey) return;
    skipNextWriteRef.current = true;
    clearPersistedViewState(getBrowserViewStateStorage(), storageKey);
    setEntry({ key: storageKey, value: defaultRef.current });
  }, [storageKey]);

  return useMemo(
    () => [value, setValue, { restored, clear }] as const,
    [value, setValue, restored, clear]
  );
}
