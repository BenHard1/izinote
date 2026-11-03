import * as db from './db.js';
import {
  esc, $, $$, modal, form, toast, confirmBox, confirmTyped, pickFiles, download, normalize, studentName,
  computeResult, resultText, newGrid, fmtNum, parseNum, fmtDate, DEFAULT_LEVELS,
} from './util.js';
import { mountEditor } from './editor.js';
import { buildCorrectedPdf, correctedFileName } from './pdfexport.js';
import * as gmail from './gmail.js';

window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

const view = $('#view');
let cleanup = null;

// ---------------- Routeur ----------------
const routes = [
  [/^$/, home],
  [/^ecole\/(\w+)$/, schoolView],
  [/^classe\/(\w+)$/, classView],
  [/^etudiant\/(\w+)$/, studentView],
  [/^devoir\/(\w+)$/, assignmentView],
  [/^corriger\/(\w+)\/(\w+)$/, correctView],
  [/^grille\/(devoir|modele)\/(\w+)$/, gridView],
  [/^grilles$/, gridsView],
  [/^reglages$/, settingsView],
];

async function router() {
  const path = location.hash.replace(/^#\/?/, '');
  if (cleanup) {
    const c = cleanup;
    cleanup = null;
    try {
      await c();
    } catch (e) {
      console.error(e);
    }
  }
  document.body.classList.remove('fullscreen');
  const sec = path.split('/')[0];
  const navOn = sec === 'reglages' ? '#/reglages' : sec === 'grilles' || (sec === 'grille' && path.includes('modele')) ? '#/grilles' : '#/';
  $$('.nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === navOn));
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      try {
        await fn(...m.slice(1));
      } catch (e) {
        console.error(e);
        view.innerHTML = `<div class="page-wrap"><p class="error">Erreur : ${esc(e.message)}</p><a class="btn" href="#/">Retour à l'accueil</a></div>`;
      }
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', router);
const go = h => (location.hash = h);

function crumbs(items) {
  return `<nav class="crumbs">${items
    .map((it, i) => (i < items.length - 1 ? `<a href="${it.href}">${esc(it.label)}</a><span>›</span>` : `<b>${esc(it.label)}</b>`))
    .join('')}</nav>`;
}

async function chain({ school, cls }) {
  const out = [{ label: 'Écoles', href: '#/' }];
  if (cls && !school) school = await db.get('schools', cls.schoolId);
  if (school) out.push({ label: school.name, href: '#/ecole/' + school.id });
  if (cls) out.push({ label: cls.name, href: '#/classe/' + cls.id });
  return out;
}

function menuButton(items) {
  // items: [{label, act, danger}]
  return `<div class="menu"><button class="icon-btn" data-menu aria-label="Options">⋮</button><div class="menu-pop">${items
    .map(i => `<button data-act="${i.act}" class="${i.danger ? 'danger' : ''}">${esc(i.label)}</button>`)
    .join('')}</div></div>`;
}
document.addEventListener('click', e => {
  const m = e.target.closest('[data-menu]');
  $$('.menu.open').forEach(x => x !== (m && m.parentElement) && x.classList.remove('open'));
  if (m) {
    e.preventDefault();
    e.stopPropagation();
    m.parentElement.classList.toggle('open');
  }
});

// ---------------- Accueil : écoles ----------------
async function home() {
  const schools = (await db.all('schools')).sort(db.sortByName);
  const classes = await db.all('classes');
  view.innerHTML = `<div class="page-wrap">
    <div class="hero">
      <img src="assets/logo-complet.png" alt="IziNote">
      <div><h1>Corriger, <span class="accent">tranquillement.</span></h1>
      <p>Annotez les copies au stylet, évaluez avec vos grilles, dictez vos commentaires, puis envoyez tout aux étudiants en un geste.</p></div>
    </div>
    <div class="page-head"><h2>Mes écoles</h2><button class="btn primary" id="add">+ École</button></div>
    ${
      schools.length
        ? `<div class="cards">${schools
            .map(s => {
              const n = classes.filter(c => c.schoolId === s.id).length;
              return `<a class="card" href="#/ecole/${s.id}"><div class="card-icon">🏫</div><div><h3>${esc(s.name)}</h3><p>${n} classe${n > 1 ? 's' : ''}</p></div></a>`;
            })
            .join('')}</div>`
        : `<div class="empty"><div class="empty-icon">🏫</div><h2>Bienvenue !</h2><p>Commencez par ajouter votre école (ou votre établissement).<br>Vous y ajouterez ensuite vos classes, vos étudiants et vos devoirs.</p></div>`
    }
  </div>`;
  $('#add').onclick = async () => {
    const v = await form('Nouvelle école', [{ name: 'name', label: "Nom de l'école", required: true, placeholder: 'Ex. Lycée Jean Moulin' }], 'Ajouter');
    if (v) {
      const s = await db.put('schools', { name: v.name });
      go('#/ecole/' + s.id);
    }
  };
}

// ---------------- École : classes ----------------
async function schoolView(id) {
  const school = await db.get('schools', id);
  if (!school) return go('#/');
  const classes = (await db.by('classes', 'schoolId', id)).sort(db.sortByName);
  const counts = {};
  for (const c of classes) counts[c.id] = (await db.by('students', 'classId', c.id)).length;
  view.innerHTML = `<div class="page-wrap">
    ${crumbs(await chain({ school }))}
    <div class="page-head"><h1>${esc(school.name)}</h1>
      <div class="row"><button class="btn primary" id="add">+ Classe</button>${menuButton([
        { label: "Renommer l'école", act: 'rename' },
        { label: "Supprimer l'école", act: 'delete', danger: true },
      ])}</div></div>
    ${
      classes.length
        ? `<div class="cards">${classes
            .map(c => `<a class="card" href="#/classe/${c.id}"><div class="card-icon">👥</div><div><h3>${esc(c.name)}</h3><p>${counts[c.id]} étudiant${counts[c.id] > 1 ? 's' : ''}${c.year ? ' · ' + esc(c.year) : ''}</p></div></a>`)
            .join('')}</div>`
        : `<div class="empty"><div class="empty-icon">👥</div><p>Aucune classe pour l'instant.</p></div>`
    }</div>`;
  $('#add').onclick = async () => {
    const v = await form('Nouvelle classe', [
      { name: 'name', label: 'Nom de la classe', required: true, placeholder: 'Ex. BTS SIO 1A' },
      { name: 'year', label: 'Année scolaire (facultatif)', placeholder: 'Ex. 2026-2027' },
    ], 'Ajouter');
    if (v) {
      const c = await db.put('classes', { schoolId: id, name: v.name, year: v.year });
      go('#/classe/' + c.id);
    }
  };
  view.querySelector('[data-act=rename]').onclick = async () => {
    const v = await form("Renommer l'école", [{ name: 'name', label: 'Nom', value: school.name, required: true }]);
    if (v) {
      school.name = v.name;
      await db.put('schools', school);
      router();
    }
  };
  view.querySelector('[data-act=delete]').onclick = async () => {
    if (await confirmTyped("Supprimer l'école", `Toutes les classes, étudiants, devoirs et copies de « ${school.name} » seront supprimés.`, school.name)) {
      await db.deleteSchool(id);
      toast('École supprimée');
      go('#/');
    }
  };
}

// ---------------- Classe : devoirs + étudiants ----------------
async function classView(id) {
  const cls = await db.get('classes', id);
  if (!cls) return go('#/');
  const students = (await db.by('students', 'classId', id)).sort(db.sortStudents);
  const assignments = (await db.by('assignments', 'classId', id)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const stats = {};
  for (const a of assignments) {
    const copies = await db.by('copies', 'assignmentId', a.id);
    stats[a.id] = {
      done: copies.filter(c => c.status === 'done' && students.some(s => s.id === c.studentId)).length,
      sent: copies.filter(c => c.sentAt && students.some(s => s.id === c.studentId)).length,
    };
  }
  view.innerHTML = `<div class="page-wrap">
    ${crumbs(await chain({ cls }))}
    <div class="page-head"><h1>${esc(cls.name)}${cls.year ? ` <small>${esc(cls.year)}</small>` : ''}</h1>
      ${menuButton([
        { label: 'Renommer la classe', act: 'rename' },
        { label: 'Supprimer la classe (fin d’année)', act: 'delete', danger: true },
      ])}</div>

    <section>
      <div class="sec-head"><h2>Devoirs & projets</h2><button class="btn primary" id="addA">+ Devoir</button></div>
      ${
        assignments.length
          ? `<div class="list">${assignments
              .map(a => {
                const s = stats[a.id];
                const pct = students.length ? Math.round((s.done / students.length) * 100) : 0;
                return `<a class="list-item" href="#/devoir/${a.id}">
                  <div class="li-main"><b>${esc(a.title)}</b><small>${a.kind === 'projet' ? 'Projet' : 'Devoir'}${a.dueDate ? ' · ' + esc(fmtDate(new Date(a.dueDate).getTime())) : ''} · ${a.grid && a.grid.criteria.length ? (a.grid.mode === 'note' ? 'Notation' : 'Acquis / non acquis') : 'Pas de grille'}</small></div>
                  <div class="li-side"><div class="progress"><span style="width:${pct}%"></span></div><small>${s.done}/${students.length} corrigées${s.sent ? ` · ${s.sent} envoyées` : ''}</small></div>
                </a>`;
              })
              .join('')}</div>`
          : `<p class="muted">Aucun devoir. Ajoutez un devoir ou un projet pour y déposer les copies.</p>`
      }
    </section>

    <section>
      <div class="sec-head"><h2>Étudiants <small>(${students.length})</small></h2>
        <div class="row"><button class="btn" id="importS">Coller une liste</button><button class="btn primary" id="addS">+ Étudiant</button></div></div>
      ${
        students.length
          ? `<div class="list">${students
              .map(
                s => `<div class="list-item">
                <a class="li-main" href="#/etudiant/${s.id}"><b>${esc(studentName(s))}</b><small>${s.email ? esc(s.email) : '<span class="warn">pas d’e-mail</span>'}</small></a>
                <div class="row"><button class="icon-btn" data-edit="${s.id}" title="Modifier">✎</button><button class="icon-btn" data-del="${s.id}" title="Supprimer">🗑</button></div>
              </div>`
              )
              .join('')}</div>`
          : `<p class="muted">Aucun étudiant. Ajoutez-les un par un ou collez une liste.</p>`
      }
    </section>
  </div>`;

  $('#addA').onclick = async () => {
    const v = await form('Nouveau devoir ou projet', [
      { name: 'title', label: 'Titre', required: true, placeholder: 'Ex. Exercice 3 – Les fonctions' },
      { name: 'kind', label: 'Type (devoir ou projet)', value: 'devoir' },
      { name: 'dueDate', label: 'Date (facultatif)', type: 'date' },
    ], 'Créer');
    if (!v) return;
    const a = await db.put('assignments', { classId: id, title: v.title, kind: /proj/i.test(v.kind) ? 'projet' : 'devoir', dueDate: v.dueDate, grid: newGrid('note'), createdAt: Date.now() });
    go('#/devoir/' + a.id);
  };
  $('#addS').onclick = () => editStudent(null, id);
  $('#importS').onclick = () => importStudents(id);
  $$('[data-edit]').forEach(b => (b.onclick = () => editStudent(students.find(s => s.id === b.dataset.edit), id)));
  $$('[data-del]').forEach(
    b =>
      (b.onclick = async () => {
        const s = students.find(x => x.id === b.dataset.del);
        if (await confirmBox('Supprimer l’étudiant', `Supprimer ${studentName(s)} et toutes ses copies ?`, 'Supprimer', true)) {
          await db.deleteStudent(s.id);
          router();
        }
      })
  );
  view.querySelector('[data-act=rename]').onclick = async () => {
    const v = await form('Modifier la classe', [
      { name: 'name', label: 'Nom', value: cls.name, required: true },
      { name: 'year', label: 'Année scolaire', value: cls.year || '' },
    ]);
    if (v) {
      Object.assign(cls, v);
      await db.put('classes', cls);
      router();
    }
  };
  view.querySelector('[data-act=delete]').onclick = async () => {
    if (
      await confirmTyped(
        'Supprimer la classe',
        `La classe « ${cls.name} », ses ${students.length} étudiants, ses ${assignments.length} devoirs et toutes les copies seront définitivement supprimés. Pensez à faire une sauvegarde avant (Réglages).`,
        cls.name
      )
    ) {
      await db.deleteClass(id);
      toast('Classe supprimée');
      go('#/ecole/' + cls.schoolId);
    }
  };
}

async function editStudent(s, classId) {
  const v = await form(s ? 'Modifier l’étudiant' : 'Nouvel étudiant', [
    { name: 'firstName', label: 'Prénom', value: s?.firstName, required: true },
    { name: 'lastName', label: 'Nom', value: s?.lastName },
    { name: 'email', label: 'E-mail', type: 'email', value: s?.email, placeholder: 'prenom.nom@exemple.fr' },
  ], s ? 'Enregistrer' : 'Ajouter');
  if (!v) return;
  if (v.email && !/^\S+@\S+\.\S+$/.test(v.email)) return toast('Adresse e-mail invalide.', 'error');
  await db.put('students', { ...(s || {}), classId, ...v });
  router();
}

async function importStudents(classId) {
  const res = {};
  const ok = await modal({
    title: 'Coller une liste d’étudiants',
    wide: true,
    body: `<p>Une ligne par étudiant : <code>Prénom Nom, e-mail</code> ou <code>Nom;Prénom;e-mail</code> (copié depuis un tableur, ça marche aussi).</p>
      <textarea class="input" id="list" rows="10" placeholder="Marie Dupont, marie.dupont@mail.fr&#10;Lucas Martin, lucas.martin@mail.fr"></textarea>
      <label class="check"><input type="checkbox" id="lastFirst"> La première colonne est le NOM (puis le prénom)</label>`,
    actions: [
      { label: 'Annuler', value: false },
      { label: 'Importer', value: true, cls: 'primary' },
    ],
    validate: (v, w) => {
      res.text = $('#list', w).value;
      res.lastFirst = $('#lastFirst', w).checked;
      return true;
    },
  });
  if (!ok) return;
  let n = 0;
  for (const line of res.text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const emailM = line.match(/[^\s,;\t<>]+@[^\s,;\t<>]+\.[^\s,;\t<>]+/);
    const email = emailM ? emailM[0] : '';
    const rest = line.replace(email, '').replace(/[<>]/g, ' ');
    const parts = rest.split(/[;,\t]/).map(x => x.trim()).filter(Boolean);
    let firstName = '',
      lastName = '';
    if (parts.length >= 2) {
      [firstName, lastName] = res.lastFirst ? [parts[1], parts[0]] : [parts[0], parts[1]];
    } else if (parts.length === 1) {
      const w = parts[0].split(/\s+/);
      if (res.lastFirst) {
        lastName = w[0];
        firstName = w.slice(1).join(' ');
      } else {
        firstName = w[0];
        lastName = w.slice(1).join(' ');
      }
    }
    if (!firstName && !lastName) continue;
    await db.put('students', { classId, firstName, lastName, email });
    n++;
  }
  toast(`${n} étudiant${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''}`, 'success');
  router();
}

// ---------------- Étudiant : toutes ses copies ----------------
async function studentView(id) {
  const s = await db.get('students', id);
  if (!s) return go('#/');
  const cls = await db.get('classes', s.classId);
  const assignments = (await db.by('assignments', 'classId', s.classId)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const copies = await db.by('copies', 'studentId', id);
  view.innerHTML = `<div class="page-wrap">
    ${crumbs([...(await chain({ cls })), { label: studentName(s) }])}
    <div class="page-head"><h1>${esc(studentName(s))}</h1><button class="btn" id="edit">✎ Modifier</button></div>
    <p class="muted">${s.email ? esc(s.email) : 'Pas d’adresse e-mail'}</p>
    <div class="list">${
      assignments
        .map(a => {
          const c = copies.find(x => x.assignmentId === a.id);
          const r = c ? computeResult(a.grid, c.evaluation) : null;
          return `<a class="list-item" href="#/corriger/${a.id}/${id}"><div class="li-main"><b>${esc(a.title)}</b><small>${statusLabel(c)}</small></div><div class="li-side">${r && r.short && c.status === 'done' ? `<span class="score">${esc(r.short)}</span>` : ''}</div></a>`;
        })
        .join('') || '<p class="muted">Aucun devoir dans cette classe.</p>'
    }</div></div>`;
  $('#edit').onclick = () => editStudent(s, s.classId);
}

function statusLabel(c) {
  if (!c || (!c.pdf && c.status !== 'done')) return '<span class="tag">Pas de copie</span>';
  if (c.sentAt) return `<span class="tag sent">Envoyée le ${fmtDate(c.sentAt)}</span>`;
  if (c.status === 'done') return '<span class="tag done">Corrigée</span>';
  return '<span class="tag todo">À corriger</span>';
}

// ---------------- Devoir : copies de la classe ----------------
async function assignmentView(id) {
  const a = await db.get('assignments', id);
  if (!a) return go('#/');
  const cls = await db.get('classes', a.classId);
  const students = (await db.by('students', 'classId', a.classId)).sort(db.sortStudents);
  const copies = await db.by('copies', 'assignmentId', id);
  const copyOf = sid => copies.find(c => c.studentId === sid);
  const done = students.filter(s => copyOf(s.id)?.status === 'done').length;
  const sent = students.filter(s => copyOf(s.id)?.sentAt).length;
  const allDone = students.length > 0 && done === students.length;
  const grid = a.grid || newGrid();

  view.innerHTML = `<div class="page-wrap">
    ${crumbs([...(await chain({ cls })), { label: a.title }])}
    <div class="page-head"><h1>${esc(a.title)}</h1>${menuButton([
      { label: 'Renommer', act: 'rename' },
      { label: 'Supprimer ce devoir', act: 'delete', danger: true },
    ])}</div>

    <div class="summary">
      <div class="sum-box"><b>${done}/${students.length}</b><span>corrigées</span></div>
      <div class="sum-box"><b>${sent}</b><span>envoyées</span></div>
      <div class="sum-box grow"><span>Grille : ${grid.criteria.length ? `${grid.mode === 'note' ? 'notation' + (grid.scaleTo ? ' sur ' + grid.scaleTo : '') : 'acquis / non acquis'}, ${grid.criteria.length} critère${grid.criteria.length > 1 ? 's' : ''}` : '<span class="warn">à créer</span>'}</span>
        <a class="btn small" href="#/grille/devoir/${id}">${grid.criteria.length ? 'Modifier la grille' : 'Créer la grille'}</a></div>
    </div>

    ${allDone && sent < students.length ? `<div class="banner success">✓ Toute la classe est corrigée. Vous pouvez envoyer les corrections.</div>` : ''}

    <div class="row wrap actions-bar">
      <button class="btn" id="import">📄 Importer des copies (PDF)</button>
      <button class="btn primary" id="send" ${done ? '' : 'disabled'}>✉ Envoyer les corrections</button>
      <button class="btn ghost" id="dlAll" ${done ? '' : 'disabled'}>⬇ Télécharger les corrigés</button>
    </div>

    <div class="list">${
      students
        .map(s => {
          const c = copyOf(s.id);
          const r = c ? computeResult(grid, c.evaluation) : null;
          return `<div class="list-item">
          <a class="li-main" href="#/corriger/${id}/${s.id}"><b>${esc(studentName(s))}</b><small>${statusLabel(c)}${c && c.fileName ? ' · ' + esc(c.fileName) : ''}</small></a>
          <div class="li-side row">
            ${r && r.short && (c.status === 'done' || Object.keys(c.evaluation || {}).length) ? `<span class="score ${c.status === 'done' ? '' : 'partial'}">${esc(r.short)}</span>` : ''}
            <button class="icon-btn" data-up="${s.id}" title="${c && c.pdf ? 'Remplacer le PDF' : 'Importer le PDF'}">📎</button>
            <a class="btn small ${c && c.pdf && c.status !== 'done' ? 'primary' : ''}" href="#/corriger/${id}/${s.id}">${c && c.status === 'done' ? 'Revoir' : 'Corriger'}</a>
          </div></div>`;
        })
        .join('') || `<p class="muted">Aucun étudiant dans cette classe. <a href="#/classe/${cls.id}">Ajoutez-les ici.</a></p>`
    }</div></div>`;

  $('#import').onclick = () => bulkImport(a, students, copies);
  $$('[data-up]').forEach(b => (b.onclick = () => uploadFor(a, students.find(s => s.id === b.dataset.up), copyOf(b.dataset.up))));
  $('#send').onclick = () => sendDialog(a, cls, students, copies);
  $('#dlAll').onclick = () => downloadAll(a, cls, students, copies);
  view.querySelector('[data-act=rename]').onclick = async () => {
    const v = await form('Modifier le devoir', [
      { name: 'title', label: 'Titre', value: a.title, required: true },
      { name: 'dueDate', label: 'Date', type: 'date', value: a.dueDate || '' },
    ]);
    if (v) {
      Object.assign(a, v);
      await db.put('assignments', a);
      router();
    }
  };
  view.querySelector('[data-act=delete]').onclick = async () => {
    if (await confirmTyped('Supprimer le devoir', 'Toutes les copies et corrections de ce devoir seront supprimées.', a.title)) {
      await db.deleteAssignment(id);
      go('#/classe/' + cls.id);
    }
  };
}

async function getOrCreateCopy(assignmentId, studentId) {
  const list = await db.by('copies', 'assignmentId', assignmentId);
  return list.find(c => c.studentId === studentId) || { assignmentId, studentId, annotations: {}, evaluation: {}, comment: '', status: 'todo' };
}

async function attachPdf(copy, file) {
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) throw new Error(`« ${file.name} » n'est pas un PDF.`);
  copy.pdf = new Blob([await file.arrayBuffer()], { type: 'application/pdf' });
  copy.fileName = file.name;
  copy.annotations = {};
  copy.sentAt = null;
  await db.put('copies', copy);
}

async function uploadFor(a, s, existing) {
  if (existing && existing.pdf && !(await confirmBox('Remplacer la copie', `Remplacer le PDF de ${studentName(s)} ? Les annotations faites sur l'ancien seront perdues (la grille et le commentaire sont gardés).`, 'Remplacer')))
    return;
  const [f] = await pickFiles();
  if (!f) return;
  try {
    await attachPdf(existing || (await getOrCreateCopy(a.id, s.id)), f);
    toast('Copie importée', 'success');
    router();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// Import groupé : on devine l'étudiant d'après le nom du fichier.
function guessStudent(fileName, students) {
  const n = ' ' + normalize(fileName.replace(/\.pdf$/i, '')).replace(/[^a-z0-9]+/g, ' ') + ' ';
  const has = w => w && n.includes(' ' + normalize(w).replace(/[^a-z0-9]+/g, ' ').trim() + ' ');
  const both = students.filter(s => has(s.lastName) && has(s.firstName));
  if (both.length === 1) return both[0];
  const last = students.filter(s => has(s.lastName));
  if (last.length === 1) return last[0];
  const first = students.filter(s => has(s.firstName));
  if (first.length === 1) return first[0];
  return null;
}

async function bulkImport(a, students, copies) {
  const files = await pickFiles({ multiple: true });
  if (!files.length) return;
  const rows = files.map(f => ({ f, s: guessStudent(f.name, students) }));
  const opts = s => `<option value="">— Ne pas importer —</option>${students.map(x => `<option value="${x.id}" ${s && s.id === x.id ? 'selected' : ''}>${esc(studentName(x))}</option>`).join('')}`;
  let mapping = null;
  const ok = await modal({
    title: `Importer ${files.length} copie${files.length > 1 ? 's' : ''}`,
    wide: true,
    body: `<p class="muted">Vérifiez à quel étudiant correspond chaque fichier (deviné d'après le nom du fichier).</p>
      <div class="map-list">${rows
        .map((r, i) => `<div class="map-row"><span class="fname">📄 ${esc(r.f.name)}</span><select class="input" data-i="${i}">${opts(r.s)}</select></div>`)
        .join('')}</div>`,
    actions: [
      { label: 'Annuler', value: false },
      { label: 'Importer', value: true, cls: 'primary' },
    ],
    validate: (v, w) => {
      mapping = $$('select', w).map(s => s.value);
      const chosen = mapping.filter(Boolean);
      if (new Set(chosen).size !== chosen.length) {
        toast('Un même étudiant est choisi pour deux fichiers.', 'error');
        return false;
      }
      return true;
    },
  });
  if (!ok) return;
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    if (!mapping[i]) continue;
    const copy = copies.find(c => c.studentId === mapping[i]) || (await getOrCreateCopy(a.id, mapping[i]));
    try {
      await attachPdf(copy, rows[i].f);
      n++;
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  toast(`${n} copie${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''}`, 'success');
  router();
}

async function downloadAll(a, cls, students, copies) {
  const settings = await db.getSettings();
  const list = students.map(s => ({ s, c: copies.find(c => c.studentId === s.id) })).filter(x => x.c && x.c.status === 'done');
  toast(`Préparation de ${list.length} PDF…`);
  for (const { s, c } of list) {
    try {
      const bytes = await buildCorrectedPdf({ copy: c, student: s, assignment: a, cls, settings });
      download(new Blob([bytes], { type: 'application/pdf' }), correctedFileName(s, a));
      await new Promise(r => setTimeout(r, 400));
    } catch (e) {
      toast(`${studentName(s)} : ${e.message}`, 'error');
    }
  }
}

// ---------------- Envoi des corrections par Gmail ----------------
async function sendDialog(a, cls, students, copies) {
  const settings = await db.getSettings();
  if (!settings.googleClientId) {
    const r = await modal({
      title: 'Configurer Gmail',
      body: `<p>Pour envoyer les mails, il faut d'abord relier votre compte Gmail dédié (à faire une seule fois).</p><p>Allez dans <b>Réglages</b> et suivez le guide « Connexion Gmail ».</p>`,
      actions: [
        { label: 'Plus tard', value: false },
        { label: 'Aller aux réglages', value: true, cls: 'primary' },
      ],
    });
    if (r) go('#/reglages');
    return;
  }
  gmail.loadGis().catch(e => toast(e.message, 'error'));
  const rows = students.map(s => ({ s, c: copies.find(c => c.studentId === s.id) }));
  const notDone = rows.filter(r => !r.c || r.c.status !== 'done');
  const body = `
    ${notDone.length ? `<div class="banner warn">${notDone.length} copie${notDone.length > 1 ? 's ne sont' : ' n’est'} pas encore corrigée${notDone.length > 1 ? 's' : ''} : ${notDone.map(r => esc(studentName(r.s))).join(', ')}.</div>` : `<div class="banner success">Toute la classe est corrigée.</div>`}
    <p class="muted">Chaque étudiant coché recevra un e-mail avec sa copie corrigée en PDF (annotations + fiche d’évaluation) et votre commentaire.</p>
    <div class="send-list">${rows
      .map(({ s, c }) => {
        const can = c && c.status === 'done' && s.email;
        const why = !s.email ? 'pas d’e-mail' : !c || c.status !== 'done' ? 'non corrigée' : c.sentAt ? `déjà envoyée le ${fmtDate(c.sentAt)}` : '';
        return `<label class="send-row ${can ? '' : 'disabled'}"><input type="checkbox" data-s="${s.id}" ${can && !c.sentAt ? 'checked' : ''} ${can ? '' : 'disabled'}>
          <span class="sr-name">${esc(studentName(s))}<small>${esc(s.email || '')}</small></span><span class="sr-status" data-st="${s.id}">${esc(why)}</span></label>`;
      })
      .join('')}</div>
    <details class="preview"><summary>Aperçu du message</summary><pre id="prev"></pre></details>`;

  const vars = (s, c) => {
    const r = computeResult(a.grid, c?.evaluation || {});
    return {
      prenom: s.firstName || '',
      nom: s.lastName || '',
      devoir: a.title,
      classe: cls.name,
      note: r.short || '',
      evaluation: resultText(a.grid, c?.evaluation || {}),
      commentaire: (c?.comment || '').trim() || '—',
      professeur: settings.teacherName || '',
    };
  };

  await modal({
    title: `Envoyer les corrections – ${a.title}`,
    wide: true,
    body,
    actions: [{ label: 'Fermer', value: null }, { label: 'Envoyer', value: 'send', cls: 'primary' }],
    onOpen: (w, close) => {
      const first = rows.find(r => r.c && r.c.status === 'done') || rows[0];
      if (first) {
        const v = vars(first.s, first.c);
        $('#prev', w).textContent = `À : ${first.s.email || '?'}\nObjet : ${gmail.fillTemplate(settings.mailSubject, v)}\n\n${gmail.fillTemplate(settings.mailBody, v)}\n\n📎 ${correctedFileName(first.s, a)}`;
      }
      const sendBtn = $('.modal-actions .primary', w);
      sendBtn.onclick = async () => {
        const ids = $$('input[data-s]:checked', w).map(i => i.dataset.s);
        if (!ids.length) return toast('Aucun étudiant sélectionné.', 'error');
        sendBtn.disabled = true;
        try {
          await gmail.authorize(settings.googleClientId); // dans le clic : la fenêtre Google peut s'ouvrir
        } catch (e) {
          sendBtn.disabled = false;
          return toast(e.message, 'error');
        }
        let ok = 0;
        for (const sid of ids) {
          const { s, c } = rows.find(r => r.s.id === sid);
          const st = $(`[data-st="${sid}"]`, w);
          st.textContent = 'envoi…';
          st.className = 'sr-status busy';
          try {
            const bytes = await buildCorrectedPdf({ copy: c, student: s, assignment: a, cls, settings });
            const v = vars(s, c);
            await gmail.sendMail(settings.googleClientId, {
              to: s.email,
              subject: gmail.fillTemplate(settings.mailSubject, v),
              body: gmail.fillTemplate(settings.mailBody, v),
              attachment: { name: correctedFileName(s, a), bytes },
            });
            c.sentAt = Date.now();
            await db.put('copies', c);
            st.textContent = '✓ envoyée';
            st.className = 'sr-status ok';
            $(`input[data-s="${sid}"]`, w).checked = false;
            ok++;
          } catch (e) {
            console.error(e);
            st.textContent = '✗ ' + e.message;
            st.className = 'sr-status err';
          }
        }
        sendBtn.disabled = false;
        toast(`${ok}/${ids.length} mail${ids.length > 1 ? 's' : ''} envoyé${ok > 1 ? 's' : ''}`, ok === ids.length ? 'success' : 'error');
      };
    },
  });
  router();
}

// ---------------- Correction d'une copie ----------------
async function correctView(assignmentId, studentId) {
  const a = await db.get('assignments', assignmentId);
  const s = await db.get('students', studentId);
  if (!a || !s) return go('#/');
  const cls = await db.get('classes', a.classId);
  const students = (await db.by('students', 'classId', a.classId)).sort(db.sortStudents);
  const copy = await getOrCreateCopy(assignmentId, studentId);
  const settings = await db.getSettings();
  document.body.classList.add('fullscreen');
  let dirty = false;
  const ctx = {
    copy,
    student: s,
    assignment: a,
    cls,
    settings,
    order: students.map(x => x.id),
    exit: () => go('#/devoir/' + assignmentId),
    goto: sid => go(`#/corriger/${assignmentId}/${sid}`),
    editGrid: () => go('#/grille/devoir/' + assignmentId),
    save: async c => {
      // on n'enregistre une copie vide (sans PDF ni saisie) que si quelque chose a été fait
      const touched = c.pdf || c.comment || Object.keys(c.evaluation || {}).length || c.status === 'done' || c.id;
      if (touched) await db.put('copies', c);
    },
    importPdf: async () => {
      const [f] = await pickFiles();
      if (!f) return;
      try {
        await attachPdf(copy, f);
        router();
      } catch (e) {
        toast(e.message, 'error');
      }
    },
    onDone: async () => {
      const copies = await db.by('copies', 'assignmentId', assignmentId);
      const allDone = students.every(x => copies.some(c => c.studentId === x.id && c.status === 'done'));
      if (allDone) {
        const r = await modal({
          title: 'Toute la classe est corrigée 🎉',
          body: `<p>Toutes les copies de « ${esc(a.title)} » sont corrigées. Voulez-vous envoyer les corrections aux étudiants maintenant ?</p>`,
          actions: [
            { label: 'Plus tard', value: false },
            { label: 'Envoyer les corrections', value: true, cls: 'primary' },
          ],
        });
        if (r) {
          go('#/devoir/' + assignmentId);
          setTimeout(() => $('#send') && $('#send').click(), 400);
        }
      }
    },
  };
  view.innerHTML = '';
  cleanup = await mountEditor(view, ctx);
}

// ---------------- Grilles d'évaluation ----------------
async function gridView(kind, id) {
  let owner, grid, title, back;
  if (kind === 'devoir') {
    owner = await db.get('assignments', id);
    if (!owner) return go('#/');
    grid = owner.grid ? JSON.parse(JSON.stringify(owner.grid)) : newGrid();
    title = `Grille – ${owner.title}`;
    back = '#/devoir/' + id;
  } else {
    owner = id === 'new' ? { name: '', grid: newGrid() } : await db.get('grids', id);
    if (!owner) return go('#/grilles');
    grid = JSON.parse(JSON.stringify(owner.grid));
    title = id === 'new' ? 'Nouvelle grille modèle' : 'Grille modèle';
    back = '#/grilles';
  }
  grid.levels = grid.levels && grid.levels.length ? grid.levels : [...DEFAULT_LEVELS];
  let crumbsHtml = '';
  if (kind === 'devoir') {
    const cls = await db.get('classes', owner.classId);
    crumbsHtml = crumbs([...(await chain({ cls })), { label: owner.title, href: back }, { label: 'Grille' }]);
  } else crumbsHtml = crumbs([{ label: 'Mes grilles', href: '#/grilles' }, { label: owner.name || 'Nouvelle' }]);

  const render = () => {
    view.innerHTML = `<div class="page-wrap narrow">
      ${crumbsHtml}
      <div class="page-head"><h1>${esc(title)}</h1></div>
      ${kind === 'modele' ? `<label class="field"><span>Nom de la grille</span><input class="input" id="gname" value="${esc(owner.name)}" placeholder="Ex. Grille exposé oral"></label>` : ''}
      <div class="seg">
        <button class="${grid.mode === 'note' ? 'on' : ''}" data-mode="note">Notation (points)</button>
        <button class="${grid.mode === 'acquis' ? 'on' : ''}" data-mode="acquis">Acquis / non acquis</button>
      </div>
      ${
        grid.mode === 'note'
          ? `<label class="field inline"><span>Ramener la note sur</span><input class="input num" id="scale" inputmode="numeric" value="${grid.scaleTo ?? ''}" placeholder="(non)"><small class="muted">Laissez vide pour garder le total des points.</small></label>`
          : `<div class="field"><span>Niveaux (du plus faible au plus fort)</span><div id="levels">${grid.levels
              .map((l, i) => `<div class="crit-edit"><input class="input" data-lvl="${i}" value="${esc(l)}"><button class="icon-btn" data-dellvl="${i}" ${grid.levels.length <= 2 ? 'disabled' : ''}>✕</button></div>`)
              .join('')}</div><button class="btn small" id="addLvl">+ Niveau</button></div>`
      }
      <h2>${grid.mode === 'note' ? 'Critères' : 'Compétences évaluées'}</h2>
      <div id="crits">${grid.criteria
        .map(
          (c, i) => `<div class="crit-edit">
          <input class="input" data-label="${i}" value="${esc(c.label)}" placeholder="${grid.mode === 'note' ? 'Ex. Qualité de la rédaction' : 'Ex. Savoir argumenter'}">
          ${grid.mode === 'note' ? `<input class="input num" data-max="${i}" inputmode="decimal" value="${fmtNum(c.max)}" title="Points"> <span class="muted">pts</span>` : ''}
          <button class="icon-btn" data-up="${i}" ${i ? '' : 'disabled'} title="Monter">↑</button>
          <button class="icon-btn" data-del="${i}" title="Supprimer">✕</button></div>`
        )
        .join('')}</div>
      <button class="btn" id="addC">+ ${grid.mode === 'note' ? 'Critère' : 'Compétence'}</button>
      ${grid.mode === 'note' && grid.criteria.length ? `<p class="muted">Total : ${fmtNum(grid.criteria.reduce((t, c) => t + (+c.max || 0), 0))} points</p>` : ''}
      <div class="row wrap actions-bar">
        <button class="btn primary" id="save">Enregistrer</button>
        ${kind === 'devoir' ? `<button class="btn" id="load">Utiliser une grille modèle</button><button class="btn ghost" id="saveTpl">Enregistrer comme modèle</button>` : ''}
        <a class="btn ghost" href="${back}">Annuler</a>
      </div></div>`;
    bind();
  };
  const read = () => {
    $$('[data-label]').forEach(i => (grid.criteria[+i.dataset.label].label = i.value));
    $$('[data-max]').forEach(i => (grid.criteria[+i.dataset.max].max = parseNum(i.value) ?? 0));
    $$('[data-lvl]').forEach(i => (grid.levels[+i.dataset.lvl] = i.value));
    if ($('#scale')) grid.scaleTo = parseNum($('#scale').value);
    if ($('#gname')) owner.name = $('#gname').value.trim();
  };
  const bind = () => {
    $$('[data-mode]').forEach(
      b =>
        (b.onclick = () => {
          read();
          grid.mode = b.dataset.mode;
          if (grid.mode === 'note' && grid.scaleTo == null) grid.scaleTo = 20;
          render();
        })
    );
    $('#addC').onclick = () => {
      read();
      grid.criteria.push({ id: db.uid(), label: '', max: 4 });
      render();
      const inputs = $$('[data-label]');
      inputs[inputs.length - 1].focus();
    };
    $$('[data-del]').forEach(b => (b.onclick = () => (read(), grid.criteria.splice(+b.dataset.del, 1), render())));
    $$('[data-up]').forEach(
      b =>
        (b.onclick = () => {
          read();
          const i = +b.dataset.up;
          [grid.criteria[i - 1], grid.criteria[i]] = [grid.criteria[i], grid.criteria[i - 1]];
          render();
        })
    );
    if ($('#addLvl')) $('#addLvl').onclick = () => (read(), grid.levels.push('Nouveau niveau'), render());
    $$('[data-dellvl]').forEach(b => (b.onclick = () => (read(), grid.levels.splice(+b.dataset.dellvl, 1), render())));
    $('#save').onclick = async () => {
      read();
      grid.criteria = grid.criteria.filter(c => c.label.trim());
      grid.levels = grid.levels.map(l => l.trim()).filter(Boolean);
      if (grid.mode === 'acquis' && grid.levels.length < 2) return toast('Il faut au moins 2 niveaux.', 'error');
      if (kind === 'devoir') {
        owner.grid = grid;
        await db.put('assignments', owner);
      } else {
        if (!owner.name) return toast('Donnez un nom à la grille.', 'error');
        owner.grid = grid;
        await db.put('grids', owner);
      }
      toast('Grille enregistrée', 'success');
      go(back);
    };
    if ($('#load'))
      $('#load').onclick = async () => {
        const grids = (await db.all('grids')).sort(db.sortByName);
        if (!grids.length) return toast('Aucune grille modèle. Créez-en dans « Mes grilles ».');
        let chosen = null;
        const ok = await modal({
          title: 'Choisir une grille modèle',
          body: `<div class="list">${grids.map(g => `<label class="list-item check"><input type="radio" name="g" value="${g.id}"> <b>${esc(g.name)}</b> <small>${g.grid.criteria.length} critères · ${g.grid.mode === 'note' ? 'notation' : 'acquis'}</small></label>`).join('')}</div>
            <p class="muted small">La grille actuelle de ce devoir sera remplacée par une copie du modèle.</p>`,
          actions: [{ label: 'Annuler', value: false }, { label: 'Utiliser', value: true, cls: 'primary' }],
          validate: (v, w) => {
            const r = $('input[name=g]:checked', w);
            if (!r) return false;
            chosen = grids.find(g => g.id === r.value);
            return true;
          },
        });
        if (ok && chosen) {
          grid = JSON.parse(JSON.stringify(chosen.grid));
          grid.criteria.forEach(c => (c.id = db.uid()));
          grid.levels = grid.levels && grid.levels.length ? grid.levels : [...DEFAULT_LEVELS];
          render();
          toast('Grille chargée : pensez à enregistrer.');
        }
      };
    if ($('#saveTpl'))
      $('#saveTpl').onclick = async () => {
        read();
        const v = await form('Enregistrer comme grille modèle', [{ name: 'name', label: 'Nom de la grille', value: owner.title, required: true }]);
        if (!v) return;
        await db.put('grids', { name: v.name, grid: JSON.parse(JSON.stringify({ ...grid, criteria: grid.criteria.filter(c => c.label.trim()) })) });
        toast('Grille modèle enregistrée', 'success');
      };
  };
  render();
}

async function gridsView() {
  const grids = (await db.all('grids')).sort(db.sortByName);
  view.innerHTML = `<div class="page-wrap">
    <div class="page-head"><h1>Mes grilles modèles</h1><a class="btn primary" href="#/grille/modele/new">+ Grille</a></div>
    <p class="muted">Des grilles réutilisables : dans un devoir, « Utiliser une grille modèle » en fait une copie que vous pouvez ensuite adapter.</p>
    <div class="list">${
      grids
        .map(
          g => `<div class="list-item"><a class="li-main" href="#/grille/modele/${g.id}"><b>${esc(g.name)}</b><small>${g.grid.criteria.length} critères · ${g.grid.mode === 'note' ? 'notation' + (g.grid.scaleTo ? ' sur ' + g.grid.scaleTo : '') : 'acquis / non acquis'}</small></a>
          <button class="icon-btn" data-del="${g.id}">🗑</button></div>`
        )
        .join('') || '<div class="empty"><div class="empty-icon">📋</div><p>Aucune grille modèle pour l’instant.</p></div>'
    }</div></div>`;
  $$('[data-del]').forEach(
    b =>
      (b.onclick = async () => {
        if (await confirmBox('Supprimer la grille', 'Supprimer cette grille modèle ? Les devoirs qui l’utilisent gardent leur propre copie.', 'Supprimer', true)) {
          await db.del('grids', b.dataset.del);
          router();
        }
      })
  );
}

// ---------------- Réglages ----------------
async function settingsView() {
  const s = await db.getSettings();
  let usage = '';
  try {
    const est = await navigator.storage.estimate();
    usage = `${(est.usage / 1048576).toFixed(1)} Mo utilisés sur la tablette`;
  } catch {}
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  view.innerHTML = `<div class="page-wrap narrow">
    <div class="page-head"><h1>Réglages</h1></div>

    <section class="card-sec">
      <h2>Vous</h2>
      <label class="field"><span>Votre nom (signature des mails et fiches)</span><input class="input" id="teacherName" value="${esc(s.teacherName)}" placeholder="Ex. M. Martin"></label>
      <label class="check"><input type="checkbox" id="stylusOnly" ${s.stylusOnly ? 'checked' : ''}> Par défaut, seul le stylet écrit (le doigt fait défiler)</label>
    </section>

    <section class="card-sec">
      <h2>Connexion Gmail</h2>
      <p>Les mails partent de votre adresse Gmail dédiée, via l’API Gmail (gratuite). À configurer une seule fois :</p>
      <ol class="steps">
        <li>Sur un ordinateur, connecté avec le Gmail dédié, ouvrez <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com</a> et créez un projet (ex. « Correction »).</li>
        <li>Activez l’<a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener">API Gmail</a> (bouton « Activer »).</li>
        <li>Menu <b>Google Auth Platform</b> (ou « Écran de consentement OAuth ») : type <b>Externe</b>, nom de l’appli au choix, votre e-mail. Dans <b>Audience</b>, ajoutez votre Gmail dédié comme <b>utilisateur test</b>.</li>
        <li>Menu <b>Clients</b> (ou « Identifiants ») → <b>Créer un client OAuth</b> → type <b>Application Web</b>. Dans « Origines JavaScript autorisées », ajoutez : <code id="origin">${esc(location.origin)}</code></li>
        <li>Copiez l’<b>ID client</b> (il finit par <code>.apps.googleusercontent.com</code>) et collez-le ci-dessous.</li>
      </ol>
      <label class="field"><span>ID client Google</span><input class="input" id="googleClientId" value="${esc(s.googleClientId)}" placeholder="123456789-xxxx.apps.googleusercontent.com" autocapitalize="off" spellcheck="false"></label>
      <div class="row wrap"><input class="input" id="testTo" type="email" placeholder="Adresse pour un mail de test" style="flex:1;min-width:200px"><button class="btn" id="test">Envoyer un mail de test</button></div>
      <p class="muted small">Au premier envoi, Google affiche « Application non validée » : c’est normal pour une appli personnelle. Cliquez sur « Continuer ». La connexion dure une heure, puis Google redemande simplement de confirmer.</p>
    </section>

    <section class="card-sec">
      <h2>Modèle de mail</h2>
      <label class="field"><span>Objet</span><input class="input" id="mailSubject" value="${esc(s.mailSubject)}"></label>
      <label class="field"><span>Message</span><textarea class="input" id="mailBody" rows="9">${esc(s.mailBody)}</textarea></label>
      <p class="muted small">Champs remplacés automatiquement : {prenom} {nom} {devoir} {classe} {note} {evaluation} {commentaire} {professeur}</p>
    </section>

    <div class="row"><button class="btn primary" id="save">Enregistrer les réglages</button></div>

    <section class="card-sec">
      <h2>Sauvegarde</h2>
      <p>Toutes vos données (copies, corrections, classes) sont stockées <b>uniquement sur cette tablette</b>. Faites une sauvegarde régulièrement (par ex. dans Google Drive) : elle permet aussi de passer sur un autre appareil.</p>
      <p class="muted small">${esc(usage)}${persisted ? ' · stockage protégé ✓' : ''}</p>
      <div class="row wrap"><button class="btn" id="export">⬇ Exporter une sauvegarde</button><button class="btn" id="import">⬆ Restaurer une sauvegarde</button></div>
    </section>
  </div>`;

  const collect = () => ({
    ...s,
    teacherName: $('#teacherName').value.trim(),
    stylusOnly: $('#stylusOnly').checked,
    googleClientId: $('#googleClientId').value.trim(),
    mailSubject: $('#mailSubject').value,
    mailBody: $('#mailBody').value,
  });
  $('#save').onclick = async () => {
    await db.saveSettings(collect());
    toast('Réglages enregistrés', 'success');
  };
  gmail.loadGis().catch(() => {});
  $('#test').onclick = async () => {
    const st = collect();
    await db.saveSettings(st);
    const to = $('#testTo').value.trim();
    if (!st.googleClientId) return toast('Collez d’abord l’ID client Google.', 'error');
    if (!/^\S+@\S+\.\S+$/.test(to)) return toast('Indiquez une adresse e-mail pour le test.', 'error');
    try {
      await gmail.sendMail(st.googleClientId, { to, subject: 'Test – IziNote', body: 'Ça marche ! Les corrections pourront être envoyées depuis ce compte.' });
      toast('Mail de test envoyé ✓', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  $('#export').onclick = async () => {
    toast('Préparation de la sauvegarde…');
    const blob = await db.exportAll();
    download(blob, `sauvegarde-correction-${new Date().toISOString().slice(0, 10)}.json`);
  };
  $('#import').onclick = async () => {
    const [f] = await pickFiles({ accept: '.json,application/json' });
    if (!f) return;
    if (!(await confirmBox('Restaurer une sauvegarde', 'Les données actuelles de la tablette seront remplacées par celles de la sauvegarde.', 'Restaurer', true))) return;
    try {
      await db.importAll(f);
      toast('Sauvegarde restaurée', 'success');
      go('#/');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
}

// ---------------- Démarrage ----------------
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
router();
