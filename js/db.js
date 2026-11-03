// Stockage local (IndexedDB) : tout reste sur la tablette.
const DB_NAME = 'correction-db';
const DB_VERSION = 1;
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
export async function put(name, obj) {
  if (!obj.id) obj.id = uid();
  obj.updatedAt = Date.now();
  await wrap((await store(name, 'readwrite')).put(obj));
  return obj;
}
export async function del(name, id) {
  return wrap((await store(name, 'readwrite')).delete(id));
}
export async function clear(name) {
  return wrap((await store(name, 'readwrite')).clear());
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
      await wrap((await store(name, 'readwrite')).put(r));
    }
  }
}
