/* =========================================================================
 * db.js  —  Local-first storage layer
 * -------------------------------------------------------------------------
 * All data is stored on-device in IndexedDB. This module is the ONLY place
 * that touches storage, so a cloud-sync backend (Firebase, Supabase, ...)
 * can be added later by extending these functions — the rest of the app
 * never needs to change.
 *
 * Two "stores": 'beans' and 'brews'. Each record has:
 *   id        - unique string (generated with uid())
 *   updatedAt - ISO timestamp, used later for sync conflict resolution
 * ========================================================================= */

const DB_NAME = 'pourover-journal';
const DB_VERSION = 1;
const STORES = ['beans', 'brews'];

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(store, mode) {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}

/** Generate a short unique id. */
export function uid() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/** Get every record from a store, newest updates last. */
export async function getAll(store) {
  const os = await tx(store, 'readonly');
  return new Promise((resolve, reject) => {
    const req = os.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/** Get one record by id. */
export async function get(store, id) {
  const os = await tx(store, 'readonly');
  return new Promise((resolve, reject) => {
    const req = os.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/** Insert or update a record. Stamps id + updatedAt automatically. */
export async function put(store, record) {
  if (!record.id) record.id = uid();
  record.updatedAt = new Date().toISOString();
  const os = await tx(store, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = os.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

/** Delete a record by id. */
export async function remove(store, id) {
  const os = await tx(store, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = os.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ---- Backup / restore (manual cross-device transfer without a cloud) ---- */

/** Export everything as a single JSON object. */
export async function exportAll() {
  const [beans, brews] = await Promise.all([getAll('beans'), getAll('brews')]);
  return {
    app: 'pourover-journal',
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    beans,
    brews,
  };
}

/** Import a JSON backup. mode 'merge' keeps existing; 'replace' wipes first. */
export async function importAll(data, mode = 'merge') {
  if (!data || !Array.isArray(data.beans) || !Array.isArray(data.brews)) {
    throw new Error('That file does not look like a Pour-Over Journal backup.');
  }
  const db = await openDB();
  if (mode === 'replace') {
    await new Promise((resolve, reject) => {
      const t = db.transaction(STORES, 'readwrite');
      for (const s of STORES) t.objectStore(s).clear();
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  }
  await new Promise((resolve, reject) => {
    const t = db.transaction(STORES, 'readwrite');
    for (const b of data.beans) t.objectStore('beans').put(b);
    for (const b of data.brews) t.objectStore('brews').put(b);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  return { beans: data.beans.length, brews: data.brews.length };
}
