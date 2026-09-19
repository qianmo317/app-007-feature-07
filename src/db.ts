import type { Plan } from './types';
import type { PersistedHistory } from './history';

const DB_NAME = 'WeddingSeatingPlanner';
const DB_VERSION = 2;
const STORE_NAME = 'plans';
const HISTORY_STORE_NAME = 'history';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(HISTORY_STORE_NAME)) {
        // key 为方案 id，直接存历史栈快照
        db.createObjectStore(HISTORY_STORE_NAME);
      }
    };
  });
}

export async function getAllPlans(): Promise<Plan[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as Plan[]);
    req.onerror = () => reject(req.error);
  });
}

export async function getPlan(id: string): Promise<Plan | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result as Plan | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function savePlan(plan: Plan): Promise<void> {
  const db = await openDB();
  const toSave = { ...plan, updatedAt: Date.now() };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(toSave);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getHistory(id: string): Promise<PersistedHistory | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE_NAME, 'readonly');
    const store = tx.objectStore(HISTORY_STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result as PersistedHistory | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function saveHistory(id: string, history: PersistedHistory): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE_NAME, 'readwrite');
    const store = tx.objectStore(HISTORY_STORE_NAME);
    const req = store.put(history, id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deletePlan(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, HISTORY_STORE_NAME], 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.objectStore(HISTORY_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function setRecentPlanId(id: string) {
  try {
    localStorage.setItem('recentPlanId', id);
  } catch {}
}

export function getRecentPlanId(): string | null {
  try {
    return localStorage.getItem('recentPlanId');
  } catch {
    return null;
  }
}
