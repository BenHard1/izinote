// Saisie des notes en liste : une ligne par élève (nom + note), sans ouvrir la fiche de chacun.
// « 📸 Photographier une liste » : IziNote lit une liste papier (nom + note) et pré-remplit les notes,
// à vérifier avant d'enregistrer.
//
// Utilisable quand la grille est une simple note (un seul critère en points), comme pour
// l'évaluation écrite en cours. La note saisie est la valeur de ce critère.
import * as db from './db.js';
import { readLines } from './gridimport.js';
import { esc, $, $$, modal, toast, pickFiles, studentName, normalize, fmtNum, parseNum, busy, markOf } from './util.js';

export const canListGrades = a => !!(a.grid && a.grid.mode === 'note' && a.grid.criteria && a.grid.criteria.length === 1) && a.kind !== 'groupe';

// ---------- Lecture d'une liste (texte reconnu) ----------
// Distance d'édition (pour tolérer les petites erreurs de lecture : « Dupond » / « Dupont »)
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length,
    n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const words = s =>
  normalize(s)
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/[\s'-]+/)
    .filter(w => w.length >= 2);
// Un mot du nom de l'élève se retrouve-t-il dans la ligne ? (1 erreur tolérée à partir de 4 lettres, 2 à partir de 8)
function nameScore(nameWords, lineWords) {
  if (!nameWords.length) return 0;
  let hit = 0;
  for (const nw of nameWords) {
    const tol = nw.length >= 8 ? 2 : nw.length >= 4 ? 1 : 0;
    if (lineWords.some(lw => lw === nw || (tol && Math.abs(lw.length - nw.length) <= tol && lev(lw, nw) <= tol))) hit++;
  }
  return hit / nameWords.length;
}

// Corrige les confusions courantes de la reconnaissance dans les nombres (O → 0, l / I → 1, S → 5…)
const fixDigits = s => s.replace(/[Oo]/g, '0').replace(/[lI|!]/g, '1').replace(/[Ss]/g, '5').replace(/[B]/g, '8');

// Repère la note d'une ligne : « 12 », « 12,5 », « 12.5/20 », « 15 / 20 », « abs », « non rendu »…
export function lineValue(line, max) {
  const l = String(line || '');
  if (/\b(abs(ent|ente)?|abs\.)\b/i.test(l)) return { mark: 'absent' };
  if (/\b(non\s*rendu|nr)\b/i.test(l)) return { mark: 'missing' };
  // on cherche le dernier nombre de la ligne (la note est en général à droite du nom)
  const cands = [...l.matchAll(/(?:^|[\s:;=\-–(])([0-9OoIl|!SsB]{1,2}(?:\s?[.,]\s?[0-9OoSs]{1,2})?)\s*(?:\/\s*(\d{1,3}))?(?=$|[\s)*.;,]|pts?|points?)/g)];
  for (let i = cands.length - 1; i >= 0; i--) {
    const raw = fixDigits(cands[i][1]).replace(/\s/g, '');
    if (!/\d/.test(cands[i][1])) continue; // pas un seul vrai chiffre : c'est sans doute une lettre
    const v = parseFloat(raw.replace(',', '.'));
    if (isNaN(v)) continue;
    const on = cands[i][2] ? +cands[i][2] : null;
    // note sur une autre échelle (« 7/10 » alors que la note est sur 20) : on convertit
    const val = on && on !== max && on > 0 ? (v / on) * max : v;
    return { value: Math.round(val * 100) / 100, index: cands[i].index };
  }
  return null;
}

// Associe chaque ligne lue à un élève. Renvoie { found: [{ sid, value | mark, line, sure }], unread: [lignes] }
export function matchLines(lines, students, max) {
  const studs = students.map(s => ({ s, last: words(s.lastName), first: words(s.firstName) }));
  const best = new Map(); // sid → meilleure ligne
  const unread = [];
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line || !/[a-zA-ZÀ-ÿ]{2}/.test(line)) continue;
    const val = lineValue(line, max);
    const lw = words(val && val.index != null ? line.slice(0, val.index) : line);
    if (!lw.length) continue;
    let top = null,
      second = 0;
    for (const x of studs) {
      const sl = nameScore(x.last, lw),
        sf = nameScore(x.first, lw);
      // le nom compte plus que le prénom ; le prénom seul ne suffit que s'il est seul dans la classe
      const score = (sl ? 2 * sl : 0) + (sf ? sf : 0);
      if (!score) continue;
      if (!top || score > top.score) {
        second = top ? top.score : 0;
        top = { x, score, sl, sf };
      } else if (score > second) second = score;
    }
    if (!top || top.score === second || (top.sl < 0.99 && top.sf < 0.99) || !val) {
      if (val || top) unread.push(line);
      continue;
    }
    const sure = top.sl >= 0.99 && top.score - second >= 1;
    const prev = best.get(top.x.s.id);
    if (!prev || top.score > prev.score) {
      if (prev) unread.push(prev.line);
      best.set(top.x.s.id, { sid: top.x.s.id, ...val, line, sure, score: top.score });
    } else unread.push(line);
  }
  return { found: [...best.values()], unread };
}

