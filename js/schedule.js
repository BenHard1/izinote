// Envois programmés.
// Deux façons de faire :
//  - « relais Google » (conseillé) : un petit script Google Apps Script, installé une fois dans le Gmail
//    dédié, garde les mails et les envoie à l'heure prévue, même si la tablette est éteinte ;
//  - sans relais : l'appli garde la programmation et envoie elle-même à l'heure prévue si elle est ouverte,
//    sinon à la prochaine ouverture (avec un clic si Google redemande l'autorisation).
import * as db from './db.js';
import * as gmail from './gmail.js';
import { buildCorrectedPdf, correctedFileName } from './pdfexport.js';
import { computeResult, resultText, toast, esc } from './util.js';

export function mailVars(a, cls, s, c, settings) {
  const r = computeResult(a.grid, c?.evaluation || {});
  return {
    prenom: s.firstName || '',
    nom: s.lastName || '',
    devoir: a.title,
    classe: cls ? cls.name : '',
    note: r.short || '',
    evaluation: resultText(a.grid, c?.evaluation || {}),
    commentaire: (c?.comment || '').trim() || '—',
    professeur: settings.teacherName || '',
  };
}

export async function prepareMail(a, cls, s, c, settings) {
  const bytes = await buildCorrectedPdf({ copy: c, student: s, assignment: a, cls, settings });
  const v = mailVars(a, cls, s, c, settings);
  return {
    to: s.email,
    subject: gmail.fillTemplate(settings.mailSubject, v),
    body: gmail.fillTemplate(settings.mailBody, v),
    attachment: { name: correctedFileName(s, a), bytes },
  };
}

// Envoi immédiat d'une copie (Gmail depuis le navigateur)
export async function sendNow(a, cls, s, c, settings) {
  const msg = await prepareMail(a, cls, s, c, settings);
  await gmail.sendMail(settings.googleClientId, msg);
  c.sentAt = Date.now();
  clearSchedule(c);
  await db.put('copies', c);
}

export function clearSchedule(c) {
  delete c.scheduledAt;
  delete c.scheduledVia;
  delete c.scheduleError;
}

export const fmtDateTime = ts =>
  new Date(ts).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// ---------- Relais Google Apps Script ----------
const hasRelay = st => !!(st.relayUrl && st.relaySecret);
export { hasRelay };

async function relayCall(st, payload) {
  // Corps en text/plain : pas de requête préalable CORS, ce qu'Apps Script ne sait pas gérer.
  let res;
  try {
    res = await fetch(st.relayUrl, { method: 'POST', body: JSON.stringify({ secret: st.relaySecret, ...payload }), redirect: 'follow' });
  } catch {
    throw new Error('Relais Google injoignable (connexion internet ? adresse du relais ?).');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new Error('Le relais Google a répondu de façon inattendue : vérifiez qu’il est déployé avec l’accès « Tout le monde ».');
  }
  if (!data.ok) throw new Error('Relais Google : ' + (data.error || 'erreur'));
  return data;
}

export const relayTest = st => relayCall(st, { action: 'ping' });

function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function relaySchedule(st, c, msg, sendAt) {
  await relayCall(st, {
    action: 'schedule',
    mail: {
      id: c.id,
      sendAt,
      to: msg.to,
      subject: msg.subject,
      body: msg.body,
      fromName: st.teacherName || '',
      fileName: msg.attachment.name,
      pdf: bytesToB64(msg.attachment.bytes),
    },
  });
}

export const relayCancel = (st, ids) => relayCall(st, { action: 'cancel', ids });

// Récupère auprès du relais les envois effectués, et met les copies à jour.
export async function relaySync() {
  const st = await db.getSettings();
  if (!hasRelay(st)) return 0;
  const waiting = (await db.all('copies')).filter(c => c.scheduledVia === 'relay' && !c.sentAt);
  if (!waiting.length) return 0;
  const data = await relayCall(st, { action: 'status' });
  let n = 0;
  const ack = [];
  for (const c of waiting) {
    if (data.sent && data.sent[c.id]) {
      c.sentAt = data.sent[c.id];
      clearSchedule(c);
      await db.put('copies', c);
      ack.push(c.id);
      n++;
    } else if (data.errors && data.errors[c.id]) {
      c.scheduleError = data.errors[c.id];
      await db.put('copies', c);
    }
  }
  if (ack.length) await relayCall(st, { action: 'ack', ids: ack }).catch(() => {});
  return n;
}

