// IndexedDB ラッパー（仕組み章 2. ストレージ）
const DB_NAME = 'luna';
const DB_VERSION = 2;
let dbPromise = null;

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('chats')) d.createObjectStore('chats', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('messages')) {
          const msgs = d.createObjectStore('messages', { keyPath: 'id' });
          msgs.createIndex('chatId', 'chatId');
        }
        if (!d.objectStoreNames.contains('memory')) {
          const mem = d.createObjectStore('memory', { keyPath: 'id' });
          mem.createIndex('keywords', 'keywords', { multiEntry: true });
        }
        if (!d.objectStoreNames.contains('shortTerm')) {
          const st = d.createObjectStore('shortTerm', { keyPath: 'id' });
          st.createIndex('chatId', 'chatId');
        }
        if (!d.objectStoreNames.contains('skills')) {
          const sk = d.createObjectStore('skills', { keyPath: 'id' });
          sk.createIndex('name', 'name', { unique: true });
        }
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('branches')) {
          const branches = d.createObjectStore('branches', { keyPath: 'id' });
          branches.createIndex('chatId', 'chatId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        let out;
        if (req) req.onsuccess = () => { out = req.result; };
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
      })
  );
}

export const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const put = (store, value) => run(store, 'readwrite', (s) => s.put(value));
export const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const getAllByIndex = (store, index, value) =>
  run(store, 'readonly', (s) => s.index(index).getAll(value));

export async function deleteChatCascade(chatId) {
  for (const m of await getAllByIndex('messages', 'chatId', chatId)) await del('messages', m.id);
  for (const s of await getAllByIndex('shortTerm', 'chatId', chatId)) await del('shortTerm', s.id);
  for (const b of await getAllByIndex('branches', 'chatId', chatId)) await del('branches', b.id);
  await del('chats', chatId);
}
