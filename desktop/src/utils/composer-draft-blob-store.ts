import { getBackendScope, scopedKey } from "./backend-scope";

/**
 * Image dataUrls for composer drafts are too large for localStorage (quota /
 * multi-MB base64). Keep metadata in localStorage; store payloads here
 * (memory cache + IndexedDB) so close-pane → reopen still restores chips.
 */

const IDB_NAME = "agx-composer-draft-blobs";
const IDB_STORE = "blobs";
const IDB_VERSION = 1;
/** Soft cap per blob (~25MB data URL) to avoid runaway memory. */
export const MAX_DRAFT_BLOB_CHARS = 25_000_000;

const memoryCache = new Map<string, string>();

function blobRecordId(draftKey: string, attachmentKey: string): string {
  const scope = getBackendScope();
  return `${scopedKey("draft-blob", scope)}::${draftKey}::${attachmentKey}`;
}

function draftPrefix(draftKey: string): string {
  const scope = getBackendScope();
  return `${scopedKey("draft-blob", scope)}::${draftKey}::`;
}

export function putDraftAttachmentBlobSync(
  draftKey: string,
  attachmentKey: string,
  dataUrl: string,
): void {
  const dk = String(draftKey || "").trim();
  const ak = String(attachmentKey || "").trim();
  const url = String(dataUrl || "");
  if (!dk || !ak || !url) return;
  if (url.length > MAX_DRAFT_BLOB_CHARS) return;
  const id = blobRecordId(dk, ak);
  memoryCache.set(id, url);
  void putIdb(id, url);
}

export function getDraftAttachmentBlobSync(
  draftKey: string,
  attachmentKey: string,
): string | null {
  const dk = String(draftKey || "").trim();
  const ak = String(attachmentKey || "").trim();
  if (!dk || !ak) return null;
  return memoryCache.get(blobRecordId(dk, ak)) ?? null;
}

export async function getDraftAttachmentBlob(
  draftKey: string,
  attachmentKey: string,
): Promise<string | null> {
  const sync = getDraftAttachmentBlobSync(draftKey, attachmentKey);
  if (sync) return sync;
  const dk = String(draftKey || "").trim();
  const ak = String(attachmentKey || "").trim();
  if (!dk || !ak) return null;
  const id = blobRecordId(dk, ak);
  const fromIdb = await getIdb(id);
  if (fromIdb) memoryCache.set(id, fromIdb);
  return fromIdb;
}

export function deleteDraftAttachmentBlobSync(
  draftKey: string,
  attachmentKey: string,
): void {
  const dk = String(draftKey || "").trim();
  const ak = String(attachmentKey || "").trim();
  if (!dk || !ak) return;
  const id = blobRecordId(dk, ak);
  memoryCache.delete(id);
  void deleteIdb(id);
}

export function deleteAllDraftAttachmentBlobsSync(draftKey: string): void {
  const dk = String(draftKey || "").trim();
  if (!dk) return;
  const prefix = draftPrefix(dk);
  for (const id of [...memoryCache.keys()]) {
    if (id.startsWith(prefix)) memoryCache.delete(id);
  }
  void deleteIdbByPrefix(prefix);
}

/** Move blob payloads when a pane-scoped draft migrates onto a session key. */
export function migrateDraftAttachmentBlobsSync(
  fromDraftKey: string,
  toDraftKey: string,
  attachmentKeys: string[],
): void {
  const from = String(fromDraftKey || "").trim();
  const to = String(toDraftKey || "").trim();
  if (!from || !to || from === to) return;
  for (const ak of attachmentKeys) {
    const dataUrl = getDraftAttachmentBlobSync(from, ak);
    if (dataUrl) putDraftAttachmentBlobSync(to, ak, dataUrl);
  }
  deleteAllDraftAttachmentBlobsSync(from);
}

/** Test helper: wipe in-memory cache (does not touch IDB). */
export function __resetDraftBlobMemoryForTests(): void {
  memoryCache.clear();
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), 1500);
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onerror = () => {
        window.clearTimeout(timer);
        finish(null);
      };
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        window.clearTimeout(timer);
        finish(req.result);
      };
    } catch {
      window.clearTimeout(timer);
      finish(null);
    }
  });
}

async function putIdb(id: string, dataUrl: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(dataUrl, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

async function getIdb(id: string): Promise<string | null> {
  const db = await openDb();
  if (!db) return null;
  const value = await new Promise<string | null>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(id);
      req.onsuccess = () => {
        const v = req.result;
        resolve(typeof v === "string" && v ? v : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  db.close();
  return value;
}

async function deleteIdb(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

async function deleteIdbByPrefix(prefix: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if (String(cursor.key).startsWith(prefix)) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}
