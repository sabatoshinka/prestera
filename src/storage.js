const database = new Promise((resolve, reject) => {
  const request = indexedDB.open("pibble-club", 2);
  request.onupgradeneeded = () => {
    const db = request.result;
    for (const name of ["sounds", "messages", "attachments"])
      if (!db.objectStoreNames.contains(name))
        db.createObjectStore(name, { keyPath: "id" });
    const messages = request.transaction.objectStore("messages");
    if (!messages.indexNames.contains("time"))
      messages.createIndex("time", "time");
    if (!messages.indexNames.contains("roomTime"))
      messages.createIndex("roomTime", ["roomId", "time"]);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
export async function dbPut(store, value) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function dbGet(store, id) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function dbAll(store) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function dbDelete(store, id) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function dbClear(store) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function recentMessages(roomId) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const store = db.transaction("messages").objectStore("messages");
    const index = store.index(roomId ? "roomTime" : "time");
    const range = roomId
      ? IDBKeyRange.bound([roomId, 0], [roomId, Number.MAX_SAFE_INTEGER])
      : null;
    const request = index.openCursor(range, "prev");
    const result = [];
    let bytes = 0;
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || result.length >= 150) return resolve(result.reverse());
      bytes += cursor.value.file?.size || 0;
      if (bytes > 64 * 1024 * 1024) return resolve(result.reverse());
      result.push(cursor.value);
      cursor.continue();
    };
  });
}
