/** The two calls of Storage the game uses. */
export type KeyValue = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The browser's storage, made safe: in a private window, with storage blocked or full, reads give null and writes do
 * nothing instead of throwing, so settings simply aren't remembered.
 */
export function safeStorage(get: () => Storage | undefined = () => globalThis.localStorage): KeyValue {
  return {
    getItem(key) {
      try {
        return get()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        get()?.setItem(key, value);
      } catch {
        // storage is blocked or full: carry on without it
      }
    },
  };
}
