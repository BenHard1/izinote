// Bibliothèque des devoirs : ce qu'il faut garder d'une année sur l'autre, sans aucune donnée d'élève.
// Une fiche par évaluation : titre, type, matière, consignes, documents de travail, grille, et pour
// mémoire la classe, l'école et l'année. Ni notes, ni copies, ni groupes, ni envois.
// Elle est remplie quand on clôture une évaluation et quand on supprime une classe (fin d'année, RGPD).
// Les fiches peuvent être rangées dans des dossiers (store « folders » : { id, name }).
import * as db from './db.js';

const libId = a => 'lib_' + a.id;

// Fiche de bibliothèque d'une évaluation (remplace la précédente pour la même évaluation)
export async function saveToLibrary(a, cls, school) {
  const prev = await db.get('library', libId(a));
  const brief = a.brief ? JSON.parse(JSON.stringify(a.brief)) : null;
  if (brief) delete brief.groupText; // lié aux groupes d'élèves
  const entry = {
    id: libId(a),
    sourceId: a.id,
    title: a.title,
    kind: a.kind || 'devoir',
    subject: a.subject || '',
    className: (cls && cls.name) || prev?.className || '',
    schoolName: (school && school.name) || prev?.schoolName || '',
    year: (cls && cls.year) || prev?.year || '',
    date: a.dueDate || prev?.date || '',
    grid: JSON.parse(JSON.stringify(a.grid || null)),
    brief,
    // les mêmes fichiers, sous de nouveaux identifiants (ils restent si l'évaluation est supprimée)
    docs: (a.docs || []).map(d => {
      const old = (prev?.docs || []).find(x => x.from === d.id);
      return { ...d, id: old ? old.id : db.uid(), from: d.id };
    }),
    folderId: prev?.folderId || null,
    savedAt: Date.now(),
  };
  return db.put('library', entry);
}

// Toutes les évaluations d'une classe, avant sa suppression
export async function saveClassToLibrary(cls) {
  const school = await db.get('schools', cls.schoolId);
  let n = 0;
  for (const a of await db.by('assignments', 'classId', cls.id)) {
    await saveToLibrary(a, cls, school);
    n++;
  }
  return n;
}

// Nouvelle évaluation dans une classe, à partir d'une fiche de bibliothèque
export async function useInClass(entry, cls, semesterId, dueDate) {
  return db.put('assignments', {
    classId: cls.id,
    semesterId,
    title: entry.title,
    kind: entry.kind,
    subject: entry.subject || '',
    dueDate: dueDate || '',
    grid: JSON.parse(JSON.stringify(entry.grid || { mode: 'note', scaleTo: 20, levels: [], criteria: [] })),
    brief: entry.brief ? JSON.parse(JSON.stringify(entry.brief)) : undefined,
    docs: (entry.docs || []).map(({ from, ...d }) => ({ ...d, id: db.uid() })),
    groups: [],
    createdAt: Date.now(),
  });
}
