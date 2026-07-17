// Session persistence: the user's loaded library, edits, part setup and a few
// UI values survive page reloads via IndexedDB. Built-in library content is
// never stored — only what lives in the rack.

import type { RackState } from '../engine/rack-state';

const DB_NAME = 'texed';
const DB_VERSION = 1;
const STORE = 'state';
const KEY = 'session';

export const SESSION_SCHEMA = 1;

export interface SessionUiState {
  volume: number;
  engine: number;
  polyphony: number;
}

export interface SessionRecord {
  schema: typeof SESSION_SCHEMA;
  savedAt: number;
  rack: RackState;
  ui: SessionUiState;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

function requestDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });
}

/** Persist the session; failures are swallowed (persistence is best-effort). */
export async function saveSession(record: SessionRecord): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    await requestDone(tx.objectStore(STORE).put(record, KEY));
    db.close();
  } catch {
    // Private browsing / quota / blocked — losing persistence is acceptable.
  }
}

/** Load the saved session, or null when absent, unreadable, or schema-mismatched. */
export async function loadSession(): Promise<SessionRecord | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const record = (await requestDone(tx.objectStore(STORE).get(KEY))) as SessionRecord | undefined;
    db.close();
    if (!record || record.schema !== SESSION_SCHEMA || !record.rack) return null;
    return record;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    await requestDone(tx.objectStore(STORE).delete(KEY));
    db.close();
  } catch {
    // Best-effort.
  }
}