// ---------- Fenêtre « Saisir les notes » ----------
export async function gradeListDialog(a, students, copies) {
  const crit = a.grid.criteria[0];
  const max = +crit.max || 20;
  const copyOf = sid => copies.find(c => c.studentId === sid);
  const initial = sid => {
    const c = copyOf(sid);
    const ev = (c && c.evaluation) || {};
    return { value: ev[crit.id] != null ? fmtNum(ev[crit.id]) : '', mark: markOf(ev) || '' };
  };
  const row = s => {
    const v = initial(s.id);
    return `<div class="gl-row" data-sid="${s.id}">
      <span class="gl-name">${esc(studentName(s))}<small class="gl-hint"></small></span>
      <span class="gl-in"><input class="input gl-note" type="text" inputmode="decimal" autocomplete="off" value="${esc(v.value)}" ${v.mark ? 'disabled' : ''} aria-label="Note de ${esc(studentName(s))}"><small>/ ${fmtNum(max)}</small></span>
      <select class="input gl-mark" aria-label="Statut"><option value="">—</option><option value="absent" ${v.mark === 'absent' ? 'selected' : ''}>Absent</option><option value="missing" ${v.mark === 'missing' ? 'selected' : ''}>Non rendu</option></select>
    </div>`;
  };
  let rows = null;
  const ok = await modal({
    title: `Notes – ${a.title}`,
    wide: true,
    body: `
      <p class="muted small">Tapez la note de chaque élève (Entrée passe à l’élève suivant). Laissez vide pour un élève pas encore noté.</p>
      <div class="row wrap"><button type="button" class="btn" id="glCam">📸 Photographier une liste</button><button type="button" class="btn ghost" id="glFile">Importer une photo ou un PDF</button></div>
      <div id="glOcr"></div>
      <div class="gl-list">${students.map(row).join('') || '<p class="muted" style="padding:14px">Aucun élève dans cette classe.</p>'}</div>
      <p class="muted small" id="glCount"></p>`,
    actions: [
      { label: 'Annuler', value: null },
      { label: 'Enregistrer les notes', value: 'save', cls: 'primary' },
    ],
    onOpen: w => {
      const count = () => {
        const n = $$('.gl-row', w).filter(r => $('.gl-note', r).value.trim() || $('.gl-mark', r).value).length;
        $('#glCount', w).textContent = `${n} / ${students.length} élève${students.length > 1 ? 's' : ''} noté${n > 1 ? 's' : ''}`;
      };
      const check = r => {
        const inp = $('.gl-note', r);
        const t = inp.value.trim();
        const v = t ? parseNum(t) : null;
        inp.classList.toggle('bad', !!t && (!/^\d+(?:[.,]\d+)?$/.test(t) || v == null || v < 0 || v > max));
      };
      count();
      w.addEventListener('input', e => {
        const r = e.target.closest('.gl-row');
        if (!r) return;
        r.classList.remove('gl-ocr', 'gl-unsure');
        $('.gl-hint', r).textContent = '';
        check(r);
        count();
      });
      w.addEventListener('change', e => {
        if (!e.target.matches('.gl-mark')) return;
        const r = e.target.closest('.gl-row');
        const inp = $('.gl-note', r);
        inp.disabled = !!e.target.value;
        if (e.target.value) inp.value = '';
        inp.classList.remove('bad');
        count();
      });
      // Entrée : élève suivant
      w.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || !e.target.matches('.gl-note')) return;
        e.preventDefault();
        const all = $$('.gl-note', w).filter(i => !i.disabled);
        const next = all[all.indexOf(e.target) + 1];
        if (next) next.focus(), next.select();
        else e.target.blur();
      });

      const fromPhoto = async capture => {
        const files = await pickFiles({ accept: capture ? 'image/*' : 'image/*,application/pdf', capture });
        if (!files.length) return;
        const b = busy('Lecture de la liste…');
        let lines;
        try {
          lines = await readLines(files[0], b.set);
        } catch (e) {
          console.error(e);
          return toast('Lecture impossible : ' + e.message, 'error');
        } finally {
          b.done();
        }
        const { found, unread } = matchLines(lines, students, max);
        for (const f of found) {
          const r = $(`.gl-row[data-sid="${f.sid}"]`, w);
          if (!r) continue;
          const inp = $('.gl-note', r);
          const sel = $('.gl-mark', r);
          sel.value = f.mark || '';
          inp.disabled = !!f.mark;
          inp.value = f.mark ? '' : fmtNum(f.value);
          r.classList.add('gl-ocr');
          r.classList.toggle('gl-unsure', !f.sure);
          $('.gl-hint', r).textContent = `lu : « ${f.line} »`;
          check(r);
        }
        const missing = students.filter(s => !found.some(f => f.sid === s.id)).length;
        $('#glOcr', w).innerHTML = `<div class="banner warn gl-banner">
          <div><b>${found.length ? `${found.length} note${found.length > 1 ? 's' : ''} lue${found.length > 1 ? 's' : ''} : vérifiez-les avant d’enregistrer.` : 'Aucune note reconnue.'}</b>
          <p class="small" style="margin:4px 0 0">Les lignes remplies par la photo sont surlignées${found.some(f => !f.sure) ? ' (en orange quand le nom est incertain)' : ''}. Touchez une note pour la corriger.${missing && found.length ? ` ${missing} élève${missing > 1 ? 's' : ''} sans note lue.` : ''}</p>
          ${!found.length ? '<p class="small" style="margin:4px 0 0">Conseils : photo bien droite et nette, liste imprimée ou écrite lisiblement (nom puis note sur chaque ligne).</p>' : ''}
          ${unread.length ? `<details style="margin-top:6px"><summary class="small">${unread.length} ligne${unread.length > 1 ? 's' : ''} non attribuée${unread.length > 1 ? 's' : ''}</summary><ul class="small gl-unread">${unread.map(l => `<li>${esc(l)}</li>`).join('')}</ul></details>` : ''}</div></div>`;
        count();
        const firstOcr = $('.gl-row.gl-unsure, .gl-row.gl-ocr', w);
        if (firstOcr) firstOcr.scrollIntoView({ block: 'nearest' });
      };
      $('#glCam', w).onclick = () => fromPhoto(true);
      $('#glFile', w).onclick = () => fromPhoto(false);
    },
    validate: (v, w) => {
      const bad = $$('.gl-note.bad', w);
      if (bad.length) {
        bad[0].focus();
        toast(`Note invalide : elle doit être entre 0 et ${fmtNum(max)}.`, 'error');
        return false;
      }
      rows = $$('.gl-row', w).map(r => ({ sid: r.dataset.sid, text: $('.gl-note', r).value.trim(), mark: $('.gl-mark', r).value }));
      return true;
    },
  });
  return ok === 'save' ? rows : null;
}

