/**
 * In-memory chrome.* API for unit and integration tests: storage areas with
 * change events and a runtime message bus that delivers to every listener
 * except the sender, like Chrome does.
 */
import { vi } from 'vitest';

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean | void;

export function createChromeMock() {
  const changeListeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>();
  const area = (name: string) => {
    let data: Record<string, unknown> = {};
    return {
      async get(keys?: string | string[] | null) {
        if (keys == null) return structuredClone(data);
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
      },
      async set(items: Record<string, unknown>) {
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: data[key], newValue: structuredClone(value) };
          data[key] = structuredClone(value);
        }
        for (const listener of changeListeners) listener(changes, name);
      },
      async remove(keys: string | string[]) {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      },
      async clear() {
        data = {};
      },
    };
  };

  const contexts: { listeners: Set<Listener>; sender: chrome.runtime.MessageSender }[] = [];
  const id = 'test-extension-id';

  function makeRuntime(sender: chrome.runtime.MessageSender) {
    const ctx = { listeners: new Set<Listener>(), sender };
    contexts.push(ctx);
    return {
      id,
      getURL: (path: string) => `chrome-extension://${id}/${path}`,
      onMessage: {
        addListener: (listener: Listener) => ctx.listeners.add(listener),
        removeListener: (listener: Listener) => ctx.listeners.delete(listener),
      },
      sendMessage: (message: unknown) =>
        new Promise((resolve) => {
          let answered = false;
          let pending = 0;
          for (const other of contexts) {
            if (other === ctx) continue;
            for (const listener of other.listeners) {
              const keepOpen = listener(structuredClone(message), sender, (response) => {
                if (!answered) {
                  answered = true;
                  resolve(response);
                }
              });
              if (keepOpen === true) pending++;
            }
          }
          if (!pending) setTimeout(() => !answered && resolve(undefined), 0);
        }),
    };
  }

  const storage = {
    local: area('local'),
    session: area('session'),
    onChanged: {
      addListener: (listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => changeListeners.add(listener),
      removeListener: (listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => changeListeners.delete(listener),
    },
  };

  /** Creates a `chrome` global for one extension context (e.g. background, offscreen). */
  function contextChrome(sender: Partial<chrome.runtime.MessageSender> = {}) {
    return { runtime: makeRuntime({ id, ...sender }), storage, tabs: { sendMessage: vi.fn(async () => undefined) } } as unknown as typeof chrome;
  }

  return { storage, contextChrome };
}