// ---------- Programmation dans l'appli (sans relais) ----------
let running = false;
let onChange = () => {};
export function onScheduleChange(fn) {
  onChange = fn;
}

async function dueLocal() {
  const now = Date.now();
  return (await db.all('copies')).filter(c => c.scheduledVia === 'local' && !c.sentAt && c.scheduledAt <= now);
}

function bar() {
  let b = document.getElementById('schedBar');
  if (!b) {
    b = document.createElement('div');
    b.id = 'schedBar';
    b.className = 'sched-bar';
    document.body.appendChild(b);
  }
  return b;
}
function hideBar() {
  const b = document.getElementById('schedBar');
  if (b) b.remove();
}

async function sendDue(list) {
  if (running) return;
  running = true;
  const st = await db.getSettings();
  let ok = 0;
  const b = bar();
  try {
    for (const c of list) {
      b.innerHTML = `<span>⏰ Envoi programmé ${ok + 1} / ${list.length}…</span>`;
      const [a, s] = await Promise.all([db.get('assignments', c.assignmentId), db.get('students', c.studentId)]);
      if (!a || !s || !s.email) {
        c.scheduleError = 'élève ou adresse e-mail introuvable';
        await db.put('copies', c);
        continue;
      }
      const cls = await db.get('classes', a.classId);
      try {
        await sendNow(a, cls, s, c, st);
        ok++;
      } catch (e) {
        if (!gmail.hasValidToken()) break; // autorisation expirée : on redemandera un clic
        c.scheduleError = e.message;
        await db.put('copies', c);
      }
    }
  } finally {
    running = false;
  }
  if (ok) toast(`${ok} correction${ok > 1 ? 's' : ''} programmée${ok > 1 ? 's' : ''} envoyée${ok > 1 ? 's' : ''} ✓`, 'success');
  onChange();
  await checkScheduled();
}

export async function checkScheduled() {
  if (running) return;
  const due = (await dueLocal()).filter(c => !c.scheduleError);
  if (!due.length) return hideBar();
  const st = await db.getSettings();
  if (!st.googleClientId) return hideBar();
  gmail.loadGis().catch(() => {});
  if (gmail.hasValidToken()) return sendDue(due);
  const b = bar();
  b.innerHTML = `<span>⏰ ${due.length} correction${due.length > 1 ? 's programmées sont prêtes' : ' programmée est prête'} à partir.</span><button class="btn primary">Envoyer maintenant</button>`;
  b.querySelector('button').onclick = async () => {
    try {
      await gmail.authorize(st.googleClientId); // dans le clic : la fenêtre Google peut s'ouvrir
    } catch (e) {
      return toast(e.message, 'error');
    }
    sendDue(due);
  };
}

export function startScheduler() {
  const tick = () => {
    checkScheduled().catch(e => console.error(e));
    relaySync()
      .then(n => n && (toast(`${n} correction${n > 1 ? 's programmées ont été envoyées' : ' programmée a été envoyée'} ✓`, 'success'), onChange()))
      .catch(e => console.warn(e));
  };
  tick();
  setInterval(() => checkScheduled().catch(e => console.error(e)), 30000);
  setInterval(() => relaySync().then(n => n && onChange()).catch(() => {}), 5 * 60000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tick());
}

export function scheduleTag(c) {
  if (!c || c.sentAt || !c.scheduledAt) return '';
  if (c.scheduleError) return `<span class="tag err" title="${esc(c.scheduleError)}">Envoi programmé en échec</span>`;
  return `<span class="tag sched">⏰ ${esc(fmtDateTime(c.scheduledAt))}</span>`;
}

