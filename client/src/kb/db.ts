// Local storage for the knowledge base and opted-in sessions: one IndexedDB database in this
// browser, nothing on the server (SECURITY_PRIVACY). No wrapper library: the platform API is enough.

import { DEFAULT_PROFILE_ID } from '../../../shared/profile.ts';

export interface Store<T extends { id: string }> {
  all(): Promise<T[]>;
  put(value: T): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export type StoreName = 'kb' | 'sessions' | 'profiles' | 'questions';
const DB_NAME = 'metor';
// v1 (Phase 5): kb, sessions. v2 (Phase 6): profiles and practice questions; existing records are
// tagged with the default profile so nothing is lost or mixed.
const DB_VERSION = 2;
const STORES: StoreName[] = ['kb', 'sessions', 'profiles', 'questions'];

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      for (const name of STORES) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
      }
      const tx = req.transaction;
      if (event.oldVersion >= 1 && event.oldVersion < 2 && tx) {
        for (const name of ['kb', 'sessions'] as const) tagWithDefaultProfile(tx.objectStore(name));
      }
    };
    req.onsuccess = () => {
      // Another tab deleting or upgrading the database: let go so it isn't blocked.
      req.result.onversionchange = () => {
        req.result.close();
        opening = null;
      };
      resolve(req.result);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error ?? new Error('IndexedDB unavailable'));
    };
  });
  return opening;
}

/** Migration to v2: records from before profiles belong to the default profile. */
function tagWithDefaultProfile(store: IDBObjectStore): void {
  const cursorReq = store.openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    const value = cursor.value as { profileId?: string };
    if (!value.profileId) cursor.update({ ...value, profileId: DEFAULT_PROFILE_ID });
    cursor.continue();
  };
}

function run<R>(name: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<R>): Promise<R> {
  return open().then(
    (db) =>
      new Promise<R>((resolve, reject) => {
        const tx = db.transaction(name, mode);
        const req = fn(tx.objectStore(name));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      }),
  );
}

export function idbStore<T extends { id: string }>(name: StoreName): Store<T> {
  return {
    all: () => run(name, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
    put: (value) => run(name, 'readwrite', (s) => s.put(value)).then(() => undefined),
    delete: (id) => run(name, 'readwrite', (s) => s.delete(id)).then(() => undefined),
    clear: () => run(name, 'readwrite', (s) => s.clear()).then(() => undefined),
  };
}

export const BLOCKED_WAIT_MS = 3000;

/**
 * "Delete everything": removes the whole database (KB and saved sessions). Resolves only once it's
 * really gone. Other Metor tabs close their connection when asked (onversionchange); if one still
 * holds it after BLOCKED_WAIT_MS, or deletion fails, this rejects and nothing is reported as deleted.
 */
export function deleteDatabase(blockedWaitMs = BLOCKED_WAIT_MS): Promise<void> {
  const pending = opening;
  opening = null;
  return (pending ? pending.then((db) => db.close(), () => undefined) : Promise.resolve()).then(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        let timer: ReturnType<typeof setTimeout> | undefined;
        req.onsuccess = () => {
          clearTimeout(timer);
          resolve();
        };
        req.onerror = () => {
          clearTimeout(timer);
          reject(req.error ?? new Error('Could not delete local data.'));
        };
        req.onblocked = () => {
          // Still finishes if the other tab lets go in time; otherwise report failure.
          timer = setTimeout(() => reject(new Error('Another Metor tab is using the data. Close other Metor tabs and try again.')), blockedWaitMs);
        };
      }),
  );
}

/** In-memory store with the same contract, for unit tests. */
export function memoryStore<T extends { id: string }>(initial: T[] = []): Store<T> & { writes: number } {
  const map = new Map(initial.map((v) => [v.id, v]));
  const store = {
    writes: 0,
    all: async () => [...map.values()],
    put: async (value: T) => {
      store.writes++;
      map.set(value.id, value);
    },
    delete: async (id: string) => {
      store.writes++;
      map.delete(id);
    },
    clear: async () => {
      store.writes++;
      map.clear();
    },
  };
  return store;
}