// Enregistre les notes de la fenêtre (appelé par la page de l'évaluation)
export async function openGradeList(a, students, copies, refresh) {
  const crit = a.grid.criteria[0];
  const rows = await gradeListDialog(a, students, copies);
  if (!rows) return;
  let n = 0;
  const now = Date.now();
  for (const r of rows) {
    const old = copies.find(c => c.studentId === r.sid);
    const c = old || { assignmentId: a.id, studentId: r.sid, annotations: {}, evaluation: {}, comment: '', status: 'todo' };
    c.evaluation = c.evaluation || {};
    const before = JSON.stringify([c.evaluation[crit.id], c.evaluation._mark || null, c.status]);
    if (r.mark) {
      c.evaluation._mark = r.mark;
      delete c.evaluation[crit.id];
      if (c.status !== 'done') (c.status = 'done'), (c.correctedAt = now), (c.markedDone = true);
    } else if (r.text) {
      c.evaluation[crit.id] = Math.round(parseNum(r.text) * 100) / 100;
      delete c.evaluation._mark;
      delete c.markedDone;
      if (c.status !== 'done') (c.status = 'done'), (c.correctedAt = now);
    } else {
      // case vidée : l'élève n'est plus noté
      if (c.evaluation[crit.id] == null && !c.evaluation._mark) continue;
      delete c.evaluation[crit.id];
      delete c.evaluation._mark;
      delete c.markedDone;
      c.status = 'todo';
    }
    if (!old && !r.mark && !r.text) continue;
    if (JSON.stringify([c.evaluation[crit.id], c.evaluation._mark || null, c.status]) === before && old) continue;
    await db.put('copies', c);
    n++;
  }
  toast(n ? `${n} note${n > 1 ? 's' : ''} enregistrée${n > 1 ? 's' : ''} ✓` : 'Aucun changement', n ? 'success' : '');
  refresh();
}
