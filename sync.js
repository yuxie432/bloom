/* =========================================================================
 * sync.js  —  Optional Firebase Firestore cloud sync (layered on db.js)
 * -------------------------------------------------------------------------
 * The app stays fully local-first: without sign-in this module does nothing.
 * When you sign in with Google, it mirrors every local write to Firestore
 * and merges remote records back into IndexedDB by `updatedAt`
 * (last-write-wins per record), so your iPhone and laptop stay in sync.
 *
 * Data layout in Firestore (per user, private via security rules):
 *   users/{uid}/beans/{id}      — one doc per bean
 *   users/{uid}/brews/{id}      — one doc per brew
 *   users/{uid}/meta/settings   — single settings doc
 * Deletes are tombstones: { id, _deleted:true, updatedAt } so the other
 * device learns the record is gone.
 *
 * The Firebase config below is safe to be public — it only identifies the
 * project. Access is gated by Firebase Auth + Firestore security rules.
 * ========================================================================= */

import { getAll, get, putRaw, removeRaw, getSettings } from './db.js?v=23';
import { setSyncHooks } from './db.js?v=23';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDwRsrUNjhPnkngRPaNU7E_IjfXk9eSVgA',
  authDomain: 'bloom-2972a.firebaseapp.com',
  projectId: 'bloom-2972a',
  storageBucket: 'bloom-2972a.firebasestorage.app',
  messagingSenderId: '131839690417',
  appId: '1:131839690417:web:b6dc07ee42f927f6938490',
};

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const STORES = ['beans', 'brews'];

let app, auth, db, provider;
let _authMod = null, _fsMod = null;
let user = null;
let ready = false;
let onChangeCb = null;
let onAuthCb = null;
let unsubs = [];

export function currentUser() { return user; }

/* ---- boot -------------------------------------------------------------- */

/** Register sync hooks and load Firebase. Safe to call once at startup;
 *  it will restore a previously signed-in session automatically. */
export async function startSync({ onChange, onAuth } = {}) {
  onChangeCb = onChange || null;
  onAuthCb = onAuth || null;

  // Mirror user-initiated local writes to the cloud (no-ops until signed in).
  setSyncHooks({
    onPut: (store, record) => { pushRecord(store, record); },
    onRemove: (store, id) => { pushDelete(store, id); },
    onSettings: (settings) => { pushSettings(settings); },
  });

  await ensureFirebase();
}

async function ensureFirebase() {
  if (ready) return;
  const [appMod, authMod, fsMod] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js'),
  ]);
  _authMod = authMod;
  _fsMod = fsMod;

  app = appMod.initializeApp(FIREBASE_CONFIG);

  // Firestore with offline persistence so it behaves like local IndexedDB
  // when offline and flushes queued writes when back online.
  try {
    db = fsMod.initializeFirestore(app, { localCache: fsMod.persistentLocalCache() });
  } catch (e) {
    db = fsMod.getFirestore(app);
  }

  auth = authMod.getAuth(app);
  provider = new authMod.GoogleAuthProvider();
  try { await authMod.setPersistence(auth, authMod.browserLocalPersistence); } catch (e) { /* ignore */ }

  // Complete any mobile redirect sign-in that bounced back to the app.
  authMod.getRedirectResult(auth).catch(() => {});

  authMod.onAuthStateChanged(auth, async (u) => {
    user = u || null;
    if (onAuthCb) { try { onAuthCb(user); } catch (e) { /* ignore */ } }
    if (user) {
      try { await onSignedIn(); } catch (e) { console.warn('sync: initial sync failed', e); }
    } else {
      teardownSnapshots();
    }
  });

  ready = true;
}

/* ---- auth -------------------------------------------------------------- */

export async function signInGoogle() {
  await ensureFirebase();
  try {
    await _authMod.signInWithPopup(auth, provider);
  } catch (e) {
    // Popups are often blocked in installed PWAs / mobile Safari — fall back
    // to a full-page redirect. A user-cancelled popup is not retried.
    if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) {
      throw e;
    }
    await _authMod.signInWithRedirect(auth, provider);
  }
}

export async function signOutUser() {
  await ensureFirebase();
  teardownSnapshots();
  await _authMod.signOut(auth);
}

/* ---- Firestore refs + helpers ----------------------------------------- */

function col(store) { return _fsMod.collection(db, 'users', user.uid, store); }
function docRef(store, id) { return _fsMod.doc(db, 'users', user.uid, store, id); }
function settingsRef() { return _fsMod.doc(db, 'users', user.uid, 'meta', 'settings'); }

