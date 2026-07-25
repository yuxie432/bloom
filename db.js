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
const DB_VERSION = 2;
const STORES = ['beans', 'brews', 'settings'];

let _dbPromise = null;

/* ---- Sync hooks --------------------------------------------------------
 * An optional cloud-sync layer (sync.js) registers callbacks here so that
 * user-initiated writes are mirrored to the cloud. The hooks fire ONLY for
 * the user-facing writers (put / remove / commitSettings) — never for the
 * "raw" writers used to apply already-synced remote records, which prevents
 * echo loops. If no sync layer is registered, these are no-ops. */
let _hooks = { onPut: null, onRemove: null, onSettings: null };
export function setSyncHooks(h) { _hooks = { ..._hooks, ...h }; }

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
  await new Promise((resolve, reject) => {
    const req = os.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  try { _hooks.onPut && _hooks.onPut(store, record); } catch (e) { /* sync best-effort */ }
  return record;
}

/** Delete a record by id. */
export async function remove(store, id) {
  const os = await tx(store, 'readwrite');
  await new Promise((resolve, reject) => {
    const req = os.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  try { _hooks.onRemove && _hooks.onRemove(store, id); } catch (e) { /* sync best-effort */ }
}

/* ---- Raw writers (used by the sync layer to apply remote records) -------
 * These do NOT stamp updatedAt and do NOT fire sync hooks, so the exact
 * remote record (with its original updatedAt) lands locally without echoing
 * back to the cloud. */
export async function putRaw(store, record) {
  const os = await tx(store, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = os.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}
export async function removeRaw(store, id) {
  const os = await tx(store, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = os.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Wipe all beans, brews, and settings (a full reset). */
export async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORES, 'readwrite');
    STORES.forEach((s) => t.objectStore(s).clear());
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/* ---- Settings (editable lists + defaults, single record id='app') ---- */

export const DEFAULT_SETTINGS = {
  id: 'app',
  grinders: ['Mavo Phantox Pro', 'Mavo Wizard 2.0'],
  devices: ['Plastic V60 01', 'Glass V60 02', 'Hario Switch', 'Origami 155'],
  papers: ['Origami Wave', 'Origami Cone', 'Hario', 'Mola', 'Abaca'],
  roasters: [],
  countries: [],
  varietals: [],
  processes: ['Washed', 'Natural', 'Honey', 'Anaerobic natural',
    'Anaerobic washed', 'Anaerobic honey', 'Wet hulling', 'Other'],
  defaults: {
    grinder: 'Mavo Phantox Pro',
    device: 'Plastic V60 01',
    paper: '',
    dose: 15,
    waterTemp: 92,
    technique: 'Three-stage',
  },
};

export async function getSettings() {
  const s = await get('settings', 'app');
  if (!s) return { ...DEFAULT_SETTINGS };
  // merge so new default keys appear for older stored settings
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    defaults: { ...DEFAULT_SETTINGS.defaults, ...(s.defaults || {}) },
  };
}

/** Persist settings as-is (no updatedAt stamp, no sync hook). Used for the
 *  boot-time defaults normalisation and after an erase — writes that should
 *  not overwrite a newer copy on another device. */
export async function saveSettings(settings) {
  const rec = { ...settings, id: 'app' };
  const os = await tx('settings', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = os.put(rec);
    req.onsuccess = () => resolve(rec);
    req.onerror = () => reject(req.error);
  });
}

/** User-initiated settings save: stamps updatedAt and mirrors to the cloud. */
export async function commitSettings(settings) {
  const rec = { ...settings, id: 'app', updatedAt: new Date().toISOString() };
  const os = await tx('settings', 'readwrite');
  await new Promise((resolve, reject) => {
    const req = os.put(rec);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  try { _hooks.onSettings && _hooks.onSettings(rec); } catch (e) { /* sync best-effort */ }
  return rec;
}

/* ---- Backup / restore (manual cross-device transfer without a cloud) ---- */

/** Export everything as a single JSON object. */
export async function exportAll() {
  const [beans, brews, settings] = await Promise.all([
    getAll('beans'), getAll('brews'), get('settings', 'app'),
  ]);
  return {
    app: 'pourover-journal',
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    beans,
    brews,
    settings: settings || undefined,
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
    if (data.settings) t.objectStore('settings').put({ ...data.settings, id: 'app' });
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  return { beans: data.beans.length, brews: data.brews.length };
}
