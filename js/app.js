import * as db from './db.js';
import {
  esc, $, $$, modal, form, toast, confirmBox, confirmTyped, pickFiles, download, normalize, studentName,
  computeResult, resultText, newGrid, fmtNum, parseNum, fmtDate, DEFAULT_LEVELS,
  KINDS, kindLabel, imageToDataUrl, dateOf, shortDate,
  busy,
} from './util.js';
import { mountEditor } from './editor.js';
import { buildCorrectedPdf, correctedFileName } from './pdfexport.js';
import * as gmail from './gmail.js';
import * as sched from './schedule.js';
import { distributeDialog, mailingsSection } from './distribute.js';
import * as hw from './homework.js';
import { relayScript } from './relayscript.js';
import { classData, average, semesterOf, exportClassXlsx, studentRecapPdf } from './reports.js';
import { readGridFile } from './gridimport.js';
import { ACCEPT_DOCS, checkSupported, filesToPdfBlob } from './convert.js';
import * as sync from './sync.js';

window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

const view = $('#view');
let cleanup = null;

// ---------------- Routeur ----------------
const routes = [
  [/^$/, home],
  [/^ecole\/(\w+)$/, schoolView],
  [/^classe\/(\w+)$/, classView],
  [/^etudiant\/(\w+)(?:\/(\w+))?$/, studentView],
  [/^devoir\/(\w+)$/, assignmentView],
  [/^corriger\/(\w+)\/(\w+)$/, correctView],
  [/^grille\/(devoir|modele)\/(\w+)$/, gridView],
  [/^grilles$/, gridsView],
  [/^reglages$/, settingsView],
];

// Dernière page affichée : quand on réaffiche la même page (après une modification), on garde la position.
let lastPath = null;
async function router() {
  const path = location.hash.replace(/^#\/?/, '');
  const samePage = path === lastPath;
  const keepY = samePage ? window.scrollY : 0;
  lastPath = path;
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
      window.scrollTo(0, keepY);
      hideSplash();
      return;
    }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', router);

// Écran de démarrage : on le garde au moins un tour d'animation (~1,6 s) puis il s'efface.
const splashStart = performance.now();
let splashGone = false;
function hideSplash() {
  if (splashGone) return;
  splashGone = true;
  const el = document.getElementById('splash');
  if (!el) return;
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 450);
  }, Math.max(0, 1600 - (performance.now() - splashStart)));
}
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
const schoolLogo = s => (s.logo || s.logoUrl ? `<img class="school-logo" src="${esc(s.logo || s.logoUrl)}" alt="">` : '🏫');

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
              return `<a class="card" href="#/ecole/${s.id}"><div class="card-icon">${schoolLogo(s)}</div><div><h3>${esc(s.name)}</h3><p>${n} classe${n > 1 ? 's' : ''}</p></div></a>`;
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
      setTimeout(() => editSchoolLogo(s), 300);
    }
  };
}

