// IndexedDB-backed persistence. This is the ONLY place that talks to
// IndexedDB; every other module goes through the ProjectRepository-shaped
// interface below. That boundary is deliberate — the brief calls for a
// future PHP/MySQL repository to be able to replace this one without
// touching a single UI component, so nothing outside this file may assume
// "IndexedDB" is how persistence works.
//
// Two object stores in one database:
//  - "projects": id -> normalized project document (JSON-serializable)
//  - "assets":   id -> { blob, filename, mimeType, width, height, size }
//
// Source images are kept here as Blobs (never as base64 strings), which is
// also why they can't live in localStorage — the brief is explicit that
// large source images must not end up there.
const DB_NAME = 'plantrace';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_ASSETS = 'assets';
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
      if (!db.objectStoreNames.contains(STORE_ASSETS)) db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
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

  async saveAsset(blob, meta = {}) {
    const db = await this._db();
    const id = meta.id || `asset_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const record = { id, blob, filename: meta.filename || 'source', mimeType: meta.mimeType || blob.type, width: meta.width || 0, height: meta.height || 0, size: blob.size };
    await tx(db, STORE_ASSETS, 'readwrite', (store) => store.put(record));
    return id;
  }

  async loadAsset(assetId) {
    if (!assetId) return null;
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_ASSETS, 'readonly').objectStore(STORE_ASSETS).get(assetId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async removeAsset(assetId) {
    const db = await this._db();
    await tx(db, STORE_ASSETS, 'readwrite', (store) => store.delete(assetId));
  }

  /** Danger: wipes every project and every stored asset blob in this browser. Used by Settings → "Clear all local projects". */
  async clearAll() {
    const db = await this._db();
    await tx(db, STORE_PROJECTS, 'readwrite', (store) => store.clear());
    await tx(db, STORE_ASSETS, 'readwrite', (store) => store.clear());
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
