// Envois programmés.
// Deux façons de faire :
//  - « relais Google » (conseillé) : un petit script Google Apps Script, installé une fois dans le Gmail
//    dédié, garde les mails et les envoie à l'heure prévue, même si la tablette est éteinte ;
//  - sans relais : l'appli garde la programmation et envoie elle-même à l'heure prévue si elle est ouverte,
//    sinon à la prochaine ouverture (avec un clic si Google redemande l'autorisation).
import * as db from './db.js';
import * as gmail from './gmail.js';
import { buildCorrectedPdf, correctedFileName } from './pdfexport.js';
import { computeResult, resultText, toast, esc, fullComment, progressPill } from './util.js';

export function mailVars(a, cls, s, c, settings) {
  const r = computeResult(a.grid, c?.evaluation || {});
  return {
    prenom: s.firstName || '',
    nom: s.lastName || '',
    devoir: a.title,
    classe: cls ? cls.name : '',
    note: r.short || '',
    evaluation: resultText(a.grid, c?.evaluation || {}),
    commentaire: fullComment(c) || '—',
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
    // Apps Script ne renvoie pas les en-têtes CORS sur ses pages d'erreur : le navigateur n'y voit qu'une erreur réseau.
    throw new Error(
      navigator.onLine === false
        ? 'Relais Google injoignable : pas de connexion internet.'
        : 'Relais Google injoignable. Le plus souvent : le code du relais a été modifié sans relancer « installer » (▶ Exécuter, puis accepter les autorisations), ou le déploiement n’est pas en accès « Tout le monde », ou l’URL n’est pas celle finissant par /exec. Voir Réglages › Relais.'
    );
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

// Autres envois programmés (ex. devoirs et rappels, homework.js), branchés sur le même planificateur.
//  source = { relayIds(): ids en attente via le relais, applyRelay(data): nb envoyés (+ ids à acquitter),
//             due(): [{ send(settings), fail(message) }] à envoyer maintenant depuis l'appli }
const sources = [];
export function registerSource(src) {
  sources.push(src);
}

// Mail « brut » (copie cachée, plusieurs pièces jointes) confié au relais. Demande un relais à jour (version 2).
export async function relayScheduleMail(st, mail) {
  await relayCall(st, {
    action: 'schedule',
    mail: {
      ...mail,
      fromName: st.teacherName || '',
      attachments: (mail.attachments || []).map(f => ({ name: f.name, type: f.type || 'application/octet-stream', b64: bytesToB64(f.bytes) })),
    },
  });
}
let relayVersion = null;
export async function relaySupportsBcc(st) {
  if (!hasRelay(st)) return false;
  if (relayVersion === null) relayVersion = (await relayCall(st, { action: 'ping' })).version || 1;
  return relayVersion >= 2;
}

// Récupère auprès du relais les envois effectués, et met les copies à jour.
export async function relaySync() {
  const st = await db.getSettings();
  if (!hasRelay(st)) return 0;
  const waiting = (await db.all('copies')).filter(c => c.scheduledVia === 'relay' && !c.sentAt);
  let others = 0;
  for (const src of sources) others += (await src.relayIds()).length;
  if (!waiting.length && !others) return 0;
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
  for (const src of sources) {
    const r = await src.applyRelay(data);
    n += r.n;
    ack.push(...r.ack);
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

// Tâches à envoyer maintenant : copies programmées + autres sources (devoirs, rappels…)
async function dueTasks() {
  const tasks = (await dueLocal())
    .filter(c => !c.scheduleError)
    .map(c => ({
      send: async st => {
        const [a, s] = await Promise.all([db.get('assignments', c.assignmentId), db.get('students', c.studentId)]);
        if (!a || !s || !s.email) throw Object.assign(new Error('élève ou adresse e-mail introuvable'), { final: true });
        await sendNow(a, await db.get('classes', a.classId), s, c, st);
      },
      fail: async msg => {
        c.scheduleError = msg;
        await db.put('copies', c);
      },
    }));
  for (const src of sources) tasks.push(...(await src.due()));
  return tasks;
}

async function sendDue(list) {
  if (running) return;
  running = true;
  const st = await db.getSettings();
  let ok = 0;
  hideBar();
  const pill = progressPill('Envoi programmé', list.length);
  try {
    for (const t of list) {
      try {
        await t.send(st);
        ok++;
        pill.ok();
      } catch (e) {
        if (!e.final && !gmail.hasValidToken()) break; // autorisation expirée : on redemandera un clic
        await t.fail(e.message);
        pill.fail(t.who || 'Envoi', e.message);
      }
    }
  } finally {
    running = false;
    pill.done('Envois programmés');
  }
  onChange();
  await checkScheduled();
}

// Relais installé : les copies programmées « dans l'appli » lui sont confiées (même celles déjà à l'heure),
// pour qu'elles partent seules, sans demander de connexion Google.
let handingOver = false;
async function handOverToRelay() {
  const st = await db.getSettings();
  if (!hasRelay(st) || handingOver) return 0;
  const list = (await db.all('copies')).filter(c => c.scheduledVia === 'local' && !c.sentAt && !c.scheduleError);
  if (!list.length) return 0;
  handingOver = true;
  let n = 0;
  try {
    for (const c of list) {
      const [a, s] = await Promise.all([db.get('assignments', c.assignmentId), db.get('students', c.studentId)]);
      if (!a || !s || !s.email) continue;
      const cls = await db.get('classes', a.classId);
      await relaySchedule(st, c, await prepareMail(a, cls, s, c, st), Math.max(c.scheduledAt, Date.now()));
      c.scheduledVia = 'relay';
      await db.put('copies', c);
      n++;
    }
  } catch (e) {
    console.warn('Relais :', e.message);
  } finally {
    handingOver = false;
  }
  if (n) onChange();
  return n;
}

export async function checkScheduled() {
  if (running) return;
  await handOverToRelay();
  const due = await dueTasks();
  if (!due.length) return hideBar();
  const st = await db.getSettings();
  if (!st.googleClientId) return hideBar();
  gmail.loadGis().catch(() => {});
  if (gmail.hasValidToken()) return sendDue(due);
  const b = bar();
  b.innerHTML = `<span>⏰ ${due.length} envoi${due.length > 1 ? 's programmés sont prêts' : ' programmé est prêt'} à partir.</span><button class="btn primary">Envoyer maintenant</button>${
    hasRelay(st) ? '' : '<a class="sched-hint" href="#/reglages">Pour que ça parte tout seul : installer le relais</a>'
  }`;
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
      .then(n => n && (toast(`${n} envoi${n > 1 ? 's programmés ont été effectués' : ' programmé a été effectué'} ✓`, 'success'), onChange()))
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

