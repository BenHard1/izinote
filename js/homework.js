// Devoirs à rendre : date de rendu, consignes, documents de travail, envoi aux élèves
// et rappels automatiques (1 semaine avant et le jour du rendu).
//
// Données ajoutées à l'évaluation :
//  - a.dueDate : date de rendu (AAAA-MM-JJ, la même que la « Date » de l'évaluation) ;
//  - a.brief   : { text, remind: ['j7', 'j0'], remindHour: '08:00', docsInReminders } ;
//  - a.docs    : documents de travail [{ id, name, type, size, blob }] (synchronisés à part, voir sync.js) ;
//  - a.handout : envoi aux élèves { recipients: [id élève], subject, body, sentAt, count } ;
//  - a.mails   : envois programmés [{ id, kind: 'send' | 'j7' | 'j0', sendAt, via: 'relay' | 'local', sentAt, error, skipped }].
// Un seul mail par envoi, élèves en copie cachée (comme « Envoyer un document »).
import * as db from './db.js';
import * as gmail from './gmail.js';
import * as sched from './schedule.js';
import { esc, $, $$, modal, toast, pickFiles, attachDictation, studentName, download, confirmBox, fmtDate, busy } from './util.js';

const MAX_MB = 24; // limite Gmail : 25 Mo par mail, encodage compris
const DAY = 86400000;
const sizeLabel = n => (n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' Ko' : (n / 1048576).toFixed(1).replace('.', ',') + ' Mo');

export const REMINDERS = [
  { kind: 'j7', label: '1 semaine avant', days: 7 },
  { kind: 'j1', label: 'la veille', days: 1 },
  { kind: 'j0', label: 'le jour J', days: 0 },
];
// Évaluation écrite en cours (contrôle) : les rappels annoncent le contrôle et ce qu'il faut réviser.
export const isExam = a => a.kind === 'controle';
const remLabel = (a, k) => (k === 'j0' ? (isExam(a) ? 'le jour du contrôle' : 'le jour du rendu') : REMINDERS.find(r => r.kind === k).label);
const mailLabel = (a, k) => (k === 'send' ? (isExam(a) ? 'Annonce du contrôle' : 'Envoi du devoir') : 'Rappel ' + remLabel(a, k));