// Firestore rejects `undefined`; round-tripping through JSON drops those keys.
function clean(o) { return JSON.parse(JSON.stringify(o)); }

const nAt = (r) => (r && r.updatedAt) || '';

/* ---- push (local -> cloud) -------------------------------------------- */

async function pushRecord(store, record) {
  if (!user || !record || !record.id) return;
  try { await _fsMod.setDoc(docRef(store, record.id), clean(record)); }
  catch (e) { console.warn('sync: push failed', e); }
}

async function pushDelete(store, id) {
  if (!user || !id) return;
  const tombstone = { id, _deleted: true, updatedAt: new Date().toISOString() };
  try { await _fsMod.setDoc(docRef(store, id), tombstone); }
  catch (e) { console.warn('sync: delete push failed', e); }
}

async function pushSettings(settings) {
  if (!user || !settings) return;
  try { await _fsMod.setDoc(settingsRef(), clean({ ...settings, id: 'app' })); }
  catch (e) { console.warn('sync: settings push failed', e); }
}

/* ---- merge (cloud <-> local) ------------------------------------------ */

async function onSignedIn() {
  await fullSync();
  subscribe();
  if (onChangeCb) await onChangeCb();
}

/** One-shot reconcile of every store: newer side wins, missing side catches up. */
async function fullSync() {
  for (const store of STORES) {
    const snap = await _fsMod.getDocs(col(store));
    const remote = new Map();
    snap.forEach((d) => remote.set(d.id, d.data()));

    const localArr = await getAll(store);
    const local = new Map(localArr.map((r) => [r.id, r]));

    const ids = new Set([...remote.keys(), ...local.keys()]);
    for (const id of ids) {
      const R = remote.get(id);
      const L = local.get(id);
      if (R && R._deleted) {
        if (L && nAt(R) >= nAt(L)) await removeRaw(store, id);
        else if (L) await pushRecord(store, L);      // local edit is newer -> resurrect
      } else if (R && !L) {
        await putRaw(store, R);                       // remote-only -> take it
      } else if (R && L) {
        if (nAt(R) > nAt(L)) await putRaw(store, R);
        else if (nAt(L) > nAt(R)) await pushRecord(store, L);
      } else if (L && !R) {
        await pushRecord(store, L);                   // local-only -> upload
      }
    }
  }

  // settings (single doc, last-write-wins)
  try {
    const rs = await _fsMod.getDoc(settingsRef());
    const R = rs.exists() ? rs.data() : null;
    const L = await getSettings();
    if (R && nAt(R) > nAt(L)) await putRaw('settings', { ...R, id: 'app' });
    else if (L) await pushSettings(L);
  } catch (e) { console.warn('sync: settings reconcile failed', e); }
}

/** Live updates while both devices are open. */
function subscribe() {
  teardownSnapshots();
  for (const store of STORES) {
    const u = _fsMod.onSnapshot(col(store), async (snap) => {
      let changed = false;
      for (const ch of snap.docChanges()) {
        const R = ch.doc.data();
        const L = await get(store, R.id);
        if (R._deleted) {
          if (L && nAt(R) >= nAt(L)) { await removeRaw(store, R.id); changed = true; }
        } else if (!L || nAt(R) > nAt(L)) {
          await putRaw(store, R); changed = true;      // ignores our own echo (equal updatedAt)
        }
      }
      if (changed && onChangeCb) await onChangeCb();
    }, (err) => console.warn('sync: snapshot error', err));
    unsubs.push(u);
  }

  const us = _fsMod.onSnapshot(settingsRef(), async (d) => {
    if (!d.exists()) return;
    const R = d.data();
    const L = await getSettings();
    if (nAt(R) > nAt(L)) { await putRaw('settings', { ...R, id: 'app' }); if (onChangeCb) await onChangeCb(); }
  }, (err) => console.warn('sync: settings snapshot error', err));
  unsubs.push(us);
}

function teardownSnapshots() {
  unsubs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
  unsubs = [];
}

/* ---- helpers for import / erase --------------------------------------- */

/** Re-run a full reconcile (e.g. after importing a backup while signed in). */
export async function resync() {
  if (!user) return;
  await fullSync();
  if (onChangeCb) await onChangeCb();
}

/** Delete every cloud record for this user (used by "Erase all data"). */
export async function wipeRemote() {
  if (!user) return;
  for (const store of STORES) {
    const snap = await _fsMod.getDocs(col(store));
    await Promise.all(snap.docs.map((d) => _fsMod.deleteDoc(d.ref)));
  }
  try { await _fsMod.deleteDoc(settingsRef()); } catch (e) { /* ignore */ }
}
