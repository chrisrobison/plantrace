// Project-document persistence (IndexedDB) + source-image persistence
// (the small PHP upload API, via remote-asset-store.js), unified behind one
// ProjectRepository-shaped interface. That boundary is deliberate — the
// brief calls for a future PHP/MySQL repository to be able to replace this
// one without touching a single UI component, so nothing outside this file
// may assume how either half is actually stored.
//
// Project documents (sheets, geometry, layers, review state) are
// JSON-serializable and stay in IndexedDB. Source images are real files
// now, held by the server under storage/uploads/ (see
// src/Http/UploadStore.php + docs/ARCHITECTURE.md "File uploads") rather
// than as Blobs in IndexedDB — this is also why the brief's "don't put
// large images in localStorage" concern doesn't apply here at all: they
// never touch browser storage in the first place.
import { uploadAsset, fetchAsset, deleteAsset } from './remote-asset-store.js';

const DB_NAME = 'plantrace';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const LAST_PROJECT_KEY = 'plantrace:lastProjectId';

/**
 * @interface ProjectRepository
 * list(): Promise<Array<{id, name, updatedAt}>>
 * load(id): Promise<Object|null>
 * save(doc): Promise<void>
 * remove(id): Promise<void>
 * saveAsset(blob, meta): Promise<string>              // returns assetId
 * loadAsset(assetId): Promise<{blob, ...meta}|null>
 * removeAsset(assetId): Promise<void>
 * getLastProjectId(): string|null
 * setLastProjectId(id): void
 */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

function tx(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = fn(store);
    transaction.oncomplete = () => resolve(result?.result ?? result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
  });
}

export class IndexedDBProjectRepository {
  constructor() { this._dbPromise = null; }

  async _db() {
    if (!this._dbPromise) this._dbPromise = openDb();
    return this._dbPromise;
  }

  async list() {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const store = db.transaction(STORE_PROJECTS, 'readonly').objectStore(STORE_PROJECTS);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result || []).map((doc) => ({ id: doc.project.id, name: doc.project.name, updatedAt: doc.project.updatedAt })));
      req.onerror = () => reject(req.error);
    });
  }

  async load(id) {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_PROJECTS, 'readonly').objectStore(STORE_PROJECTS).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async save(doc) {
    const db = await this._db();
    const record = { ...structuredClone(doc), id: doc.project.id };
    await tx(db, STORE_PROJECTS, 'readwrite', (store) => store.put(record));
  }

  async remove(id) {
    const db = await this._db();
    await tx(db, STORE_PROJECTS, 'readwrite', (store) => store.delete(id));
  }

  /** @returns {Promise<string>} the server-assigned asset id */
  async saveAsset(blob, meta = {}) {
    const result = await uploadAsset(blob, meta);
    return result.id;
  }

  async loadAsset(assetId) {
    if (!assetId) return null;
    try {
      return await fetchAsset(assetId);
    } catch (err) {
      // Matches the old IndexedDB behavior of resolving to null for a
      // missing record; callers already handle a null/failed asset by
      // showing an "image unavailable" state rather than throwing.
      if (String(err.message || '').includes('no longer exists')) return null;
      throw err;
    }
  }

  async removeAsset(assetId) {
    if (!assetId) return;
    await deleteAsset(assetId);
  }

  /** Danger: wipes every project in this browser AND every uploaded source image those projects referenced on the server. Used by Settings → "Clear all local projects". */
  async clearAll() {
    const db = await this._db();
    const docs = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE_PROJECTS, 'readonly').objectStore(STORE_PROJECTS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    const assetIds = new Set();
    for (const doc of docs) {
      for (const sheet of doc.sheets || []) {
        if (sheet.assetId) assetIds.add(sheet.assetId);
        if (sheet.preparedAssetId) assetIds.add(sheet.preparedAssetId);
      }
    }
    if (assetIds.size) {
      await Promise.all([...assetIds].map((id) => deleteAsset(id)));
    }
    await tx(db, STORE_PROJECTS, 'readwrite', (store) => store.clear());
    this.setLastProjectId(null);
  }

  getLastProjectId() {
    try { return localStorage.getItem(LAST_PROJECT_KEY); } catch { return null; }
  }

  setLastProjectId(id) {
    try {
      if (id) localStorage.setItem(LAST_PROJECT_KEY, id);
      else localStorage.removeItem(LAST_PROJECT_KEY);
    } catch { /* storage unavailable (private mode, quota) — non-fatal */ }
  }
}

export const projectRepository = new IndexedDBProjectRepository();
