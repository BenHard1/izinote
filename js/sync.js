// Synchronisation entre appareils (tablette, ordinateur…) par le Google Drive du Gmail dédié.
//
// Les données sont rangées dans le « dossier de l'application » du Drive (appDataFolder) : un dossier
// caché, propre à IziNote, invisible dans Drive et qu'IziNote est seul à pouvoir lire.
//  - izinote-donnees.json : toutes les données (écoles, classes, étudiants, devoirs, copies sans le PDF,
//    grilles, réglages) et la liste des suppressions ;
//  - pdf_<copie>_<version>.pdf : le PDF de chaque copie, envoyé une seule fois par version.
//
// Fusion enregistrement par enregistrement : la version modifiée en dernier gagne, et une suppression
// plus récente que la dernière modification l'emporte. On peut donc travailler hors ligne sur deux
// appareils : tout se rassemble à la synchronisation suivante.
import * as db from './db.js';
import * as gmail from './gmail.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const DATA_NAME = 'izinote-donnees.json';
const SYNC_STORES = ['schools', 'classes', 'students', 'assignments', 'copies', 'grids', 'settings'];
const AUTO_DELAY = 15000;
const LS_KEY = 'izinote-sync';

// ---------- État local (propre à cet appareil) ----------
function loadState() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    return {};
  }
}
const state = { enabled: false, last: 0, dirty: false, ...loadState() };
function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {}
}
export const isEnabled = () => !!state.enabled;
export const lastSync = () => state.last || 0;

let status = { state: 'off', msg: '' };
const statusListeners = new Set();
export function onStatus(fn) {
  statusListeners.add(fn);
  fn(status);
}
function setStatus(st, msg = '') {
  status = { state: st, msg };
  statusListeners.forEach(fn => fn(status));
}
function refreshStatus() {
  if (!state.enabled) return setStatus('off');
  if (running) return setStatus('busy');
  if (!gmail.hasValidToken()) return setStatus('auth', 'Touchez pour synchroniser');
  setStatus(state.dirty ? 'pending' : 'ok');
}

// Appelé quand des données arrivent d'un autre appareil (pour rafraîchir l'écran).
let onRemote = () => {};
export const onRemoteChanges = fn => (onRemote = fn);

// ---------- Appels à l'API Google Drive ----------
async function api(url, opts = {}, token) {
  let res;
  try {
    res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  } catch {
    throw new Error('Google Drive injoignable (connexion internet ?).');
  }
  if (res.status === 401) {
    gmail.forgetToken();
    throw new Error('Session Google expirée : touchez ☁ pour vous reconnecter.');
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).error.message || '';
    } catch {}
    if (res.status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(detail))
      throw new Error('Activez l’API Google Drive dans votre projet Google Cloud (voir Réglages › Synchronisation).');
    if (res.status === 403 && /insufficient|scope/i.test(detail))
      throw new Error('Google n’a pas donné l’accès au Drive : relancez la synchronisation et cochez l’accès demandé.');
    throw new Error(`Google Drive a refusé la demande (${res.status}) ${detail}`);
  }
  return res;
}

async function listFiles(token) {
  const files = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken,files(id,name)', pageSize: '1000' });
    if (pageToken) q.set('pageToken', pageToken);
    const data = await (await api(`${API}/files?${q}`, {}, token)).json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files;
}