const pad = n => String(n).padStart(2, '0');
const longDate = ymd => new Date(ymd + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const hourLabel = hm => {
  const [h, m] = (hm || '08:00').split(':');
  return `${+h} h${m && m !== '00' ? ' ' + m : ''}`;
};
const toLocalInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const startOfDay = ts => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const dueStart = a => new Date(a.dueDate + 'T00:00:00').getTime();

export const hasBrief = a => !!(a.brief || (a.docs && a.docs.length) || a.handout);
const briefOf = a => ({ text: '', remind: isExam(a) ? ['j7', 'j1'] : ['j7', 'j0'], remindHour: '08:00', docsInReminders: true, ...(a.brief || {}) });

export function reminderTime(a, kind) {
  const r = REMINDERS.find(x => x.kind === kind);
  const [h, m] = (briefOf(a).remindHour || '08:00').split(':').map(Number);
  const d = new Date(a.dueDate + 'T00:00:00');
  d.setDate(d.getDate() - r.days);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}

// « aujourd'hui », « demain », « dans une semaine, le mardi 18 novembre »… selon le moment de l'envoi
function whenText(a, at) {
  const n = Math.round((dueStart(a) - startOfDay(at)) / DAY);
  const d = longDate(a.dueDate);
  if (n <= 0) return `aujourd’hui (${d})`;
  if (n === 1) return `demain (${d})`;
  return `${n === 7 ? 'dans une semaine' : `dans ${n} jours`}, le ${d}`;
}

export function defaultSubject(a) {
  if (isExam(a)) return `Contrôle : ${a.title} – le ${longDate(a.dueDate)}`;
  return `${a.kind === 'projet' ? 'Projet' : 'Devoir'} : ${a.title} – à rendre le ${longDate(a.dueDate)}`;
}
export function defaultBody(a, settings) {
  const b = briefOf(a);
  const n = (a.docs || []).length;
  if (isExam(a))
    return [
      'Bonjour à tous,',
      `Le contrôle « ${a.title} » aura lieu le ${longDate(a.dueDate)}.`,
      b.text ? `À réviser :\n${b.text}` : '',
      n ? `Vous trouverez en pièce jointe le cours et les exercices à refaire.` : '',
      'Vous recevrez un rappel par mail avant le contrôle.',
      settings.teacherName ? `Bon courage,\n${settings.teacherName}` : 'Bon courage !',
    ]
      .filter(Boolean)
      .join('\n\n');
  return [
    'Bonjour à tous,',
    `Voici « ${a.title} », à rendre pour le ${longDate(a.dueDate)}.`,
    b.text ? `Consignes :\n${b.text}` : '',
    n ? `Vous trouverez ${n > 1 ? 'les documents de travail' : 'le document de travail'} en pièce jointe.` : '',
    'Vous recevrez un rappel par mail avant la date de rendu.',
    settings.teacherName ? `Bon travail,\n${settings.teacherName}` : 'Bon travail !',
  ]
    .filter(Boolean)
    .join('\n\n');
}
function reminderMail(a, kind, at, settings) {
  const b = briefOf(a);
  const docs = b.docsInReminders ? a.docs || [] : [];
  if (isExam(a)) {
    const n = Math.round((dueStart(a) - startOfDay(at)) / DAY);
    return {
      subject: `Rappel : contrôle « ${a.title} » ${n <= 0 ? 'aujourd’hui' : n === 1 ? 'demain' : 'le ' + longDate(a.dueDate)}`,
      body: [
        'Bonjour à tous,',
        `Petit rappel : le contrôle « ${a.title} » a lieu ${whenText(a, at)}.`,
        b.text ? `À réviser :\n${b.text}` : '',
        docs.length ? `Vous trouverez en pièce jointe le cours et les exercices à refaire.` : '',
        'Bon courage pour vos révisions !',
        settings.teacherName || '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      docs,
    };
  }
  return {
    subject: `Rappel : « ${a.title} » à rendre ${kind === 'j0' ? 'aujourd’hui' : 'le ' + longDate(a.dueDate)}`,
    body: [
      'Bonjour à tous,',
      `Petit rappel : « ${a.title} » est à rendre ${whenText(a, at)}.`,
      b.text ? `Consignes :\n${b.text}` : '',
      docs.length ? `Les documents de travail sont de nouveau joints à ce mail.` : '',
      'Si vous l’avez déjà rendu, ne tenez pas compte de ce message.',
      settings.teacherName || '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    docs,
  };
}

async function recipientsBcc(a) {
  const ids = a.handout?.recipients || [];
  const students = await db.by('students', 'classId', a.classId);
  return students
    .filter(s => ids.includes(s.id) && s.email)
    .map(s => s.email.trim())
    .join(', ');
}
async function docsAttachments(docs) {
  const out = [];
  for (const d of docs) {
    if (!(d.blob instanceof Blob)) throw Object.assign(new Error(`le document « ${d.name} » n’est pas encore arrivé sur cet appareil`), { final: true });
    out.push({ name: d.name, type: d.type || 'application/octet-stream', bytes: new Uint8Array(await d.blob.arrayBuffer()) });
  }
  return out;
}
// Mail complet d'un envoi (devoir ou rappel), prêt pour Gmail ou le relais
async function buildMail(a, kind, at, settings) {
  const bcc = await recipientsBcc(a);
  if (!bcc) throw Object.assign(new Error('aucun destinataire avec une adresse e-mail'), { final: true });
  if (kind === 'send') return { bcc, subject: a.handout.subject, body: a.handout.body, attachments: await docsAttachments(a.docs || []) };
  const r = reminderMail(a, kind, at, settings);
  return { bcc, subject: r.subject, body: r.body, attachments: await docsAttachments(r.docs) };
}

async function logMailing(a, at) {
  const cls = await db.get('classes', a.classId);
  if (!cls) return;
  cls.mailings = [{ at, subject: a.handout.subject, files: (a.docs || []).map(d => d.name), count: a.handout.count || 0 }, ...(cls.mailings || [])].slice(0, 50);
  await db.put('classes', cls);
}
function markSent(a, m, at) {
  m.sentAt = at;
  delete m.error;
  if (m.kind === 'send') a.handout.sentAt = at;
}

// ---------- Programmation des envois ----------
const pendingMails = a => (a.mails || []).filter(m => !m.sentAt && !m.skipped);

// Annule les envois pas encore partis (y compris chez le relais).
export async function cancelPending(a, { keepSend = false } = {}) {
  const list = pendingMails(a).filter(m => !(keepSend && m.kind === 'send'));
  const viaRelay = list.filter(m => m.via === 'relay').map(m => m.id);
  if (viaRelay.length) await sched.relayCancel(await db.getSettings(), viaRelay);
  a.mails = (a.mails || []).filter(m => !list.includes(m));
}

let warnedOldRelay = false;
// (Re)programme l'envoi différé éventuel et les rappels. sendAt : heure de l'envoi du devoir s'il est programmé.
export async function planMails(a, settings, { sendAt = null } = {}) {
  const keep = sendAt == null ? pendingMails(a).find(m => m.kind === 'send') : null;
  await cancelPending(a);
  const firstAt = sendAt || keep?.sendAt || 0;
  const plan = [];
  if (firstAt) plan.push({ kind: 'send', sendAt: firstAt });
  for (const kind of briefOf(a).remind) {
    const t = reminderTime(a, kind);
    if (t > Math.max(Date.now() + 60000, firstAt + 60000)) plan.push({ kind, sendAt: t });
  }
  let relay = false;
  try {
    relay = await sched.relaySupportsBcc(settings);
    if (!relay && sched.hasRelay(settings) && !warnedOldRelay) {
      warnedOldRelay = true;
      toast('Votre relais d’envoi programmé date d’avant les rappels : recopiez son code (Réglages) pour qu’ils partent même tablette éteinte. En attendant, IziNote les enverra lui-même.', 'error');
    }
  } catch (e) {
    console.warn(e);
  }
  a.mails = (a.mails || []).filter(m => m.sentAt || m.skipped);
  for (const p of plan) {
    const m = { id: `hw_${a.id}_${p.kind}_${db.uid()}`, kind: p.kind, sendAt: p.sendAt, via: 'local' };
    if (relay) {
      try {
        await sched.relayScheduleMail(settings, { id: m.id, sendAt: m.sendAt, ...(await buildMail(a, p.kind, p.sendAt, settings)) });
        m.via = 'relay';
      } catch (e) {
        console.warn(e);
        toast('Relais injoignable : ce rappel partira depuis IziNote. ' + e.message, 'error');
      }
    }
    a.mails.push(m);
  }
  return plan;
}

// Envoi du devoir tout de suite (le clic a déjà autorisé Gmail)
export async function sendNow(a, settings) {
  const at = Date.now();
  await gmail.sendMail(settings.googleClientId, await buildMail(a, 'send', at, settings));
  a.handout.sentAt = at;
  a.mails = (a.mails || []).filter(m => m.kind !== 'send' || m.sentAt);
  a.mails.push({ id: `hw_${a.id}_send_${db.uid()}`, kind: 'send', sendAt: at, via: 'now', sentAt: at });
  await logMailing(a, at);
}

// ---------- Branché sur le planificateur (schedule.js) ----------
async function withMails() {
  return (await db.all('assignments')).filter(a => a.mails && a.mails.length && a.dueDate && a.handout);
}

sched.registerSource({
  relayIds: async () => (await withMails()).flatMap(a => pendingMails(a).filter(m => m.via === 'relay').map(m => m.id)),
  applyRelay: async data => {
    let n = 0;
    const ack = [];
    for (const a of await withMails()) {
      let changed = false;
      for (const m of pendingMails(a).filter(m => m.via === 'relay')) {
        if (data.sent && data.sent[m.id]) {
          markSent(a, m, data.sent[m.id]);
          if (m.kind === 'send') await logMailing(a, m.sentAt);
          ack.push(m.id);
          changed = true;
          n++;
        } else if (data.errors && data.errors[m.id] && m.error !== data.errors[m.id]) {
          m.error = data.errors[m.id];
          changed = true;
        }
      }
      if (changed) await db.put('assignments', a);
    }
    return { n, ack };
  },
  due: async () => {
    const now = Date.now();
    const tasks = [];
    for (const a of await withMails()) {
      const due = pendingMails(a).filter(m => m.via === 'local' && !m.error && m.sendAt <= now);
      if (!due.length) continue;
      // IziNote fermé longtemps : on n'envoie pas un rappel dépassé (date passée, ou rappel plus récent aussi dû)
      let skipped = false;
      for (const m of due) {
        const late = m.kind !== 'send' && (now >= dueStart(a) + DAY || due.some(o => o.kind !== 'send' && o !== m && o.sendAt > m.sendAt));
        if (late) {
          m.skipped = true;
          skipped = true;
        }
      }
      if (skipped) await db.put('assignments', a);
      for (const m of due.filter(m => !m.skipped)) {
        tasks.push({
          send: async st => {
            const fresh = await db.get('assignments', a.id);
            const fm = fresh && (fresh.mails || []).find(x => x.id === m.id);
            if (!fm || fm.sentAt || fm.skipped) return;
            const at = Date.now();
            await gmail.sendMail(st.googleClientId, await buildMail(fresh, fm.kind, at, st));
            markSent(fresh, fm, at);
            if (fm.kind === 'send') await logMailing(fresh, at);
            await db.put('assignments', fresh);
          },
          fail: async msg => {
            const fresh = await db.get('assignments', a.id);
            const fm = fresh && (fresh.mails || []).find(x => x.id === m.id);
            if (!fm) return;
            fm.error = msg;
            await db.put('assignments', fresh);
          },
        });
      }
    }
    return tasks;
  },
});

// ---------- Affichage sur la page de l'évaluation ----------
const mailLine = a => m => `<li><b>${mailLabel(a, m.kind)}</b> ${mailTag(m)}</li>`;
function mailTag(m) {
  const when = sched.fmtDateTime(m.sentAt || m.sendAt);
  let st;
  if (m.sentAt) st = `<span class="tag sent">✓ envoyé ${esc(sched.fmtDateTime(m.sentAt))}</span>`;
  else if (m.skipped) st = `<span class="tag">non envoyé (date dépassée)</span>`;
  else if (m.error) st = `<span class="tag err" title="${esc(m.error)}">échec : ${esc(m.error)}</span>`;
  else st = `<span class="tag sched">⏰ ${esc(when)}</span><small class="muted"> ${m.via === 'relay' ? '· par le relais Google' : '· depuis IziNote'}</small>`;
  return st;
}

export function homeworkSection(a) {
  if (a.kind === 'oral' && !hasBrief(a)) return '';
  const exam = isExam(a);
  if (!hasBrief(a) && exam)
    return `<div class="hw-box hw-empty"><div><b>📝 Contrôle à préparer</b><p class="muted small">Indiquez la date du contrôle, le cours à réviser et joignez le cours et les exercices à refaire : les élèves recevront un rappel une semaine avant et la veille.</p></div>
      <button class="btn" id="hwEdit">Préparer les rappels</button></div>`;
  if (!hasBrief(a))
    return `<div class="hw-box hw-empty"><div><b>📌 Devoir à rendre</b><p class="muted small">Ajoutez la date de rendu, les consignes et les documents de travail, puis envoyez-les aux élèves avec des rappels automatiques (1 semaine avant et le jour J).</p></div>
      <button class="btn" id="hwEdit">Préparer le devoir</button></div>`;
  const b = briefOf(a);
  const h = a.handout;
  const mails = (a.mails || []).filter(m => !(m.kind === 'send' && m.sentAt));
  const planned = pendingMails(a);
  const remindTxt = b.remind.length ? `Rappels : ${b.remind.map(k => remLabel(a, k)).join(' et ')}, à ${hourLabel(b.remindHour)}` : 'Pas de rappel';
  return `<div class="hw-box">
    <div class="hw-head"><div><b>${exam ? '📝 ' + (a.dueDate ? 'Contrôle le ' + esc(longDate(a.dueDate)) : 'Date du contrôle à choisir') : '📌 ' + (a.dueDate ? 'À rendre le ' + esc(longDate(a.dueDate)) : 'Date de rendu à choisir')}</b><small class="muted">${esc(remindTxt)}</small></div>
      <div class="row wrap"><button class="btn small" id="hwEdit">✎ Modifier</button>${
        exam
          ? `<button class="btn small ${h ? '' : 'primary'}" id="hwSend">🔔 ${h ? 'Reprogrammer les rappels' : 'Programmer les rappels'}</button>`
          : `<button class="btn small ${h && h.sentAt ? '' : 'primary'}" id="hwSend">✉ ${h && h.sentAt ? 'Renvoyer' : 'Envoyer aux élèves'}</button>`
      }</div></div>
    ${b.text ? `<p class="hw-text">${esc(b.text)}</p>` : ''}
    ${(a.docs || []).length ? `<div class="file-chips">${a.docs.map(d => `<button type="button" class="chip file-chip" data-doc="${d.id}" title="Ouvrir">📄 ${esc(d.name)} <small>${sizeLabel(d.size || 0)}</small></button>`).join('')}</div>` : ''}
    <ul class="hw-status">
      ${exam ? (h && h.sentAt ? `<li><b>Annonce envoyée</b> <span class="tag sent">✓ ${esc(fmtDate(h.sentAt))} · ${h.count} élève${h.count > 1 ? 's' : ''}</span></li>` : !h ? '<li class="muted">Rappels pas encore programmés.</li>' : '') : h && h.sentAt ? `<li><b>Devoir envoyé</b> <span class="tag sent">✓ ${esc(fmtDate(h.sentAt))} · ${h.count} élève${h.count > 1 ? 's' : ''}</span></li>` : !planned.some(m => m.kind === 'send') ? '<li class="muted">Pas encore envoyé aux élèves.</li>' : ''}
      ${mails.map(mailLine(a)).join('')}
    </ul>
    ${planned.length ? '<button type="button" class="linkbtn" id="hwCancel">Annuler les envois programmés</button>' : ''}
  </div>`;
}

export function bindHomework(a, students, refresh) {
  const edit = $('#hwEdit');
  if (edit) edit.onclick = () => editBrief(a, students, refresh);
  const send = $('#hwSend');
  if (send) send.onclick = () => sendDialog(a, students, refresh);
  $$('[data-doc]').forEach(b => {
    b.onclick = () => {
      const d = a.docs.find(x => x.id === b.dataset.doc);
      if (d && d.blob instanceof Blob) download(d.blob, d.name);
      else toast('Ce document n’est pas encore arrivé sur cet appareil (synchronisation en cours).', 'error');
    };
  });
  const cancel = $('#hwCancel');
  if (cancel)
    cancel.onclick = async () => {
      if (!(await confirmBox('Annuler les envois programmés', 'Le devoir et les rappels qui ne sont pas encore partis ne seront pas envoyés.', 'Annuler les envois', true))) return;
      try {
        await cancelPending(a);
        await db.put('assignments', a);
        toast('Envois programmés annulés');
      } catch (e) {
        toast(e.message, 'error');
      }
      refresh();
    };
}

// ---------- Préparer le devoir ----------
export async function editBrief(a, students, refresh) {
  const b = briefOf(a);
  const docs = [...(a.docs || [])];
  const ok = await modal({
    title: `${isExam(a) ? 'Contrôle' : 'Devoir à rendre'} – ${a.title}`,
    wide: true,
    body: `
      <label class="field"><span>${isExam(a) ? 'Date du contrôle' : 'Date de rendu'}</span><input class="input" type="date" id="hwDue" value="${esc(a.dueDate || '')}" style="max-width:220px"></label>
      <label class="field"><span>${isExam(a) ? 'À réviser' : 'Consignes'} <small class="muted">(repris dans les mails aux élèves)</small></span><textarea class="input" id="hwText" rows="5" placeholder="${isExam(a) ? 'Ex. Chapitre 3 (les fonctions affines), refaire les exercices 2, 5 et 8 page 64.' : 'Ex. Faire les exercices 1 à 4 page 52. Rendre un PDF ou une photo lisible.'}">${esc(b.text)}</textarea></label>
      <div class="row wrap"><button type="button" class="btn small" id="hwMic">🎙 Dicter</button></div>
      <div class="field"><span>${isExam(a) ? 'Cours et exercices à refaire' : 'Documents de travail'}</span>
        <div id="hwFiles" class="file-chips"></div>
        <div class="row wrap"><button type="button" class="btn" id="hwAdd">📎 Ajouter des fichiers</button><span class="muted small" id="hwSize"></span></div>
      </div>
      <div class="field"><span>Rappels par mail aux élèves</span>
        ${REMINDERS.map(r => `<label class="check"><input type="checkbox" data-rem="${r.kind}" ${b.remind.includes(r.kind) ? 'checked' : ''}> ${remLabel(a, r.kind)}</label>`).join('')}
        <label class="field inline"><span>à</span><input class="input" type="time" id="hwHour" value="${esc(b.remindHour)}" style="max-width:140px"></label>
        <label class="check"><input type="checkbox" id="hwDocsRem" ${b.docsInReminders ? 'checked' : ''}> Joindre de nouveau les documents aux rappels</label>
      </div>`,
    actions: [{ label: 'Annuler', value: null }, { label: 'Enregistrer', value: 'save', cls: 'primary' }],
    onOpen: w => {
      attachDictation($('#hwMic', w), $('#hwText', w));
      const render = () => {
        $('#hwFiles', w).innerHTML = docs
          .map((d, i) => `<span class="chip file-chip">📄 ${esc(d.name)} <small>${sizeLabel(d.size)}</small><button type="button" class="linkbtn" data-rm="${i}" title="Retirer">✕</button></span>`)
          .join('');
        const t = docs.reduce((n, d) => n + (d.size || 0), 0);
        const el = $('#hwSize', w);
        el.textContent = docs.length ? `Total : ${sizeLabel(t)}${t > MAX_MB * 1048576 ? ` – trop lourd pour un mail (max. ${MAX_MB} Mo)` : ''}` : 'Aucun document pour l’instant.';
        el.classList.toggle('warn', t > MAX_MB * 1048576);
        $$('[data-rm]', w).forEach(x => (x.onclick = () => (docs.splice(+x.dataset.rm, 1), render())));
      };
      render();
      $('#hwAdd', w).onclick = async () => {
        for (const f of await pickFiles({ accept: '', multiple: true })) docs.push({ id: db.uid(), name: f.name, type: f.type || 'application/octet-stream', size: f.size, blob: f });
        render();
      };
    },
    validate: (v, w) => {
      const due = $('#hwDue', w).value;
      if (!due) return toast('Choisissez la date de rendu.', 'error'), false;
      if (docs.reduce((n, d) => n + (d.size || 0), 0) > MAX_MB * 1048576) return toast(`Les documents dépassent ${MAX_MB} Mo : un mail ne peut pas les contenir.`, 'error'), false;
      a.dueDate = due;
      a.brief = {
        text: $('#hwText', w).value.trim(),
        remind: $$('[data-rem]:checked', w).map(i => i.dataset.rem),
        remindHour: $('#hwHour', w).value || '08:00',
        docsInReminders: $('#hwDocsRem', w).checked,
      };
      return true;
    },
  });
  if (!ok) return;
  // les fichiers choisis deviennent des Blob simples (stockables dans IndexedDB)
  a.docs = docs.map(d => ({ ...d, blob: d.blob instanceof File ? new Blob([d.blob], { type: d.type }) : d.blob }));
  if (a.handout) {
    const b2 = busy('Mise à jour des rappels…');
    try {
      await planMails(a, await db.getSettings());
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      b2.done();
    }
  }
  await db.put('assignments', a);
  toast(isExam(a) ? 'Contrôle enregistré ✓' : 'Devoir enregistré ✓', 'success');
  refresh();
}

// ---------- Envoyer aux élèves ----------
export async function sendDialog(a, students, refresh) {
  if (!a.dueDate || !a.brief) return editBrief(a, students, refresh);
  const settings = await db.getSettings();
  if (!settings.googleClientId) return toast('Reliez d’abord votre Gmail dédié dans les Réglages.', 'error');
  gmail.loadGis().catch(e => toast(e.message, 'error'));
  const withMail = students.filter(s => s.email);
  const without = students.filter(s => !s.email);
  const prev = a.handout?.recipients;
  const docs = a.docs || [];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  const b = briefOf(a);
  const remLines = b.remind.length
    ? b.remind
        .map(k => {
          const t = reminderTime(a, k);
          return `<li>${remLabel(a, k)} : <b>${esc(sched.fmtDateTime(t))}</b>${t <= Date.now() ? ' <small class="muted">(déjà passé, pas envoyé)</small>' : ''}</li>`;
        })
        .join('')
    : '<li class="muted">Aucun rappel (modifiable avec « ✎ Modifier »).</li>';

  const exam = isExam(a);
  await modal({
    title: `${exam ? 'Rappels du contrôle' : 'Envoyer le devoir'} – ${a.title}`,
    wide: true,
    body: `
      <p class="muted">${exam ? 'Les rappels partent aux élèves cochés, en <b>copie cachée</b>, avec ce qu’il faut réviser et les documents.' : 'Un seul mail, avec les élèves en <b>copie cachée</b>. Les rappels partent aux mêmes élèves.'}</p>
      ${exam ? `<label class="check"><input type="checkbox" id="hsNow"> ✉ Envoyer aussi une annonce maintenant</label>` : ''}
      <div id="hsAnn" ${exam ? 'hidden' : ''}>
      <label class="field"><span>Objet</span><input class="input" id="hsSubject" value="${esc(a.handout?.subject || defaultSubject(a))}"></label>
      <label class="field"><span>Message</span><textarea class="input" id="hsBody" rows="9">${esc(defaultBody(a, settings))}</textarea></label>
      <div class="row wrap"><button type="button" class="btn small" id="hsMic">🎙 Dicter</button></div>
      </div>
      <div class="field"><span>Pièces jointes</span>${
        docs.length
          ? `<div class="file-chips">${docs.map(d => `<span class="chip file-chip">📄 ${esc(d.name)} <small>${sizeLabel(d.size || 0)}</small></span>`).join('')}</div>`
          : '<span class="muted small">Aucun document de travail (ajoutez-en avec « ✎ Modifier »).</span>'
      }</div>
      <div class="field"><span>Destinataires <small class="muted" id="hsCount"></small></span>
        <div class="row wrap"><button type="button" class="linkbtn" id="hsAll">tout cocher</button> · <button type="button" class="linkbtn" id="hsNone">tout décocher</button></div>
        <div class="send-list">${withMail
          .map(s => `<label class="send-row"><input type="checkbox" data-s="${s.id}" ${!prev || prev.includes(s.id) ? 'checked' : ''}><span class="sr-name">${esc(studentName(s))}<small>${esc(s.email)}</small></span></label>`)
          .join('')}${without.map(s => `<label class="send-row disabled"><input type="checkbox" disabled><span class="sr-name">${esc(studentName(s))}<small>pas d’e-mail</small></span></label>`).join('')}</div>
      </div>
      <div class="sched-box">
        <b>🔔 Rappels automatiques</b>
        <ul class="hw-status">${remLines}</ul>
        <p class="muted small">${
          sched.hasRelay(settings)
            ? 'Ils partent de votre Gmail par le relais Google, même si la tablette est éteinte.'
            : 'Ils partent si IziNote est ouvert à ce moment-là, sinon à la prochaine ouverture. Pour qu’ils partent même tablette éteinte, activez le « relais d’envoi programmé » dans les Réglages.'
        }</p>
        ${exam ? '' : `<label class="check"><input type="checkbox" id="schedOn"> ⏰ Programmer aussi l’envoi du devoir pour plus tard</label>`}
        <div id="schedFields" hidden><input class="input" type="datetime-local" id="schedAt" value="${toLocalInput(tomorrow)}"></div>
      </div>`,
    actions: [{ label: 'Annuler', value: null }, { label: exam ? 'Programmer les rappels' : 'Envoyer', value: 'send', cls: 'primary' }],
    onOpen: (w, close) => {
      attachDictation($('#hsMic', w), $('#hsBody', w));
      const nowBox = $('#hsNow', w);
      if (nowBox)
        nowBox.onchange = () => {
          $('#hsAnn', w).hidden = !nowBox.checked;
          $('.modal-actions .primary', w).textContent = nowBox.checked ? 'Envoyer et programmer' : 'Programmer les rappels';
        };
      const count = () => ($('#hsCount', w).textContent = `(${$$('input[data-s]:checked', w).length} / ${withMail.length})`);
      count();
      w.addEventListener('change', e => e.target.matches('input[data-s]') && count());
      $('#hsAll', w).onclick = () => ($$('input[data-s]', w).forEach(i => (i.checked = true)), count());
      $('#hsNone', w).onclick = () => ($$('input[data-s]', w).forEach(i => (i.checked = false)), count());
      const sendBtn = $('.modal-actions .primary', w);
      const schedOn = $('#schedOn', w) || { checked: false };
      schedOn.onchange = () => {
        $('#schedFields', w).hidden = !schedOn.checked;
        sendBtn.textContent = schedOn.checked ? 'Programmer' : 'Envoyer';
      };
      sendBtn.onclick = async () => {
        const subject = $('#hsSubject', w).value.trim();
        const body = $('#hsBody', w).value;
        const ids = $$('input[data-s]:checked', w).map(i => i.dataset.s);
        if (!subject) return toast('Indiquez un objet.', 'error');
        if (!ids.length) return toast('Aucun destinataire coché.', 'error');
        if (docs.some(d => !(d.blob instanceof Blob))) return toast('Un document n’est pas encore arrivé sur cet appareil : attendez la synchronisation.', 'error');
        const later = schedOn.checked;
        const announce = !exam || nowBox.checked; // contrôle : l'annonce immédiate est facultative
        if (exam && !announce && !b.remind.some(k => reminderTime(a, k) > Date.now() + 60000))
          return toast('Aucun rappel à venir : vérifiez la date du contrôle et les rappels cochés (« ✎ Modifier »).', 'error');
        let when = 0;
        if (later) {
          when = new Date($('#schedAt', w).value).getTime();
          if (!when || isNaN(when)) return toast('Choisissez une date et une heure.', 'error');
          if (when < Date.now() + 60000) return toast('Choisissez un moment dans le futur.', 'error');
        }
        sendBtn.disabled = true;
        if (!later && announce) {
          try {
            await gmail.authorize(settings.googleClientId); // dans le clic : la fenêtre Google peut s'ouvrir
          } catch (e) {
            sendBtn.disabled = false;
            return toast(e.message, 'error');
          }
        }
        const label0 = sendBtn.textContent;
        sendBtn.textContent = later || !announce ? 'Programmation…' : 'Envoi…';
        try {
          const prevSent = a.handout?.sentAt || null;
          a.handout = { recipients: ids, subject, body, sentAt: null, count: ids.length };
          if (later) {
            await planMails(a, settings, { sendAt: when });
          } else if (!announce) {
            if (a.handout && prevSent) a.handout.sentAt = prevSent;
            await planMails(a, settings);
          } else {
            await sendNow(a, settings);
            await db.put('assignments', a); // le mail est parti : on l'enregistre avant de programmer les rappels
            try {
              await planMails(a, settings);
            } catch (e) {
              toast('Rappels non programmés : ' + e.message, 'error');
            }
          }
          await db.put('assignments', a);
          const n = pendingMails(a).filter(m => m.kind !== 'send').length;
          toast(
            !announce
              ? `${n} rappel${n > 1 ? 's' : ''} programmé${n > 1 ? 's' : ''} pour ${ids.length} élève${ids.length > 1 ? 's' : ''} ✓`
              : `${later ? `Devoir programmé pour ${sched.fmtDateTime(when)}` : `Devoir envoyé à ${ids.length} élève${ids.length > 1 ? 's' : ''}`}${n ? ` · ${n} rappel${n > 1 ? 's' : ''} programmé${n > 1 ? 's' : ''}` : ''} ✓`,
            'success'
          );
          close(true);
        } catch (e) {
          console.error(e);
          toast(e.message, 'error');
          sendBtn.disabled = false;
          sendBtn.textContent = label0;
        }
      };
    },
  });
  refresh();
}
