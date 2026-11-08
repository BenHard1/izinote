// Stockage local (IndexedDB). Si la synchronisation est activée (sync.js), les données sont aussi
// copiées dans le Google Drive du Gmail dédié pour être retrouvées sur les autres appareils.
const DB_NAME = 'correction-db';
const DB_VERSION = 2;
export const STORES = ['schools', 'classes', 'students', 'assignments', 'copies', 'grids', 'settings'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const mk = (name, indexes = []) => {
        if (db.objectStoreNames.contains(name)) return;
        const s = db.createObjectStore(name, { keyPath: 'id' });
        indexes.forEach(i => s.createIndex(i, i));
      };
      mk('schools');
      mk('classes', ['schoolId']);
      mk('students', ['classId']);
      mk('assignments', ['classId']);
      mk('copies', ['assignmentId', 'studentId']);
      mk('grids');
      mk('settings');
      // traces des suppressions, pour que la synchronisation les reporte sur les autres appareils
      mk('tombstones');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function get(name, id) {
  if (id == null) return undefined;
  return wrap((await store(name)).get(id));
}
export async function all(name) {
  return wrap((await store(name)).getAll());
}
export async function by(name, index, value) {
  return wrap((await store(name)).index(index).getAll(value));
}
// Prévient la synchronisation qu'une donnée a changé sur cet appareil.
const listeners = new Set();
export const onChange = fn => listeners.add(fn);
const changed = name => listeners.forEach(fn => {
  try {
    fn(name);
  } catch (e) {
    console.error(e);
  }
});

// Version du PDF d'une copie : change quand le PDF est remplacé (sert à la synchronisation).
function stampPdf(name, obj) {
  if (name !== 'copies') return;
  if (obj.pdf instanceof Blob) {
    if (!obj.pdfRev) obj.pdfRev = uid();
  } else obj.pdfRev = null;
}

// Écrit tel quel (sans changer la date de modification) et efface une éventuelle trace de suppression.
export async function putRaw(name, obj) {
  stampPdf(name, obj);
  const db = await open();
  const tx = db.transaction([name, 'tombstones'], 'readwrite');
  tx.objectStore(name).put(obj);
  tx.objectStore('tombstones').delete(name + '/' + obj.id);
  await txDone(tx);
  return obj;
}
export async function put(name, obj) {
  if (!obj.id) obj.id = uid();
  obj.updatedAt = Date.now();
  await putRaw(name, obj);
  changed(name);
  return obj;
}
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
// Supprime sans laisser de trace (utilisé par la synchronisation).
export async function delRaw(name, id) {
  return wrap((await store(name, 'readwrite')).delete(id));
}
export async function del(name, id) {
  if (id == null) return;
  const db = await open();
  const tx = db.transaction([name, 'tombstones'], 'readwrite');
  tx.objectStore(name).delete(id);
  tx.objectStore('tombstones').put({ id: name + '/' + id, store: name, recId: id, deletedAt: Date.now() });
  await txDone(tx);
  changed(name);
}
export async function clear(name) {
  const db = await open();
  const ids = await wrap(db.transaction(name).objectStore(name).getAllKeys());
  const tx = db.transaction([name, 'tombstones'], 'readwrite');
  tx.objectStore(name).clear();
  const now = Date.now();
  for (const id of ids) tx.objectStore('tombstones').put({ id: name + '/' + id, store: name, recId: id, deletedAt: now });
  await txDone(tx);
  changed(name);
}

export const sortByName = (a, b) => (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });
export const sortStudents = (a, b) =>
  (a.lastName || '').localeCompare(b.lastName || '', 'fr', { sensitivity: 'base' }) ||
  (a.firstName || '').localeCompare(b.firstName || '', 'fr', { sensitivity: 'base' });

// ---- Suppressions en cascade ----
export async function deleteAssignment(id) {
  for (const c of await by('copies', 'assignmentId', id)) await del('copies', c.id);
  await del('assignments', id);
}
export async function deleteStudent(id) {
  for (const c of await by('copies', 'studentId', id)) await del('copies', c.id);
  await del('students', id);
}
export async function deleteClass(id) {
  for (const a of await by('assignments', 'classId', id)) await deleteAssignment(a.id);
  for (const s of await by('students', 'classId', id)) await deleteStudent(s.id);
  await del('classes', id);
}
export async function deleteSchool(id) {
  for (const c of await by('classes', 'schoolId', id)) await deleteClass(c.id);
  await del('schools', id);
}

// ---- Réglages ----
export const DEFAULT_SETTINGS = {
  id: 'main',
  teacherName: '',
  googleClientId: '',
  stylusOnly: true,
  mailSubject: 'Correction : {devoir}',
  mailBody:
    'Bonjour {prenom},\n\nVous trouverez ci-joint votre copie corrigée pour « {devoir} ».\n\n{evaluation}\n\nCommentaire :\n{commentaire}\n\nBonne continuation,\n{professeur}',
};
export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...((await get('settings', 'main')) || {}) };
}
export async function saveSettings(s) {
  return put('settings', { ...s, id: 'main' });
}

// ---- Sauvegarde / restauration ----
function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
function b64ToBlob(b64, type = 'application/pdf') {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

export async function exportAll() {
  const out = { app: 'appli-correction', version: 1, date: new Date().toISOString(), data: {} };
  for (const name of STORES) {
    const rows = await all(name);
    if (name === 'copies') {
      for (const r of rows) {
        if (r.pdf instanceof Blob) r.pdf = { __b64: await blobToB64(r.pdf) };
      }
    }
    out.data[name] = rows;
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

export async function importAll(file, { replace = true } = {}) {
  const json = JSON.parse(await file.text());
  if (json.app !== 'appli-correction') throw new Error("Ce fichier n'est pas une sauvegarde de l'appli.");
  for (const name of STORES) {
    if (replace) await clear(name);
    for (const r of json.data[name] || []) {
      if (r.pdf && r.pdf.__b64) r.pdf = b64ToBlob(r.pdf.__b64);
      // la sauvegarde restaurée devient la version la plus récente (pour la synchronisation)
      r.updatedAt = Date.now();
      await putRaw(name, r);
    }
  }
  changed('*');
}