async function upload(token, { id, name, blob }) {
  if (id) {
    await api(`${UPLOAD}/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob }, token);
    return id;
  }
  const boundary = 'izinote' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name, parents: ['appDataFolder'] });
  const body = new Blob(
    [`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${boundary}--`],
  );
  const res = await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }, token);
  return (await res.json()).id;
}

const download = async (token, id) => (await api(`${API}/files/${id}?alt=media`, {}, token)).blob();
const remove = (token, id) => api(`${API}/files/${id}`, { method: 'DELETE' }, token).catch(() => {});
const pdfName = (copyId, rev) => `pdf_${copyId}_${rev}.pdf`;

// ---------- Synchronisation ----------
let running = null;
let again = false;

// `interactive` : appelé depuis un clic, on peut ouvrir la fenêtre de connexion Google.
export async function syncNow({ interactive = false } = {}) {
  if (!state.enabled) return;
  if (running) {
    again = true;
    return running;
  }
  const settings = await db.getSettings();
  if (!settings.googleClientId) {
    setStatus('error', 'Indiquez d’abord l’ID client Google dans les Réglages.');
    throw new Error(status.msg);
  }
  if (!gmail.hasValidToken() && !interactive) return refreshStatus();
  running = (async () => {
    let token;
    try {
      if (interactive) await gmail.loadGis();
      token = await gmail.authorize(settings.googleClientId);
    } catch (e) {
      setStatus('auth', e.message);
      throw e;
    }
    setStatus('busy');
    const changes = await syncWith(token, settings.googleClientId);
    state.last = Date.now();
    saveState();
    return changes;
  })();
  try {
    const n = await running;
    running = null;
    refreshStatus();
    if (n) onRemote(n);
    if (again) {
      again = false;
      scheduleAuto(1000);
    }
    return n;
  } catch (e) {
    running = null;
    again = false;
    setStatus(gmail.hasValidToken() ? 'error' : 'auth', e.message);
    throw e;
  }
}

async function syncWith(token, localClientId) {
  // Toute modification faite pendant la synchronisation sera reprise à la suivante.
  state.dirty = false;
  saveState();
  const firstTime = !state.last;
  const files = await listFiles(token);
  const byName = new Map(files.map(f => [f.name, f]));
  const dataFile = byName.get(DATA_NAME);
  let remote = { records: {}, tombstones: [] };
  if (dataFile) {
    try {
      remote = JSON.parse(await (await download(token, dataFile.id)).text());
    } catch {
      throw new Error('Les données du Drive sont illisibles : synchronisation interrompue pour ne rien perdre.');
    }
  }

  // suppressions connues des deux côtés (on garde la plus récente)
  const tomb = new Map();
  for (const t of [...(remote.tombstones || []), ...(await db.all('tombstones'))]) {
    const prev = tomb.get(t.id);
    if (!prev || prev.deletedAt < t.deletedAt) tomb.set(t.id, t);
  }

  const merged = {};
  let applied = 0;
  for (const name of SYNC_STORES) {
    const local = new Map((await db.all(name)).map(r => [r.id, r]));
    const rem = new Map((remote.records?.[name] || []).map(r => [r.id, r]));
    const out = [];
    for (const id of new Set([...local.keys(), ...rem.keys()])) {
      const l = local.get(id);
      const r = rem.get(id);
      const lt = l?.updatedAt || 0;
      const rt = r?.updatedAt || 0;
      // la première fois sur un appareil, ce qui est déjà dans le Drive l'emporte en cas de doublon
      const remoteWins = r && (!l || rt > lt || (firstTime && rt !== lt));
      const win = remoteWins ? r : l;
      const t = tomb.get(name + '/' + id);
      if (t && t.deletedAt >= (win.updatedAt || 0)) {
        if (l) {
          await db.delRaw(name, id);
          applied++;
        }
        continue;
      }
      if (remoteWins) {
        const rec = { ...r };
        if (name === 'settings' && l?.googleClientId && !rec.googleClientId) rec.googleClientId = l.googleClientId;
        if (name === 'copies') {
          if (!r.pdfRev) rec.pdf = null;
          else if (l && l.pdfRev === r.pdfRev && l.pdf instanceof Blob) rec.pdf = l.pdf;
          else {
            const f = byName.get(pdfName(id, r.pdfRev));
            if (f) rec.pdf = new Blob([await download(token, f.id)], { type: 'application/pdf' });
            else {
              // PDF pas encore arrivé dans le Drive : on garde celui de l'appareil s'il existe
              rec.pdf = l?.pdf || null;
              rec.pdfRev = l?.pdf ? l.pdfRev : null;
            }
          }
        }
        await db.putRaw(name, rec);
        applied++;
      } else if (name === 'copies' && l.pdf instanceof Blob && l.pdfRev && !byName.has(pdfName(id, l.pdfRev))) {
        // PDF nouveau ou remplacé sur cet appareil : on l'envoie avant de publier les données
        const fid = await upload(token, { name: pdfName(id, l.pdfRev), blob: l.pdf });
        byName.set(pdfName(id, l.pdfRev), { id: fid, name: pdfName(id, l.pdfRev) });
      }
      const pub = { ...win };
      if (name === 'copies') delete pub.pdf;
      out.push(pub);
    }
    merged[name] = out;
  }

  // on retient les suppressions de moins d'un an (au-delà, plus aucun appareil ne devrait les ignorer)
  const yearAgo = Date.now() - 365 * 86400000;
  const tombstones = [...tomb.values()].filter(t => t.deletedAt > yearAgo);
  for (const t of tombstones) await db.putRaw('tombstones', t);

  const payload = { app: 'izinote-sync', version: 1, date: new Date().toISOString(), records: merged, tombstones };
  const sameAsRemote =
    dataFile && JSON.stringify(remote.records || {}) === JSON.stringify(merged) && (remote.tombstones || []).length === tombstones.length;
  if (!sameAsRemote) {
    await upload(token, { id: dataFile?.id, name: DATA_NAME, blob: new Blob([JSON.stringify(payload)], { type: 'application/json' }) });
  }

  // ménage : PDF qui ne servent plus à aucune copie
  const used = new Set(merged.copies.filter(c => c.pdfRev).map(c => pdfName(c.id, c.pdfRev)));
  for (const f of files) if (f.name.startsWith('pdf_') && !used.has(f.name)) await remove(token, f.id);

  // ID client propre à l'appareil (si les réglages viennent d'ailleurs, on garde celui qui marche ici)
  if (applied && localClientId) {
    const st = await db.get('settings', 'main');
    if (st && st.googleClientId !== localClientId) await db.putRaw('settings', { ...st, googleClientId: localClientId });
  }
  return applied;
}

// ---------- Synchronisation automatique ----------
let autoTimer = null;
function scheduleAuto(delay = AUTO_DELAY) {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => syncNow().catch(e => console.warn('Synchronisation :', e.message)), delay);
}
db.onChange(() => {
  if (!state.enabled) return;
  state.dirty = true;
  saveState();
  refreshStatus();
  if (gmail.hasValidToken()) scheduleAuto();
});
// quand on quitte l'appli (ou change d'appli), on envoie tout de suite ce qui reste
document.addEventListener('visibilitychange', () => {
  if (!state.enabled || !gmail.hasValidToken()) return;
  if (document.visibilityState === 'hidden' && state.dirty) scheduleAuto(0);
  if (document.visibilityState === 'visible') scheduleAuto(500);
});
// la connexion Google expire au bout d'une heure : on met l'indicateur à jour
setInterval(() => !running && refreshStatus(), 60000);

export async function enable(on) {
  state.enabled = !!on;
  if (on) state.dirty = true;
  saveState();
  refreshStatus();
  if (on) return syncNow({ interactive: true });
}

refreshStatus();
