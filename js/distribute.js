// Envoi de documents à toute une classe (liste de distribution).
// Un seul mail, avec les élèves en copie cachée (Cci) : chacun le reçoit sans voir les adresses des autres,
// et les pièces jointes ne sont envoyées qu'une fois.
import * as db from './db.js';
import * as gmail from './gmail.js';
import { esc, $, $$, modal, toast, pickFiles, attachDictation, studentName, fmtDate } from './util.js';

const MAX_MB = 24; // limite Gmail : 25 Mo par mail, encodage compris
const sizeMb = n => (n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' Ko' : (n / 1048576).toFixed(1).replace('.', ',') + ' Mo');

export async function distributeDialog(cls, students, onDone) {
  const settings = await db.getSettings();
  if (!settings.googleClientId) {
    toast('Reliez d’abord votre Gmail dédié dans les Réglages.', 'error');
    return;
  }
  gmail.loadGis().catch(e => toast(e.message, 'error'));
  const withMail = students.filter(s => s.email);
  const without = students.filter(s => !s.email);
  const files = [];
  const sign = settings.teacherName ? `\n\n${settings.teacherName}` : '';

  await modal({
    title: `Envoyer un document – ${cls.name}`,
    wide: true,
    body: `
      <p class="muted">Un seul mail est envoyé, avec les élèves en <b>copie cachée</b> : chacun le reçoit sans voir les adresses des autres.</p>
      <label class="field"><span>Objet</span><input class="input" id="dSubject" placeholder="Ex. Cours du 12 novembre"></label>
      <label class="field"><span>Message</span><textarea class="input" id="dBody" rows="6">Bonjour à tous,\n\nVous trouverez ci-joint \n${esc(sign)}</textarea></label>
      <div class="row wrap"><button type="button" class="btn small" id="dMic">🎙 Dicter</button></div>
      <div class="field"><span>Pièces jointes</span>
        <div id="dFiles" class="file-chips"></div>
        <div class="row wrap"><button type="button" class="btn" id="dAdd">📎 Ajouter des fichiers</button><span class="muted small" id="dSize"></span></div>
      </div>
      <div class="field"><span>Destinataires <small class="muted" id="dCount"></small></span>
        <div class="row wrap"><button type="button" class="linkbtn" id="dAll">tout cocher</button> · <button type="button" class="linkbtn" id="dNone">tout décocher</button></div>
        <div class="send-list">${withMail
          .map(s => `<label class="send-row"><input type="checkbox" data-s="${s.id}" checked><span class="sr-name">${esc(studentName(s))}<small>${esc(s.email)}</small></span></label>`)
          .join('')}${without.map(s => `<label class="send-row disabled"><input type="checkbox" disabled><span class="sr-name">${esc(studentName(s))}<small>pas d’e-mail</small></span></label>`).join('')}</div>
      </div>`,
    actions: [{ label: 'Annuler', value: null }, { label: 'Envoyer', value: 'send', cls: 'primary' }],
    onOpen: (w, close) => {
      attachDictation($('#dMic', w), $('#dBody', w));
      const count = () => ($('#dCount', w).textContent = `(${$$('input[data-s]:checked', w).length} / ${withMail.length})`);
      count();
      w.addEventListener('change', e => e.target.matches('input[data-s]') && count());
      $('#dAll', w).onclick = () => ($$('input[data-s]', w).forEach(i => (i.checked = true)), count());
      $('#dNone', w).onclick = () => ($$('input[data-s]', w).forEach(i => (i.checked = false)), count());
      const total = () => files.reduce((n, f) => n + f.size, 0);
      const renderFiles = () => {
        $('#dFiles', w).innerHTML = files
          .map((f, i) => `<span class="chip file-chip">📄 ${esc(f.name)} <small>${sizeMb(f.size)}</small><button type="button" class="linkbtn" data-rm="${i}" title="Retirer">✕</button></span>`)
          .join('');
        const t = total();
        const el = $('#dSize', w);
        el.textContent = files.length ? `Total : ${sizeMb(t)}${t > MAX_MB * 1048576 ? ` – trop lourd pour Gmail (max. ${MAX_MB} Mo)` : ''}` : 'Aucun fichier (vous pouvez aussi envoyer un simple message).';
        el.classList.toggle('warn', t > MAX_MB * 1048576);
        $$('[data-rm]', w).forEach(b => (b.onclick = () => (files.splice(+b.dataset.rm, 1), renderFiles())));
      };
      renderFiles();
      $('#dAdd', w).onclick = async () => {
        const picked = await pickFiles({ accept: '', multiple: true });
        files.push(...picked);
        renderFiles();
      };
      const sendBtn = $('.modal-actions .primary', w);
      sendBtn.onclick = async () => {
        const subject = $('#dSubject', w).value.trim();
        const body = $('#dBody', w).value;
        const ids = $$('input[data-s]:checked', w).map(i => i.dataset.s);
        if (!subject) return toast('Indiquez un objet.', 'error');
        if (!ids.length) return toast('Aucun destinataire coché.', 'error');
        if (total() > MAX_MB * 1048576) return toast(`Les pièces jointes dépassent ${MAX_MB} Mo : retirez-en ou envoyez en plusieurs fois.`, 'error');
        sendBtn.disabled = true;
        try {
          await gmail.authorize(settings.googleClientId); // dans le clic : la fenêtre Google peut s'ouvrir
        } catch (e) {
          sendBtn.disabled = false;
          return toast(e.message, 'error');
        }
        sendBtn.textContent = 'Envoi…';
        try {
          const attachments = await Promise.all(files.map(async f => ({ name: f.name, type: f.type || 'application/octet-stream', bytes: new Uint8Array(await f.arrayBuffer()) })));
          const bcc = withMail.filter(s => ids.includes(s.id)).map(s => s.email.trim()).join(', ');
          await gmail.sendMail(settings.googleClientId, { bcc, subject, body, attachments });
          const fresh = (await db.get('classes', cls.id)) || cls;
          fresh.mailings = [{ at: Date.now(), subject, files: files.map(f => f.name), count: ids.length }, ...(fresh.mailings || [])].slice(0, 50);
          await db.put('classes', fresh);
          toast(`Document envoyé à ${ids.length} élève${ids.length > 1 ? 's' : ''} ✓`, 'success');
          close(true);
          onDone && onDone();
        } catch (e) {
          console.error(e);
          toast(e.message, 'error');
          sendBtn.disabled = false;
          sendBtn.textContent = 'Envoyer';
        }
      };
    },
  });
}

export function mailingsSection(cls) {
  const list = cls.mailings || [];
  if (!list.length) return '';
  return `<details class="archive"><summary>✉ Documents envoyés <small class="muted">(${list.length})</small></summary>
    <div class="list">${list
      .map(
        m => `<div class="list-item"><div class="li-main"><b>${esc(m.subject)}</b><small>${fmtDate(m.at)} · ${m.count} élève${m.count > 1 ? 's' : ''}${m.files.length ? ' · ' + esc(m.files.join(', ')) : ''}</small></div></div>`
      )
      .join('')}</div></details>`;
}