// Logo d'une école : depuis une image de la tablette, ou depuis le site web de l'école.
async function editSchoolLogo(school) {
  let chosen = school.logo || school.logoUrl || null;
  let chosenIsUrl = !school.logo && !!school.logoUrl;
  const r = await modal({
    title: `Logo – ${school.name}`,
    body: `
      <div class="logo-preview" id="lp">${chosen ? `<img src="${esc(chosen)}" alt="">` : '<span class="muted">Pas de logo</span>'}</div>
      <div class="row wrap"><button class="btn" id="lfile">🖼 Choisir une image</button><button class="btn ghost" id="lnone">Retirer le logo</button></div>
      <h3 style="margin-top:18px">Ou le chercher sur internet</h3>
      <p class="muted small">Indiquez l'adresse du site de l'école : IziNote récupère son logo.
      <a href="https://www.google.com/search?q=${encodeURIComponent(school.name + ' site officiel')}" target="_blank" rel="noopener">Trouver le site de « ${esc(school.name)} »</a></p>
      <div class="row"><input class="input" id="lsite" placeholder="ex. lycee-jean-moulin.fr" autocapitalize="off" spellcheck="false"><button class="btn" id="lsearch">Chercher</button></div>
      <div class="logo-choices" id="lchoices"></div>`,
    actions: [
      { label: 'Annuler', value: false },
      { label: 'Enregistrer', value: true, cls: 'primary' },
    ],
    onOpen: w => {
      const show = (src, isUrl) => {
        chosen = src;
        chosenIsUrl = isUrl;
        $('#lp', w).innerHTML = src ? `<img src="${esc(src)}" alt="">` : '<span class="muted">Pas de logo</span>';
      };
      $('#lfile', w).onclick = async () => {
        const [f] = await pickFiles({ accept: 'image/*' });
        if (!f) return;
        try {
          show(await imageToDataUrl(f, 300), false);
        } catch (e) {
          toast('Image illisible.', 'error');
        }
      };
      $('#lnone', w).onclick = () => show(null, false);
      $('#lsearch', w).onclick = () => {
        let site = $('#lsite', w).value.trim();
        if (!site) return toast("Indiquez l'adresse du site.", 'error');
        let domain;
        try {
          domain = new URL(/^https?:/i.test(site) ? site : 'https://' + site).hostname;
        } catch {
          return toast('Adresse invalide.', 'error');
        }
        const cands = [
          `https://www.google.com/s2/favicons?domain=${domain}&sz=256`,
          `https://icons.duckduckgo.com/ip3/${domain}.ico`,
          `https://${domain}/apple-touch-icon.png`,
        ];
        const box = $('#lchoices', w);
        box.innerHTML = '<p class="muted small">Touchez le logo à garder :</p>';
        cands.forEach(u => {
          const img = new Image();
          img.onload = () => {
            if (img.naturalWidth < 24) return;
            const b = document.createElement('button');
            b.className = 'logo-choice';
            b.appendChild(img);
            b.onclick = async () => {
              try {
                show(await imageToDataUrl(u, 300), false);
              } catch {
                show(u, true); // le site interdit la copie : on garde le lien
              }
            };
            box.appendChild(b);
          };
          img.src = u;
        });
        setTimeout(() => {
          if (!box.querySelector('.logo-choice')) box.innerHTML = '<p class="muted small">Aucun logo trouvé pour ce site. Vous pouvez enregistrer une image du logo sur la tablette puis la choisir ci-dessus.</p>';
        }, 4000);
      };
    },
  });
  if (!r) return;
  school.logo = chosen && !chosenIsUrl ? chosen : null;
  school.logoUrl = chosen && chosenIsUrl ? chosen : null;
  await db.put('schools', school);
  router();
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
    <div class="page-head"><div class="title-logo"><button class="school-logo-btn" id="logo" title="Changer le logo">${schoolLogo(school)}</button><h1>${esc(school.name)}</h1></div>
      <div class="row"><button class="btn primary" id="add">+ Classe</button>${menuButton([
        { label: "Logo de l'école", act: 'logo' },
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
  $('#logo').onclick = view.querySelector('[data-act=logo]').onclick = () => editSchoolLogo(school);
  $('#add').onclick = async () => {
    const v = await form('Nouvelle classe', [
      { name: 'name', label: 'Nom de la classe', required: true, placeholder: 'Ex. BTS SIO 1A' },
      { name: 'year', label: 'Année scolaire (facultatif)', placeholder: 'Ex. 2026-2027' },
      { name: 'sem', label: 'Nom de la première période', value: 'Semestre 1', help: 'Vous pourrez la clôturer plus tard pour passer à la suivante.' },
    ], 'Ajouter');
    if (v) {
      const sem = { id: db.uid(), name: v.sem || 'Semestre 1', startedAt: Date.now() };
      const c = await db.put('classes', { schoolId: id, name: v.name, year: v.year, semesters: [sem], currentSemesterId: sem.id, createdAt: Date.now() });
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

// ---------------- Semestres ----------------
// Les classes créées avant l'ajout des semestres reçoivent un « Semestre 1 » qui contient leurs devoirs existants.
async function ensureSemesters(cls) {
  if (!cls.semesters || !cls.semesters.length) {
    const sem = { id: db.uid(), name: 'Semestre 1', startedAt: cls.createdAt || Date.now() };
    cls.semesters = [sem];
    cls.currentSemesterId = sem.id;
    await db.put('classes', cls);
  }
  return cls.semesters.find(s => s.id === cls.currentSemesterId) || cls.semesters[cls.semesters.length - 1];
}

async function closeSemester(cls, current) {
  const n = cls.semesters.length + 1;
  let v = null;
  const ok = await modal({
    title: 'Clôturer la période',
    body: `<p>« ${esc(current.name)} » sera archivée : ses devoirs restent consultables dans les archives de la classe, et les nouveaux devoirs iront dans la nouvelle période.</p>
      <p class="muted small">Conseil : exportez d'abord les notes en Excel pour vos bulletins.</p>
      <div class="row wrap"><button class="btn" id="xl">📊 Exporter les notes de « ${esc(current.name)} »</button></div>
      <label class="field"><span>Nom de la période qui se termine</span><input class="input" id="oldName" value="${esc(current.name)}"></label>
      <label class="field"><span>Nom de la nouvelle période</span><input class="input" id="newName" value="Semestre ${n}"></label>`,
    actions: [
      { label: 'Annuler', value: false },
      { label: 'Clôturer et démarrer la nouvelle période', value: true, cls: 'primary' },
    ],
    onOpen: w => {
      $('#xl', w).onclick = () => exportClassXlsx(cls.id, current.id, current.name).catch(e => toast(e.message, 'error'));
    },
    validate: (x, w) => {
      v = { oldName: $('#oldName', w).value.trim() || current.name, newName: $('#newName', w).value.trim() };
      if (!v.newName) {
        toast('Donnez un nom à la nouvelle période.', 'error');
        return false;
      }
      return true;
    },
  });
  if (!ok) return;
  current.name = v.oldName;
  current.closedAt = Date.now();
  const sem = { id: db.uid(), name: v.newName, startedAt: Date.now() };
  cls.semesters.push(sem);
  cls.currentSemesterId = sem.id;
  await db.put('classes', cls);
  toast(`« ${current.name} » archivée. Bonne rentrée dans « ${sem.name} » !`, 'success');
  router();
}

async function chooseSemester(cls, title) {
  if (cls.semesters.length < 2) return { id: cls.semesters[0].id, name: cls.semesters[0].name };
  const v = await form(title, [
    {
      name: 'sem',
      label: 'Période',
      type: 'select',
      value: cls.currentSemesterId,
      options: [...cls.semesters.map(s => ({ value: s.id, label: s.name + (s.closedAt ? ' (archivée)' : ' (en cours)') })), { value: 'all', label: 'Toute l’année' }],
    },
  ], 'Exporter');
  if (!v) return null;
  const s = cls.semesters.find(x => x.id === v.sem);
  return { id: v.sem, name: s ? s.name : 'Année' };
}

// ---------------- Classe : devoirs + étudiants ----------------
function assignmentItem(a, s, nStudents) {
  const pct = nStudents ? Math.round((s.done / nStudents) * 100) : 0;
  return `<a class="list-item" href="#/devoir/${a.id}">
    <div class="li-main"><b>${esc(a.title)}</b><small>${kindLabel(a.kind)}${a.subject ? ' · ' + esc(a.subject) : ''}${a.dueDate ? ' · ' + esc(fmtDate(dateOf(a).getTime())) : ''} · ${a.grid && a.grid.criteria.length ? (a.grid.mode === 'note' ? 'Notation' : 'Acquis / non acquis') : 'Pas de grille'}</small></div>
    <div class="li-side"><div class="progress"><span style="width:${pct}%"></span></div><small>${s.done}/${nStudents} évalués${s.sent ? ` · ${s.sent} envoyés` : ''}</small></div>
  </a>`;
}

async function classView(id) {
  const cls = await db.get('classes', id);
  if (!cls) return go('#/');
  const current = await ensureSemesters(cls);
  const students = (await db.by('students', 'classId', id)).sort(db.sortStudents);
  const all = (await db.by('assignments', 'classId', id)).sort((a, b) => dateOf(b) - dateOf(a) || (b.createdAt || 0) - (a.createdAt || 0));
  const stats = {};
  for (const a of all) {
    const copies = await db.by('copies', 'assignmentId', a.id);
    stats[a.id] = {
      done: copies.filter(c => c.status === 'done' && students.some(s => s.id === c.studentId)).length,
      sent: copies.filter(c => c.sentAt && students.some(s => s.id === c.studentId)).length,
    };
  }
  const inSem = semId => all.filter(a => semesterOf(cls, a) === semId);
  const archived = cls.semesters.filter(s => s.id !== current.id).reverse();
  view.innerHTML = `<div class="page-wrap">
    ${crumbs(await chain({ cls }))}
    <div class="page-head"><h1>${esc(cls.name)}${cls.year ? ` <small>${esc(cls.year)}</small>` : ''}</h1>
      <div class="row">
        <button class="btn" id="dist">✉ Envoyer un document</button>
        <button class="btn" id="xls">📊 Exporter les notes</button>
        ${menuButton([
          { label: 'Renommer la classe', act: 'rename' },
          { label: `Clôturer « ${current.name} » et démarrer une nouvelle période`, act: 'close' },
          { label: 'Supprimer la classe (fin d’année)', act: 'delete', danger: true },
        ])}</div></div>

    <section>
      <div class="sec-head"><h2>Évaluations <span class="chip">${esc(current.name)}</span></h2><button class="btn primary" id="addA">+ Évaluation</button></div>
      ${
        inSem(current.id).length
          ? `<div class="list">${inSem(current.id).map(a => assignmentItem(a, stats[a.id], students.length)).join('')}</div>`
          : `<p class="muted">Aucune évaluation pour cette période. Ajoutez un devoir, un projet, un oral ou un travail de groupe.</p>`
      }
      ${archived
        .map(
          sem => `<details class="archive"><summary>🗄 ${esc(sem.name)} <small class="muted">archivée${sem.closedAt ? ' le ' + fmtDate(sem.closedAt) : ''} · ${inSem(sem.id).length} évaluation${inSem(sem.id).length > 1 ? 's' : ''}</small></summary>
          <div class="list">${inSem(sem.id).map(a => assignmentItem(a, stats[a.id], students.length)).join('') || '<p class="muted" style="padding:12px">Aucune évaluation.</p>'}</div></details>`
        )
        .join('')}
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
                <div class="row"><a class="btn small ghost" href="#/etudiant/${s.id}">Récap</a><button class="icon-btn" data-edit="${s.id}" title="Modifier">✎</button><button class="icon-btn" data-del="${s.id}" title="Supprimer">🗑</button></div>
              </div>`
              )
              .join('')}</div>`
          : `<p class="muted">Aucun étudiant. Ajoutez-les un par un ou collez une liste.</p>`
      }
      ${mailingsSection(cls)}
    </section>
  </div>`;

  $('#dist').onclick = () => {
    if (!students.some(s => s.email)) return toast('Aucun élève de cette classe n’a d’adresse e-mail.', 'error');
    distributeDialog(cls, students, () => router());
  };

  $('#addA').onclick = async () => {
    const subjects = [...new Set([...all.map(a => a.subject), ...(await db.all('grids')).map(g => g.subject)].filter(Boolean))].sort();
    const v = await form('Nouvelle évaluation', [
      { name: 'title', label: 'Titre', required: true, placeholder: 'Ex. Exercice 3 – Les fonctions' },
      { name: 'kind', label: 'Type', type: 'select', value: 'devoir', options: KINDS },
      { name: 'subject', label: 'Matière (facultatif)', datalist: subjects, placeholder: 'Ex. Mathématiques' },
      { name: 'dueDate', label: 'Date (de rendu pour un devoir)', type: 'date', value: new Date().toISOString().slice(0, 10), help: 'Ensuite, sur la page du devoir : consignes, documents de travail, envoi aux élèves et rappels.' },
    ], 'Créer');
    if (!v) return;
    const a = await db.put('assignments', { classId: id, semesterId: current.id, title: v.title, kind: v.kind, subject: v.subject, dueDate: v.dueDate, grid: newGrid('note'), groups: [], createdAt: Date.now() });
    go('#/devoir/' + a.id);
  };
  $('#xls').onclick = async () => {
    const sem = await chooseSemester(cls, 'Exporter les notes (Excel)');
    if (!sem) return;
    try {
      await exportClassXlsx(id, sem.id, sem.name);
    } catch (e) {
      console.error(e);
      toast(e.message, 'error');
    }
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
  view.querySelector('[data-act=close]').onclick = () => closeSemester(cls, current);
  view.querySelector('[data-act=rename]').onclick = async () => {
    const v = await form('Modifier la classe', [
      { name: 'name', label: 'Nom', value: cls.name, required: true },
      { name: 'year', label: 'Année scolaire', value: cls.year || '' },
      { name: 'sem', label: 'Nom de la période en cours', value: current.name, required: true },
    ]);
    if (v) {
      cls.name = v.name;
      cls.year = v.year;
      current.name = v.sem;
      await db.put('classes', cls);
      router();
    }
  };
  view.querySelector('[data-act=delete]').onclick = async () => {
    if (
      await confirmTyped(
        'Supprimer la classe',
        `La classe « ${cls.name} », ses ${students.length} étudiants, ses ${all.length} évaluations et toutes les copies seront définitivement supprimés. Pensez à exporter les notes et à faire une sauvegarde avant (Réglages).`,
        cls.name
      )
    ) {
      for (const a of all) await hw.cancelPending(a).catch(e => console.warn(e));
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

// ---------------- Étudiant : récapitulatif (livret scolaire) ----------------
async function studentView(id, semParam) {
  const s = await db.get('students', id);
  if (!s) return go('#/');
  const cls = await db.get('classes', s.classId);
  const current = await ensureSemesters(cls);
  const semId = semParam || current.id;
  const { assignments, copyOf } = await classData(s.classId, semId);
  assignments.reverse();
  const avg = average(assignments, copyOf, s);
  const semName = semId === 'all' ? 'Toute l’année' : (cls.semesters.find(x => x.id === semId) || current).name;
  const comps = {};
  for (const a of assignments) {
    const c = copyOf(a, s);
    if (!c || c.status !== 'done' || !a.grid || a.grid.mode !== 'acquis') continue;
    for (const cr of a.grid.criteria) {
      const v = c.evaluation[cr.id];
      if (v == null) continue;
      (comps[cr.label] = comps[cr.label] || []).push({ a, level: a.grid.levels[v], top: v === a.grid.levels.length - 1, idx: v, n: a.grid.levels.length });
    }
  }
  const groupName = a => (a.groups || []).find(g => g.studentIds.includes(id))?.name;
  view.innerHTML = `<div class="page-wrap">
    ${crumbs([...(await chain({ cls })), { label: studentName(s) }])}
    <div class="page-head"><h1>${esc(studentName(s))}</h1>
      <div class="row"><button class="btn primary" id="pdf">⬇ Récap PDF</button><button class="btn" id="edit">✎ Modifier</button></div></div>
    <p class="muted">${s.email ? esc(s.email) : 'Pas d’adresse e-mail'}</p>
    <div class="seg">${[...cls.semesters.map(x => ({ id: x.id, name: x.name })), { id: 'all', name: 'Toute l’année' }]
      .map(x => `<a class="${x.id === semId ? 'on' : ''}" href="#/etudiant/${id}/${x.id}">${esc(x.name)}</a>`)
      .join('')}</div>
    <div class="summary" style="margin-top:12px">
      <div class="sum-box"><b>${avg == null ? '–' : fmtNum(avg)}</b><span>moyenne /20</span></div>
      <div class="sum-box"><b>${assignments.filter(a => copyOf(a, s)?.status === 'done').length}/${assignments.length}</b><span>évaluations faites</span></div>
    </div>
    <h2>Évaluations · ${esc(semName)}</h2>
    <div class="list">${
      assignments
        .map(a => {
          const c = copyOf(a, s);
          const r = c ? computeResult(a.grid, c.evaluation) : null;
          const g = groupName(a);
          return `<a class="list-item" href="#/corriger/${a.id}/${id}"><div class="li-main"><b>${esc(a.title)}</b>
            <small>${kindLabel(a.kind)}${g ? ' · ' + esc(g) : ''}${a.subject ? ' · ' + esc(a.subject) : ''} · ${esc(shortDate(dateOf(a)))} · ${statusLabel(c, a)}</small>
            ${c && c.status === 'done' && c.comment ? `<small class="comment-snip">« ${esc(c.comment.slice(0, 140))}${c.comment.length > 140 ? '…' : ''} »</small>` : ''}</div>
            <div class="li-side">${r && r.short && c.status === 'done' ? `<span class="score">${esc(r.short)}</span>` : ''}</div></a>`;
        })
        .join('') || '<p class="muted" style="padding:14px">Aucune évaluation sur cette période.</p>'
    }</div>
    ${
      Object.keys(comps).length
        ? `<h2>Compétences</h2><div class="list">${Object.entries(comps)
            .map(
              ([label, list]) => `<div class="list-item"><div class="li-main"><b>${esc(label)}</b><small>${list.map(x => esc(x.a.title)).join(' · ')}</small></div>
              <div class="li-side row">${list.map(x => `<span class="lvl on lvl-${Math.round((x.idx / Math.max(1, x.n - 1)) * 2)}">${esc(x.level)}</span>`).join('')}</div></div>`
            )
            .join('')}</div>`
        : ''
    }
  </div>`;
  $('#edit').onclick = () => editStudent(s, s.classId);
  $('#pdf').onclick = () => {
    const b = busy('Création du récap PDF…');
    studentRecapPdf(s, semId, semName).catch(e => toast(e.message, 'error')).finally(b.done);
  };
}

function statusLabel(c, a) {
  const noCopy = a && (a.kind === 'oral' || a.kind === 'groupe');
  if (!c || (!c.pdf && c.status !== 'done')) return noCopy ? '<span class="tag todo">À évaluer</span>' : '<span class="tag">Pas de copie</span>';
  const mk = c.evaluation && c.evaluation._mark;
  if (mk === 'absent') return '<span class="tag">🚫 Absent</span>';
  if (mk === 'missing' && !c.sentAt) return '<span class="tag err">📭 Non rendu</span>';
  if (c.sentAt) return `<span class="tag sent">Envoyée le ${fmtDate(c.sentAt)}</span>`;
  if (c.status === 'done') return `<span class="tag done">${noCopy ? 'Évalué' : 'Corrigée'}</span>${sched.scheduleTag(c)}`;
  return '<span class="tag todo">À corriger</span>';
}

// ---------------- Devoir / oral / groupe ----------------
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
  const isGroup = a.kind === 'groupe';
  const isOral = a.kind === 'oral';
  const groups = a.groups || [];
  const groupOf = sid => groups.find(g => g.studentIds.includes(sid));

  const studentRow = s => {
    const c = copyOf(s.id);
    const r = c ? computeResult(grid, c.evaluation) : null;
    const g = groupOf(s.id);
    return `<div class="list-item">
      <a class="li-main" href="#/corriger/${id}/${s.id}"><b>${esc(studentName(s))}</b><small>${statusLabel(c, a)}${g ? ' · 👥 ' + esc(g.name) + (c && c.override ? ' (note individualisée)' : '') : ''}${c && c.fileName ? ' · ' + esc(c.fileName) : ''}</small></a>
      <div class="li-side row">
        ${r && r.short && (c.status === 'done' || Object.keys(c.evaluation || {}).length) ? `<span class="score ${c.status === 'done' ? '' : 'partial'}">${esc(r.short)}</span>` : ''}
        ${isOral || isGroup ? '' : `<button class="icon-btn" data-up="${s.id}" title="${c && c.pdf ? 'Remplacer le PDF' : 'Importer le PDF'}">📎</button>`}
        <a class="btn small ${c && c.status === 'done' ? '' : (c && c.pdf) || isOral ? 'primary' : ''}" href="#/corriger/${id}/${s.id}">${c && c.status === 'done' ? 'Revoir' : isOral || isGroup ? 'Évaluer' : 'Corriger'}</a>
      </div></div>`;
  };

  view.innerHTML = `<div class="page-wrap">
    ${crumbs([...(await chain({ cls })), { label: a.title }])}
    <div class="page-head"><div><h1>${esc(a.title)}</h1><p class="muted" style="margin:4px 0 0">${kindLabel(a.kind)}${a.subject ? ' · ' + esc(a.subject) : ''} · ${esc(shortDate(dateOf(a)))}</p></div>${menuButton([
      { label: 'Modifier (titre, type, matière, date)', act: 'rename' },
      { label: 'Supprimer cette évaluation', act: 'delete', danger: true },
    ])}</div>

    <div class="summary">
      <div class="sum-box"><b>${done}/${students.length}</b><span>${isOral || isGroup ? 'évalués' : 'corrigées'}</span></div>
      <div class="sum-box"><b>${sent}</b><span>envoyées</span></div>
      <div class="sum-box grow"><span>Grille : ${grid.criteria.length ? `${grid.mode === 'note' ? 'notation' + (grid.scaleTo ? ' sur ' + grid.scaleTo : '') : 'acquis / non acquis'}, ${grid.criteria.length} critère${grid.criteria.length > 1 ? 's' : ''}` : '<span class="warn">à créer</span>'}</span>
        <a class="btn small" href="#/grille/devoir/${id}">${grid.criteria.length ? 'Modifier la grille' : 'Créer la grille'}</a></div>
    </div>

    ${hw.homeworkSection(a)}

    ${allDone && sent < students.length ? `<div class="banner success">✓ Toute la classe est évaluée. Vous pouvez envoyer les résultats.</div>` : ''}

    <div class="row wrap actions-bar">
      ${isOral || isGroup ? '' : '<button class="btn" id="import">📄 Importer des copies (PDF)</button>'}
      <button class="btn primary" id="send" ${done ? '' : 'disabled'}>✉ Envoyer ${isOral || isGroup ? 'les résultats' : 'les corrections'}</button>
      <button class="btn ghost" id="dlAll" ${done ? '' : 'disabled'}>⬇ Télécharger les fiches</button>
    </div>

    ${
      isGroup
        ? `<section><div class="sec-head"><h2>Groupes <small>(${groups.length})</small></h2><button class="btn primary" id="addG">+ Groupe</button></div>
          <p class="muted small">Évaluez le groupe une fois : la note, la grille et le commentaire sont reportés automatiquement sur la fiche de chaque membre. Pour individualiser la note d'un élève, ouvrez sa ligne plus bas.</p>
          ${
            groups.length
              ? `<div class="list">${groups
                  .map(g => {
                    const gc = copyOf('g_' + g.id);
                    const r = gc ? computeResult(grid, gc.evaluation) : null;
                    return `<div class="list-item"><a class="li-main" href="#/corriger/${id}/g_${g.id}"><b>👥 ${esc(g.name)}</b><small>${g.studentIds.map(sid => students.find(s => s.id === sid)).filter(Boolean).map(studentName).map(esc).join(', ') || 'Aucun membre'}</small></a>
                    <div class="li-side row">${r && r.short && gc.status === 'done' ? `<span class="score">${esc(r.short)}</span>` : ''}
                      <button class="icon-btn" data-editg="${g.id}" title="Modifier le groupe">✎</button><button class="icon-btn" data-delg="${g.id}" title="Supprimer le groupe">🗑</button>
                      <a class="btn small ${gc && gc.status === 'done' ? '' : 'primary'}" href="#/corriger/${id}/g_${g.id}">${gc && gc.status === 'done' ? 'Revoir' : 'Évaluer'}</a></div></div>`;
                  })
                  .join('')}</div>`
              : '<p class="muted">Aucun groupe. Créez les groupes puis évaluez-les.</p>'
          }</section><h2>Élèves</h2>`
        : ''
    }

    <div class="list">${students.map(studentRow).join('') || `<p class="muted" style="padding:14px">Aucun étudiant dans cette classe. <a href="#/classe/${cls.id}">Ajoutez-les ici.</a></p>`}</div></div>`;

  hw.bindHomework(a, students, () => router());
  if ($('#import')) $('#import').onclick = () => bulkImport(a, students, copies);
  $$('[data-up]').forEach(b => (b.onclick = () => uploadFor(a, students.find(s => s.id === b.dataset.up), copyOf(b.dataset.up))));
  $('#send').onclick = () => sendDialog(a, cls, students, copies);
  $('#dlAll').onclick = () => downloadAll(a, cls, students, copies);
  if ($('#addG')) $('#addG').onclick = () => editGroup(a, students, null);
  $$('[data-editg]').forEach(b => (b.onclick = () => editGroup(a, students, groups.find(g => g.id === b.dataset.editg))));
  $$('[data-delg]').forEach(
    b =>
      (b.onclick = async () => {
        const g = groups.find(x => x.id === b.dataset.delg);
        if (!(await confirmBox('Supprimer le groupe', `Supprimer « ${g.name} » ? Les notes déjà reportées sur les fiches des élèves sont conservées.`, 'Supprimer', true))) return;
        a.groups = groups.filter(x => x !== g);
        const gc = copyOf('g_' + g.id);
        if (gc) await db.del('copies', gc.id);
        await db.put('assignments', a);
        router();
      })
  );
  view.querySelector('[data-act=rename]').onclick = async () => {
    const subjects = [...new Set((await db.all('assignments')).map(x => x.subject).filter(Boolean))].sort();
    const v = await form('Modifier l’évaluation', [
      { name: 'title', label: 'Titre', value: a.title, required: true },
      { name: 'kind', label: 'Type', type: 'select', value: a.kind || 'devoir', options: KINDS },
      { name: 'subject', label: 'Matière', value: a.subject || '', datalist: subjects },
      { name: 'dueDate', label: 'Date', type: 'date', value: a.dueDate || '' },
    ]);
    if (v) {
      const moved = v.dueDate !== a.dueDate;
      Object.assign(a, v);
      // date de rendu changée : les rappels déjà programmés suivent
      if (moved && a.dueDate && a.handout) await hw.planMails(a, await db.getSettings()).catch(e => toast(e.message, 'error'));
      await db.put('assignments', a);
      router();
    }
  };
  view.querySelector('[data-act=delete]').onclick = async () => {
    if (await confirmTyped('Supprimer l’évaluation', 'Toutes les copies et évaluations liées seront supprimées.', a.title)) {
      await hw.cancelPending(a).catch(e => console.warn(e)); // devoir et rappels pas encore partis
      await db.deleteAssignment(id);
      go('#/classe/' + cls.id);
    }
  };
}

async function editGroup(a, students, g) {
  const others = (a.groups || []).filter(x => x !== g);
  const taken = sid => others.find(x => x.studentIds.includes(sid));
  let v = null;
  const ok = await modal({
    title: g ? 'Modifier le groupe' : 'Nouveau groupe',
    body: `<label class="field"><span>Nom du groupe</span><input class="input" id="gname" value="${esc(g ? g.name : 'Groupe ' + (others.length + 1))}"></label>
      <div class="field"><span>Membres</span><div class="send-list">${students
        .map(s => {
          const t = taken(s.id);
          return `<label class="send-row ${t ? 'disabled' : ''}"><input type="checkbox" value="${s.id}" ${g && g.studentIds.includes(s.id) ? 'checked' : ''} ${t ? 'disabled' : ''}><span class="sr-name">${esc(studentName(s))}</span><span class="sr-status">${t ? esc(t.name) : ''}</span></label>`;
        })
        .join('')}</div></div>`,
    actions: [
      { label: 'Annuler', value: false },
      { label: 'Enregistrer', value: true, cls: 'primary' },
    ],
    validate: (x, w) => {
      v = { name: $('#gname', w).value.trim(), ids: $$('input[type=checkbox]:checked', w).map(i => i.value) };
      if (!v.name) return toast('Donnez un nom au groupe.', 'error'), false;
      if (!v.ids.length) return toast('Choisissez au moins un membre.', 'error'), false;
      return true;
    },
  });
  if (!ok) return;
  if (g) Object.assign(g, { name: v.name, studentIds: v.ids });
  else (a.groups = a.groups || []).push({ id: db.uid(), name: v.name, studentIds: v.ids });
  await db.put('assignments', a);
  // si le groupe était déjà évalué, on reporte sur les (nouveaux) membres
  const gid = (g || a.groups[a.groups.length - 1]).id;
  const gc = (await db.by('copies', 'assignmentId', a.id)).find(c => c.studentId === 'g_' + gid);
  if (gc) await propagateGroup(a, gc);
  router();
}

// Reporte l'évaluation d'un groupe sur la fiche de chacun de ses membres (sauf note individualisée).
async function propagateGroup(a, gc) {
  const g = (a.groups || []).find(x => 'g_' + x.id === gc.studentId);
  if (!g) return;
  const copies = await db.by('copies', 'assignmentId', a.id);
  for (const sid of g.studentIds) {
    const mc = copies.find(c => c.studentId === sid) || { assignmentId: a.id, studentId: sid };
    if (mc.override) continue;
    // la participation individuelle de l'élève est gardée
    const evaluation = JSON.parse(JSON.stringify(gc.evaluation || {}));
    delete evaluation._part;
    delete evaluation._bonus;
    if (mc.evaluation && mc.evaluation._part) evaluation._part = mc.evaluation._part;
    if (mc.evaluation && mc.evaluation._bonus && mc.evaluation._bonus.length) evaluation._bonus = mc.evaluation._bonus;
    Object.assign(mc, {
      evaluation,
      comment: gc.comment || '',
      status: gc.status,
      correctedAt: gc.correctedAt,
      annotations: JSON.parse(JSON.stringify(gc.annotations || {})),
      pdf: gc.pdf || null,
      pdfRev: gc.pdf ? gc.pdfRev || null : null,
      fileName: gc.fileName || null,
      fromGroup: g.id,
    });
    await db.put('copies', mc);
  }
}

async function getOrCreateCopy(assignmentId, studentId) {
  const list = await db.by('copies', 'assignmentId', assignmentId);
  return list.find(c => c.studentId === studentId) || { assignmentId, studentId, annotations: {}, evaluation: {}, comment: '', status: 'todo' };
}

// Ajoute un ou plusieurs documents (PDF, Word .docx, photos) à une copie.
// append = true : les pages sont ajoutées à la suite (les annotations existantes sont gardées).
async function attachPdf(copy, files, append = false) {
  files = Array.isArray(files) ? files : [files];
  for (const f of files) {
    const err = checkSupported(f);
    if (err) throw new Error(err);
  }
  const b = busy('Préparation du document…');
  try {
    const keep = append && copy.pdf instanceof Blob;
    copy.pdf = await filesToPdfBlob(files, keep ? copy.pdf : null, b.set);
    copy.pdfRev = null; // nouveau PDF : il sera renvoyé aux autres appareils
    const names = files.map(f => f.name);
    copy.fileName = keep && copy.fileName ? [copy.fileName, ...names].join(' + ') : names.join(' + ');
    if (!keep) copy.annotations = {};
    copy.sentAt = null;
    await db.put('copies', copy);
  } finally {
    b.done();
  }
}

// Demande « ajouter à la suite » ou « remplacer » quand la copie a déjà un document.
async function askAppend(who) {
  return modal({
    title: 'Cet élève a déjà une copie',
    body: `<p>Que faire des nouveaux documents de ${esc(who)} ?</p>`,
    actions: [
      { label: 'Annuler', value: null },
      { label: 'Remplacer la copie', value: 'replace', cls: 'danger' },
      { label: 'Ajouter à la suite', value: 'append', cls: 'primary' },
    ],
  });
}

async function uploadFor(a, s, existing) {
  let append = false;
  if (existing && existing.pdf) {
    const r = await askAppend(studentName(s));
    if (!r) return;
    append = r === 'append';
  }
  const files = await pickFiles({ accept: ACCEPT_DOCS, multiple: true });
  if (!files.length) return;
  try {
    await attachPdf(existing || (await getOrCreateCopy(a.id, s.id)), files, append);
    toast(files.length > 1 ? `${files.length} documents ajoutés` : 'Copie importée', 'success');
    router();
  } catch (e) {
    console.error(e);
    toast(e.message, 'error');
  }
}

// Import groupé : on devine l'étudiant d'après le nom du fichier.
function guessStudent(fileName, students) {
  const n = ' ' + normalize(fileName.replace(/\.[a-z0-9]+$/i, '')).replace(/[^a-z0-9]+/g, ' ') + ' ';
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
  const files = (await pickFiles({ accept: ACCEPT_DOCS, multiple: true })).sort((x, y) => x.name.localeCompare(y.name, 'fr', { numeric: true }));
  if (!files.length) return;
  const rows = files.map(f => ({ f, s: guessStudent(f.name, students) }));
  // champ de recherche (avec suggestions) plutôt qu'une longue liste déroulante
  const names = new Map(students.map(x => [normalize(studentName(x)), x.id]));
  const pick = s => `<input class="input" type="search" list="dl-import-students" value="${s ? esc(studentName(s)) : ''}" placeholder="🔍 Élève (vide = ne pas importer)" autocomplete="off">`;
  const icon = f => (/\.docx$/i.test(f.name) ? '📝' : /^image\//.test(f.type) ? '🖼' : '📄');
  let mapping = null,
    append = true;
  const hasExisting = copies.some(c => c.pdf);
  const ok = await modal({
    title: `Importer ${files.length} document${files.length > 1 ? 's' : ''}`,
    wide: true,
    body: `<p class="muted">Vérifiez à quel étudiant correspond chaque fichier (deviné d'après son nom). Plusieurs fichiers pour un même étudiant sont assemblés en une seule copie. Les fichiers Word et les photos sont convertis en PDF.</p>
      <div class="map-list">${rows
        .map(r => `<div class="map-row"><span class="fname">${icon(r.f)} ${esc(r.f.name)}</span>${pick(r.s)}</div>`)
        .join('')}</div>
      <datalist id="dl-import-students">${students.map(x => `<option value="${esc(studentName(x))}">`).join('')}</datalist>
      ${hasExisting ? '<label class="check"><input type="checkbox" id="append" checked> Si l’élève a déjà une copie, ajouter ces documents à la suite (sinon, la remplacer)</label>' : ''}`,
    actions: [
      { label: 'Annuler', value: false },
      { label: 'Importer', value: true, cls: 'primary' },
    ],
    validate: (v, w) => {
      const inputs = $$('.map-row input', w);
      mapping = inputs.map(i => (i.value.trim() ? names.get(normalize(i.value.trim())) || null : ''));
      const bad = inputs.find((i, k) => mapping[k] === null);
      if (bad) {
        bad.focus();
        toast(`Élève introuvable : « ${bad.value.trim()} ». Choisissez un nom dans la liste.`, 'error');
        return false;
      }
      if ($('#append', w)) append = $('#append', w).checked;
      return true;
    },
  });
  if (!ok) return;
  const byStudent = new Map();
  rows.forEach((r, i) => mapping[i] && byStudent.set(mapping[i], [...(byStudent.get(mapping[i]) || []), r.f]));
  let n = 0;
  for (const [sid, list] of byStudent) {
    const copy = copies.find(c => c.studentId === sid) || (await getOrCreateCopy(a.id, sid));
    try {
      await attachPdf(copy, list, append);
      n++;
    } catch (e) {
      console.error(e);
      toast(e.message, 'error');
    }
  }
  toast(`${n} copie${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''}`, 'success');
  router();
}

async function downloadAll(a, cls, students, copies) {
  const settings = await db.getSettings();
  const list = students.map(s => ({ s, c: copies.find(c => c.studentId === s.id) })).filter(x => x.c && x.c.status === 'done');
  const b = busy(`Préparation de ${list.length} PDF…`);
  let n = 0;
  for (const { s, c } of list) {
    b.set(`PDF ${++n} / ${list.length} : ${studentName(s)}`);
    try {
      const bytes = await buildCorrectedPdf({ copy: c, student: s, assignment: a, cls, settings });
      download(new Blob([bytes], { type: 'application/pdf' }), correctedFileName(s, a));
      await new Promise(r => setTimeout(r, 400));
    } catch (e) {
      toast(`${studentName(s)} : ${e.message}`, 'error');
    }
  }
  b.done();
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
  const relay = sched.hasRelay(settings);
  const rows = students.map(s => ({ s, c: copies.find(c => c.studentId === s.id) }));
  const notDone = rows.filter(r => !r.c || r.c.status !== 'done');
  const pad = n => String(n).padStart(2, '0');
  const toLocalInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(18, 0, 0, 0);
  const statusOf = (s, c) => {
    if (!s.email) return 'pas d’e-mail';
    if (!c || c.status !== 'done') return 'non corrigée';
    if (c.evaluation && c.evaluation._mark === 'absent' && !c.sentAt) return 'absent (non coché)';
    if (c.sentAt) return `déjà envoyée le ${fmtDate(c.sentAt)}`;
    if (c.scheduledAt) return c.scheduleError ? `programmation en échec : ${c.scheduleError}` : `⏰ programmée : ${sched.fmtDateTime(c.scheduledAt)}`;
    return '';
  };
  const body = `
    ${notDone.length ? `<div class="banner warn">${notDone.length} copie${notDone.length > 1 ? 's ne sont' : ' n’est'} pas encore corrigée${notDone.length > 1 ? 's' : ''} : ${notDone.map(r => esc(studentName(r.s))).join(', ')}.</div>` : `<div class="banner success">Toute la classe est corrigée.</div>`}
    <p class="muted">Chaque étudiant coché recevra un e-mail avec sa copie corrigée en PDF (annotations + fiche d’évaluation) et votre commentaire.</p>
    <div class="send-list">${rows
      .map(({ s, c }) => {
        const can = c && c.status === 'done' && s.email;
        const planned = can && !c.sentAt && c.scheduledAt;
        const absent = c && c.evaluation && c.evaluation._mark === 'absent';
        return `<label class="send-row ${can ? '' : 'disabled'}"><input type="checkbox" data-s="${s.id}" ${can && !c.sentAt && !c.scheduledAt && !absent ? 'checked' : ''} ${can ? '' : 'disabled'}>
          <span class="sr-name">${esc(studentName(s))}<small>${esc(s.email || '')}</small></span><span class="sr-status" data-st="${s.id}">${esc(statusOf(s, c))}${planned ? ` <button type="button" class="linkbtn" data-unsched="${s.id}">annuler</button>` : ''}</span></label>`;
      })
      .join('')}</div>
    <div class="sched-box">
      <label class="check"><input type="checkbox" id="schedOn"> ⏰ Programmer l’envoi pour plus tard</label>
      <div id="schedFields" hidden>
        <input class="input" type="datetime-local" id="schedAt" value="${toLocalInput(tomorrow)}">
        <p class="muted small">${
          relay
            ? 'Les mails partiront de votre Gmail à l’heure prévue (à 5 minutes près), même si la tablette est éteinte. Les PDF sont préparés maintenant : si vous modifiez une copie ensuite, reprogrammez-la.'
            : 'Les mails partiront à l’heure prévue si IziNote est ouvert sur la tablette ; sinon, à la prochaine ouverture (Google peut demander un clic de confirmation). Pour un envoi même tablette éteinte, activez le « relais d’envoi programmé » dans les Réglages.'
        }</p>
      </div>
    </div>
    <details class="preview"><summary>Aperçu du message</summary><pre id="prev"></pre></details>`;

  await modal({
    title: `Envoyer les corrections – ${a.title}`,
    wide: true,
    body,
    actions: [{ label: 'Fermer', value: null }, { label: 'Envoyer', value: 'send', cls: 'primary' }],
    onOpen: (w, close) => {
      const first = rows.find(r => r.c && r.c.status === 'done') || rows[0];
      if (first) {
        const v = sched.mailVars(a, cls, first.s, first.c, settings);
        $('#prev', w).textContent = `À : ${first.s.email || '?'}\nObjet : ${gmail.fillTemplate(settings.mailSubject, v)}\n\n${gmail.fillTemplate(settings.mailBody, v)}\n\n📎 ${correctedFileName(first.s, a)}`;
      }
      const sendBtn = $('.modal-actions .primary', w);
      const schedOn = $('#schedOn', w);
      schedOn.onchange = () => {
        $('#schedFields', w).hidden = !schedOn.checked;
        sendBtn.textContent = schedOn.checked ? 'Programmer' : 'Envoyer';
      };
      const setStatus = (sid, text, cls = '') => {
        const st = $(`[data-st="${sid}"]`, w);
        st.textContent = text;
        st.className = 'sr-status ' + cls;
      };
      w.addEventListener('click', async e => {
        const b = e.target.closest('[data-unsched]');
        if (!b) return;
        e.preventDefault();
        const sid = b.dataset.unsched;
        const { c } = rows.find(r => r.s.id === sid);
        try {
          if (c.scheduledVia === 'relay') await sched.relayCancel(await db.getSettings(), [c.id]);
          sched.clearSchedule(c);
          await db.put('copies', c);
          setStatus(sid, 'programmation annulée');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      sendBtn.onclick = async () => {
        const ids = $$('input[data-s]:checked', w).map(i => i.dataset.s);
        if (!ids.length) return toast('Aucun étudiant sélectionné.', 'error');
        const later = schedOn.checked;
        let when = 0;
        if (later) {
          when = new Date($('#schedAt', w).value).getTime();
          if (!when || isNaN(when)) return toast('Choisissez une date et une heure.', 'error');
          if (when < Date.now() + 60000) return toast('Choisissez un moment dans le futur.', 'error');
        }
        sendBtn.disabled = true;
        if (!later) {
          try {
            await gmail.authorize(settings.googleClientId); // dans le clic : la fenêtre Google peut s'ouvrir
          } catch (e) {
            sendBtn.disabled = false;
            return toast(e.message, 'error');
          }
        }
        let ok = 0;
        for (const sid of ids) {
          const { s, c } = rows.find(r => r.s.id === sid);
          setStatus(sid, later ? 'programmation…' : 'envoi…', 'busy');
          try {
            if (!later) {
              await sched.sendNow(a, cls, s, c, settings);
              setStatus(sid, '✓ envoyée', 'ok');
            } else {
              if (relay) await sched.relaySchedule(settings, c, await sched.prepareMail(a, cls, s, c, settings), when);
              else if (c.scheduledVia === 'relay') await sched.relayCancel(settings, [c.id]).catch(() => {});
              sched.clearSchedule(c);
              c.scheduledAt = when;
              c.scheduledVia = relay ? 'relay' : 'local';
              await db.put('copies', c);
              setStatus(sid, `⏰ programmée : ${sched.fmtDateTime(when)}`, 'ok');
            }
            $(`input[data-s="${sid}"]`, w).checked = false;
            ok++;
          } catch (e) {
            console.error(e);
            setStatus(sid, '✗ ' + e.message, 'err');
          }
        }
        sendBtn.disabled = false;
        const n = ids.length;
        if (later) toast(`${ok}/${n} envoi${n > 1 ? 's' : ''} programmé${ok > 1 ? 's' : ''} pour ${sched.fmtDateTime(when)}`, ok === n ? 'success' : 'error');
        else toast(`${ok}/${n} mail${n > 1 ? 's' : ''} envoyé${ok > 1 ? 's' : ''}`, ok === n ? 'success' : 'error');
      };
    },
  });
  router();
}

// ---------------- Correction d'une copie ----------------
async function correctView(assignmentId, studentId) {
  const a = await db.get('assignments', assignmentId);
  if (!a) return go('#/');
  const isGroupCopy = studentId.startsWith('g_');
  const group = isGroupCopy ? (a.groups || []).find(g => 'g_' + g.id === studentId) : null;
  const s = isGroupCopy ? group && { id: studentId, firstName: '👥 ' + group.name, lastName: '', isGroup: true } : await db.get('students', studentId);
  if (!s) return go('#/devoir/' + assignmentId);
  const cls = await db.get('classes', a.classId);
  const students = (await db.by('students', 'classId', a.classId)).sort(db.sortStudents);
  const copy = await getOrCreateCopy(assignmentId, studentId);
  const settings = await db.getSettings();
  document.body.classList.add('fullscreen');
  // copie de groupe : sert à savoir si un membre a été individualisé
  const memberGroup = !isGroupCopy && (a.groups || []).find(g => g.studentIds.includes(studentId));
  const groupCopy = memberGroup ? await getOrCreateCopy(assignmentId, 'g_' + memberGroup.id) : null;
  // la participation individuelle (_part) ne rend pas la note « individualisée »
  const sig = c => JSON.stringify([{ ...(c.evaluation || {}), _part: undefined, _bonus: undefined }, c.comment || '', c.status || 'todo']);
  // copie de groupe : points de participation de chaque membre
  const members = [];
  if (isGroupCopy) {
    const copies = await db.by('copies', 'assignmentId', assignmentId);
    for (const sid of group.studentIds) {
      const st = students.find(x => x.id === sid);
      if (!st) continue;
      const mc = copies.find(c => c.studentId === sid);
      const ev = (mc && mc.evaluation) || {};
      members.push({ id: sid, name: studentName(st), first: st.firstName || studentName(st), part: +ev._part || 0, bonus: [...(ev._bonus || [])], comment: (mc && mc.individualComment) || '', override: !!(mc && mc.override) });
    }
  }
  const initialSig = sig(copy);
  const ctx = {
    copy,
    student: s,
    assignment: a,
    cls,
    settings,
    kind: a.kind || 'devoir',
    members,
    groupMember: !!memberGroup,
    // bonus, participation et commentaire individuel d'un membre du groupe
    updateMember: async m => {
      const mc = await getOrCreateCopy(assignmentId, m.id);
      mc.evaluation = mc.evaluation || {};
      if (m.part) mc.evaluation._part = m.part;
      else delete mc.evaluation._part;
      if (m.bonus.length) mc.evaluation._bonus = [...m.bonus];
      else delete mc.evaluation._bonus;
      mc.individualComment = m.comment || '';
      await db.put('copies', mc);
    },
    order: isGroupCopy ? (a.groups || []).map(g => 'g_' + g.id) : students.map(x => x.id),
    exit: () => go('#/devoir/' + assignmentId),
    goto: sid => go(`#/corriger/${assignmentId}/${sid}`),
    editGrid: () => go('#/grille/devoir/' + assignmentId),
    save: async c => {
      // on n'enregistre une copie vide (sans PDF ni saisie) que si quelque chose a été fait
      const touched = c.pdf || c.comment || Object.keys(c.evaluation || {}).length || c.status === 'done' || c.id;
      if (!touched) return;
      if (memberGroup && groupCopy && groupCopy.id && sig(c) !== initialSig) c.override = sig(c) !== sig(groupCopy);
      await db.put('copies', c);
      if (isGroupCopy) await propagateGroup(a, c);
    },
    importPdf: async (append = false) => {
      const files = await pickFiles({ accept: ACCEPT_DOCS, multiple: true });
      if (!files.length) return;
      try {
        await attachPdf(copy, files, append);
        router();
      } catch (e) {
        console.error(e);
        toast(e.message, 'error');
      }
    },
    saveSettings: st => db.saveSettings(st),
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
  const allSubjects = [...new Set([...(await db.all('grids')).map(g => g.subject), ...(await db.all('assignments')).map(x => x.subject)].filter(Boolean))].sort((x, y) => x.localeCompare(y, 'fr'));
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
      <label class="field"><span>Matière</span><input class="input" id="gsubject" list="dl-subj" value="${esc(owner.subject || '')}" placeholder="Ex. Mathématiques"><datalist id="dl-subj">${allSubjects.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
      <div class="import-box"><div><b>📷 Votre grille existe déjà sur papier ou en PDF ?</b><p class="muted small">IziNote la lit et remplit les critères pour vous (vous vérifiez ensuite).</p></div>
        <div class="row wrap"><button class="btn" id="impGrid">Importer un PDF ou une photo</button><button class="btn ghost" id="camGrid">📸 Photographier</button></div></div>
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
      ${
        grid.mode === 'note'
          ? `<h2>Malus <small>(facultatif)</small></h2>
      <p class="muted small">Points retirés de la note finale${grid.scaleTo ? ' (sur ' + grid.scaleTo + ')' : ''} quand vous cochez le malus en corrigeant. Ex. « Excès d'IA » − 1, « Retard » − 2.</p>
      <div id="maluses">${(grid.maluses || [])
        .map(
          (m, i) => `<div class="crit-edit">
          <input class="input" data-mlabel="${i}" value="${esc(m.label)}" placeholder="Ex. Excès d'IA">
          <span class="muted">−</span><input class="input num" data-mpts="${i}" inputmode="decimal" value="${fmtNum(m.pts)}" title="Points retirés"> <span class="muted">pt${+m.pts > 1 ? 's' : ''}</span>
          <button class="icon-btn" data-mdel="${i}" title="Supprimer">✕</button></div>`
        )
        .join('')}</div>
      <button class="btn" id="addM">+ Malus</button>
      <h2>Bonus <small>(facultatif)</small></h2>
      <p class="muted small">Points ajoutés à la note finale quand vous cochez le bonus, pour un élève ou pour chaque membre d'un groupe. Ex. « Participation active » + 1.</p>
      <div id="bonuses">${(grid.bonuses || [])
        .map(
          (m, i) => `<div class="crit-edit">
          <input class="input" data-blabel="${i}" value="${esc(m.label)}" placeholder="Ex. Participation active">
          <span class="muted">+</span><input class="input num" data-bpts="${i}" inputmode="decimal" value="${fmtNum(m.pts)}" title="Points ajoutés"> <span class="muted">pt${+m.pts > 1 ? 's' : ''}</span>
          <button class="icon-btn" data-bdel="${i}" title="Supprimer">✕</button></div>`
        )
        .join('')}</div>
      <button class="btn" id="addB">+ Bonus</button>`
          : ''
      }
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
    $$('[data-mlabel]').forEach(i => (grid.maluses[+i.dataset.mlabel].label = i.value));
    $$('[data-mpts]').forEach(i => (grid.maluses[+i.dataset.mpts].pts = Math.abs(parseNum(i.value) ?? 0)));
    $$('[data-blabel]').forEach(i => (grid.bonuses[+i.dataset.blabel].label = i.value));
    $$('[data-bpts]').forEach(i => (grid.bonuses[+i.dataset.bpts].pts = Math.abs(parseNum(i.value) ?? 0)));
    if ($('#scale')) grid.scaleTo = parseNum($('#scale').value);
    if ($('#gname')) owner.name = $('#gname').value.trim();
    if ($('#gsubject')) owner.subject = $('#gsubject').value.trim();
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
    const importGrid = async capture => {
      read();
      const files = await pickFiles({ accept: capture ? 'image/*' : 'application/pdf,image/*', capture });
      if (!files.length) return;
      const prog = busy('Lecture de la grille…');
      let res;
      try {
        res = await readGridFile(files[0], prog.set);
      } catch (e) {
        console.error(e);
        prog.done();
        return toast('Lecture impossible : ' + e.message, 'error');
      }
      prog.done();
      if (!res.criteria.length) return toast('Aucun critère reconnu. Essayez une photo plus nette et bien droite, ou saisissez la grille à la main.', 'error');
      let lines = null,
        mode = res.mode;
      const ok = await modal({
        title: 'Vérifiez la grille lue',
        wide: true,
        body: `<p class="muted small">Une ligne par critère. Pour les points, terminez la ligne par « | nombre ». Corrigez ce qui a été mal lu et supprimez les lignes inutiles.</p>
          <div class="seg"><button data-m="note" class="${mode === 'note' ? 'on' : ''}">Notation (points)</button><button data-m="acquis" class="${mode === 'acquis' ? 'on' : ''}">Acquis / non acquis</button></div>
          <textarea class="input" id="glines" rows="12">${esc(res.criteria.map(c => c.label + (c.max != null ? ' | ' + fmtNum(c.max) : '')).join('\n'))}</textarea>
          <label class="check"><input type="checkbox" id="greplace" ${grid.criteria.length ? '' : 'checked'}> Remplacer les critères actuels (sinon ils sont ajoutés à la suite)</label>`,
        actions: [{ label: 'Annuler', value: false }, { label: 'Utiliser cette grille', value: true, cls: 'primary' }],
        onOpen: w =>
          $$('[data-m]', w).forEach(
            b =>
              (b.onclick = () => {
                mode = b.dataset.m;
                $$('[data-m]', w).forEach(x => x.classList.toggle('on', x === b));
              })
          ),
        validate: (x, w) => {
          lines = { text: $('#glines', w).value, replace: $('#greplace', w).checked };
          return true;
        },
      });
      if (!ok) return;
      const crits = lines.text
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => {
          const [label, pts] = l.split('|').map(x => x.trim());
          return { id: db.uid(), label, max: parseNum(pts) ?? 2 };
        });
      grid.mode = mode;
      if (mode === 'note' && grid.scaleTo == null) grid.scaleTo = 20;
      grid.criteria = lines.replace ? crits : [...grid.criteria, ...crits];
      render();
      toast(`${crits.length} critère${crits.length > 1 ? 's' : ''} importé${crits.length > 1 ? 's' : ''} : vérifiez puis enregistrez.`, 'success');
    };
    $('#impGrid').onclick = () => importGrid(false);
    $('#camGrid').onclick = () => importGrid(true);
    $('#addC').onclick = () => {
      read();
      grid.criteria.push({ id: db.uid(), label: '', max: 4 });
      render();
      const inputs = $$('[data-label]');
      inputs[inputs.length - 1].focus();
    };
    $$('[data-del]').forEach(b => (b.onclick = () => (read(), grid.criteria.splice(+b.dataset.del, 1), render())));
    if ($('#addM'))
      $('#addM').onclick = () => {
        read();
        (grid.maluses = grid.maluses || []).push({ id: db.uid(), label: '', pts: 1 });
        render();
        const inputs = $$('[data-mlabel]');
        inputs[inputs.length - 1].focus();
      };
    $$('[data-mdel]').forEach(b => (b.onclick = () => (read(), grid.maluses.splice(+b.dataset.mdel, 1), render())));
    if ($('#addB'))
      $('#addB').onclick = () => {
        read();
        (grid.bonuses = grid.bonuses || []).push({ id: db.uid(), label: '', pts: 1 });
        render();
        const inputs = $$('[data-blabel]');
        inputs[inputs.length - 1].focus();
      };
    $$('[data-bdel]').forEach(b => (b.onclick = () => (read(), grid.bonuses.splice(+b.dataset.bdel, 1), render())));
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
      grid.maluses = (grid.maluses || []).filter(m => m.label.trim() && +m.pts);
      grid.bonuses = (grid.bonuses || []).filter(m => m.label.trim() && +m.pts);
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
          body: `${groupBySubject(grids)
            .sort(([x], [y]) => (y === owner.subject) - (x === owner.subject))
            .map(([subj, list]) => `<h3 class="subj-title">📚 ${esc(subj)}</h3><div class="list">${list.map(g => `<label class="list-item check"><input type="radio" name="g" value="${g.id}"> <b>${esc(g.name)}</b> <small>${g.grid.criteria.length} critères · ${g.grid.mode === 'note' ? 'notation' : 'acquis'}</small></label>`).join('')}</div>`)
            .join('')}
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
        await db.put('grids', { name: v.name, subject: owner.subject || '', grid: JSON.parse(JSON.stringify({ ...grid, criteria: grid.criteria.filter(c => c.label.trim()) })) });
        toast('Grille modèle enregistrée', 'success');
      };
  };
  render();
}

function groupBySubject(grids) {
  const by = {};
  for (const g of grids) (by[g.subject || 'Sans matière'] = by[g.subject || 'Sans matière'] || []).push(g);
  return Object.entries(by).sort(([x], [y]) => (x === 'Sans matière') - (y === 'Sans matière') || x.localeCompare(y, 'fr'));
}

async function gridsView() {
  const grids = (await db.all('grids')).sort(db.sortByName);
  const groups = groupBySubject(grids);
  const item = g => `<div class="list-item"><a class="li-main" href="#/grille/modele/${g.id}"><b>${esc(g.name)}</b><small>${g.grid.criteria.length} critères · ${g.grid.mode === 'note' ? 'notation' + (g.grid.scaleTo ? ' sur ' + g.grid.scaleTo : '') : 'acquis / non acquis'}</small></a>
          <button class="icon-btn" data-del="${g.id}">🗑</button></div>`;
  view.innerHTML = `<div class="page-wrap">
    <div class="page-head"><h1>Mes grilles modèles</h1><a class="btn primary" href="#/grille/modele/new">+ Grille</a></div>
    <p class="muted">Des grilles réutilisables, rangées par matière. Dans une évaluation, « Utiliser une grille modèle » en fait une copie que vous pouvez ensuite adapter.</p>
    ${groups.length > 1 ? `<div class="chips">${groups.map(([subj, list]) => `<a class="chip" href="#subj-${encodeURIComponent(subj)}" data-jump="${esc(subj)}">${esc(subj)} <small>${list.length}</small></a>`).join('')}</div>` : ''}
    ${
      groups
        .map(([subj, list]) => `<section class="subject" id="subj-${esc(encodeURIComponent(subj))}"><h2>📚 ${esc(subj)} <small>(${list.length})</small></h2><div class="list">${list.map(item).join('')}</div></section>`)
        .join('') || '<div class="empty"><div class="empty-icon">📋</div><p>Aucune grille modèle pour l’instant.</p></div>'
    }</div>`;
  $$('[data-jump]').forEach(
    c =>
      (c.onclick = e => {
        e.preventDefault();
        document.getElementById('subj-' + encodeURIComponent(c.dataset.jump)).scrollIntoView({ behavior: 'smooth' });
      })
  );
  $$('[data-del]').forEach(
    b =>
      (b.onclick = async () => {
        if (await confirmBox('Supprimer la grille', 'Supprimer cette grille modèle ? Les évaluations qui l’utilisent gardent leur propre copie.', 'Supprimer', true)) {
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
      <h2>Relais d’envoi programmé <span class="muted small">(facultatif)</span></h2>
      <p>Pour que les envois programmés partent <b>même si la tablette est éteinte</b>, installez une fois ce petit relais gratuit dans votre Gmail dédié. Sans relais, la programmation marche aussi, mais IziNote doit être ouvert à l’heure prévue (sinon l’envoi se fait à la prochaine ouverture).</p>
      <ol class="steps">
        <li>Sur un ordinateur, connecté avec le Gmail dédié, ouvrez <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com</a> (nouveau projet). Nommez-le « IziNote relais ».</li>
        <li>Effacez le code présent et collez celui-ci : <button class="btn small" id="copyRelay">📋 Copier le code du relais</button></li>
        <li>Enregistrez (💾), choisissez la fonction <b>installer</b> en haut, puis <b>▶ Exécuter</b>. Google demande des autorisations : « Examiner les autorisations », votre compte, « Paramètres avancés », « Accéder à IziNote relais », puis « Autoriser ».</li>
        <li>Bouton <b>Déployer › Nouveau déploiement</b>, type ⚙ <b>Application Web</b>. « Exécuter en tant que » : <b>Moi</b> ; « Qui a accès » : <b>Tout le monde</b>. Déployez et copiez l’<b>URL de l’application Web</b> (elle finit par <code>/exec</code>).</li>
        <li>Collez l’URL ci-dessous, enregistrez, puis testez.</li>
      </ol>
      <label class="field"><span>URL du relais</span><input class="input" id="relayUrl" value="${esc(s.relayUrl || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocapitalize="off" spellcheck="false"></label>
      <div class="row wrap"><button class="btn" id="relayTest">Tester le relais</button></div>
      <p class="muted small">Le relais garde les mails programmés dans votre Google Drive (dossier « IziNote – envois programmés ») et vérifie toutes les 5 minutes s’il y a des mails à envoyer. Un compte Gmail gratuit peut envoyer environ 100 mails par jour avec ce relais.</p>
      <p class="muted small">Relais installé avant les rappels de devoirs ? Recopiez le code ci-dessus dans script.google.com, enregistrez, puis « Déployer › Gérer les déploiements › ✎ Modifier › Version : Nouvelle version › Déployer » (l’URL ne change pas).</p>
    </section>

    <section class="card-sec" id="syncSec">
      <h2>Synchronisation entre appareils</h2>
      <p>Retrouvez les mêmes données (classes, copies, corrections, grilles, réglages) sur la tablette et l’ordinateur. Elles sont rangées dans le Google Drive de votre Gmail dédié, dans un dossier caché réservé à IziNote.</p>
      <ol class="steps">
        <li>Une seule fois : dans votre projet Google Cloud (celui de la connexion Gmail), activez l’<a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener">API Google Drive</a> (bouton « Activer »).</li>
        <li>Sur chaque appareil : ouvrez IziNote à la même adresse, collez l’ID client Google ci-dessous, puis cochez la case.</li>
      </ol>
      <label class="check"><input type="checkbox" id="syncOn" ${sync.isEnabled() ? 'checked' : ''}> Synchroniser cet appareil</label>
      <div class="row wrap"><button class="btn" id="syncNow" ${sync.isEnabled() ? '' : 'disabled'}>☁ Synchroniser maintenant</button><span class="muted small" id="syncInfo"></span></div>
      <p class="muted small">Ensuite, tout se fait seul pendant que l’appli est ouverte. Google demande de reconfirmer la connexion toutes les heures : touchez alors le nuage ☁ en haut de l’écran. Si vous avez travaillé sur deux appareils sans connexion, les modifications sont rassemblées (pour une même copie, la plus récente l’emporte).</p>
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
      <p>Vos données (copies, corrections, classes) sont stockées sur cet appareil${sync.isEnabled() ? ' et copiées dans votre Google Drive par la synchronisation' : ''}. Une sauvegarde de temps en temps reste une bonne précaution.</p>
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
    relayUrl: $('#relayUrl').value.trim(),
    relaySecret: s.relaySecret,
  });
  if (!s.relaySecret) {
    s.relaySecret = Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(16).padStart(2, '0')).join('');
    await db.saveSettings({ ...s });
  }
  $('#copyRelay').onclick = async () => {
    const code = relayScript(s.relaySecret);
    try {
      await navigator.clipboard.writeText(code);
      toast('Code du relais copié ✓ Collez-le dans script.google.com', 'success');
    } catch {
      await modal({ title: 'Code du relais', wide: true, body: `<p class="muted small">Sélectionnez tout le texte et copiez-le.</p><textarea class="input mono" rows="16" readonly>${esc(code)}</textarea>` });
    }
  };
  $('#relayTest').onclick = async () => {
    const st = collect();
    await db.saveSettings(st);
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(st.relayUrl)) return toast('Collez l’URL de l’application Web (elle commence par https://script.google.com et finit par /exec).', 'error');
    const b = busy('Test du relais…');
    try {
      const r = await sched.relayTest(st);
      toast(`Relais opérationnel ✓ (encore ${r.quota} mails possibles aujourd’hui)`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      b.done();
    }
  };
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
  const syncInfo = () => {
    const t = sync.lastSync();
    $('#syncInfo').textContent = t ? 'Dernière synchronisation : ' + new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  };
  syncInfo();
  const runSync = async on => {
    try {
      const n = on === undefined ? await sync.syncNow({ interactive: true }) : await sync.enable(on);
      if (sync.isEnabled()) toast(n ? `Synchronisé ✓ (${n} élément${n > 1 ? 's' : ''} reçu${n > 1 ? 's' : ''})` : 'Synchronisé ✓', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
    syncInfo();
  };
  $('#syncOn').onchange = async e => {
    const on = e.target.checked;
    if (on) {
      const st = collect();
      if (!st.googleClientId) {
        e.target.checked = false;
        return toast('Collez d’abord l’ID client Google (section « Connexion Gmail »).', 'error');
      }
      await db.saveSettings(st);
    }
    $('#syncNow').disabled = !on;
    await runSync(on);
  };
  $('#syncNow').onclick = () => runSync();
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
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Nouvelle version installée : on recharge une fois pour l'utiliser tout de suite.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
}
router();

// ---------------- Synchronisation ----------------
const syncBtn = $('#syncBtn');
const SYNC_TITLES = {
  ok: 'Synchronisé',
  pending: 'Modifications en attente d’envoi',
  busy: 'Synchronisation en cours…',
  auth: 'Touchez pour synchroniser avec vos autres appareils',
  error: 'Erreur de synchronisation',
};
sync.onStatus(({ state, msg }) => {
  syncBtn.hidden = state === 'off';
  syncBtn.dataset.state = state;
  syncBtn.title = msg || SYNC_TITLES[state] || '';
});
syncBtn.onclick = async () => {
  try {
    const n = await sync.syncNow({ interactive: true });
    toast(n ? `Synchronisé ✓ (${n} élément${n > 1 ? 's' : ''} reçu${n > 1 ? 's' : ''})` : 'Synchronisé ✓', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
};
// des données sont arrivées d'un autre appareil : on rafraîchit l'écran (sauf pendant une correction)
sync.onRemoteChanges(() => {
  if (/^#\/corriger\//.test(location.hash)) return;
  if (document.querySelector('.modal-wrap')) return;
  if (/^#\/(grille|reglages)/.test(location.hash) && document.activeElement && document.activeElement.matches('input, textarea')) return;
  router();
});
if (sync.isEnabled()) gmail.loadGis().catch(() => {});
sched.onScheduleChange(() => /^#\/(devoir|classe)\//.test(location.hash) && router());
sched.startScheduler();
