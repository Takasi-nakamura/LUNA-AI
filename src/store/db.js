// IndexedDB ラッパー（仕組み章 2. ストレージ）
const DB_NAME = 'luna';
const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('chats', { keyPath: 'id' });
        const msgs = d.createObjectStore('messages', { keyPath: 'id' });
        msgs.createIndex('chatId', 'chatId');
        const mem = d.createObjectStore('memory', { keyPath: 'id' });
        mem.createIndex('keywords', 'keywords', { multiEntry: true });
        const st = d.createObjectStore('shortTerm', { keyPath: 'id' });
        st.createIndex('chatId', 'chatId');
        const sk = d.createObjectStore('skills', { keyPath: 'id' });
        sk.createIndex('name', 'name', { unique: true });
        d.createObjectStore('settings', { keyPath: 'key' });
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
  await del('chats', chatId);
}
