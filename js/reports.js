// Exports : tableau Excel des notes d'une classe, récapitulatif PDF d'un étudiant.
import * as db from './db.js';
import { fullComment, computeResult, noteOn20, resultCell, studentName, dateOf, shortDate, kindLabel, loadScript, fmtNum, download, safeFileName } from './util.js';

const { PDFDocument, StandardFonts, rgb, PageSizes } = window.PDFLib;

export function semesterOf(cls, a) {
  return a.semesterId || (cls.semesters && cls.semesters[0] && cls.semesters[0].id);
}

// Tous les éléments nécessaires pour une classe (filtrés par semestre si demandé).
export async function classData(classId, semesterId = 'all') {
  const cls = await db.get('classes', classId);
  const school = await db.get('schools', cls.schoolId);
  const students = (await db.by('students', 'classId', classId)).sort(db.sortStudents);
  let assignments = await db.by('assignments', 'classId', classId);
  if (semesterId !== 'all') assignments = assignments.filter(a => semesterOf(cls, a) === semesterId);
  assignments.sort((a, b) => dateOf(a) - dateOf(b));
  const copies = {};
  for (const a of assignments) for (const c of await db.by('copies', 'assignmentId', a.id)) copies[a.id + '|' + c.studentId] = c;
  const copyOf = (a, s) => copies[a.id + '|' + s.id];
  return { cls, school, students, assignments, copyOf };
}

export function average(assignments, copyOf, s) {
  const vals = assignments
    .map(a => {
      const c = copyOf(a, s);
      return c && c.status === 'done' ? noteOn20(a.grid, c.evaluation) : null;
    })
    .filter(v => v != null);
  if (!vals.length) return null;
  return vals.reduce((t, v) => t + v, 0) / vals.length;
}

// ---------- Excel ----------
export async function exportClassXlsx(classId, semesterId, semesterName) {
  await loadScript('lib/xlsx.full.min.js');
  const XLSX = window.XLSX;
  const { cls, students, assignments, copyOf } = await classData(classId, semesterId);
  const head = ['Nom', 'Prénom'];
  for (const a of assignments) head.push(`${a.title} (${shortDate(dateOf(a))})${a.grid && a.grid.mode === 'note' && a.grid.scaleTo ? ' /' + a.grid.scaleTo : ''}`);
  head.push('Moyenne /20');
  const rows = [head];
  for (const s of students) {
    const row = [s.lastName || '', s.firstName || ''];
    for (const a of assignments) {
      const c = copyOf(a, s);
      row.push(c && c.status === 'done' ? resultCell(a.grid, c.evaluation) : c && c.pdf ? 'à corriger' : '');
    }
    const avg = average(assignments, copyOf, s);
    row.push(avg == null ? '' : Math.round(avg * 100) / 100);
    rows.push(row);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = head.map((h, i) => ({ wch: i < 2 ? 18 : Math.min(40, Math.max(12, h.length + 2)) }));
  ws['!freeze'] = { xSplit: 2, ySplit: 1 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Notes');

  // Feuille « Compétences » pour les grilles acquis / non acquis
  const acq = assignments.filter(a => a.grid && a.grid.mode === 'acquis' && a.grid.criteria.length);
  if (acq.length) {
    const h2 = ['Nom', 'Prénom'];
    for (const a of acq) for (const c of a.grid.criteria) h2.push(`${a.title} – ${c.label}`);
    const r2 = [h2];
    for (const s of students) {
      const row = [s.lastName || '', s.firstName || ''];
      for (const a of acq) {
        const cp = copyOf(a, s);
        for (const c of a.grid.criteria) {
          const v = cp && cp.evaluation ? cp.evaluation[c.id] : null;
          row.push(v == null ? '' : a.grid.levels[v]);
        }
      }
      r2.push(row);
    }
    const ws2 = XLSX.utils.aoa_to_sheet(r2);
    ws2['!cols'] = h2.map((h, i) => ({ wch: i < 2 ? 18 : 24 }));
    XLSX.utils.book_append_sheet(wb, ws2, 'Compétences');
  }
  XLSX.writeFile(wb, `Notes ${cls.name}${semesterName ? ' - ' + semesterName : ''}.xlsx`.replace(/[\\/:*?"<>|]+/g, '-'));
}

// ---------- Récap PDF d'un étudiant (pour le livret scolaire) ----------
export async function studentRecapPdf(student, semesterId, semesterName) {
  const { cls, school, assignments, copyOf } = await classData(student.classId, semesterId);
  const settings = await db.getSettings();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const safe = s => String(s ?? '').replace(/[^\n\x20-\x7E -ÿŒœ’–—€•]/g, '').replace(/[’]/g, "'").replace(/[–—]/g, '-');
  const [W, H] = PageSizes.A4;
  const M = 46;
  const ink = rgb(0.08, 0.08, 0.08),
    grey = rgb(0.42, 0.37, 0.32),
    accent = rgb(0.76, 0.34, 0.06),
    orange = rgb(1, 0.47, 0.16),
    beige = rgb(0.96, 0.93, 0.88);
  let page, y;
  const newPage = () => {
    page = doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: orange });
    y = H - M;
  };
  const ensure = h => {
    if (y - h < M) newPage();
  };
  const wrap = (t, f, size, maxW) => {
    const out = [];
    for (const para of safe(t).split('\n')) {
      let line = '';
      for (const w of para.split(' ')) {
        const test = line ? line + ' ' + w : w;
        if (f.widthOfTextAtSize(test, size) > maxW && line) {
          out.push(line);
          line = w;
        } else line = test;
      }
      out.push(line);
    }
    return out;
  };
  const text = (t, { f = font, size = 11, color = ink, x = M, maxW = W - 2 * M } = {}) => {
    for (const ln of wrap(t, f, size, maxW)) {
      ensure(size * 1.4);
      page.drawText(ln, { x, y: y - size, size, font: f, color });
      y -= size * 1.4;
    }
  };
  newPage();
  // logos
  try {
    const logo = await doc.embedPng(await (await fetch('assets/logo-simplifie.png')).arrayBuffer());
    page.drawImage(logo, { x: W - M - 100, y: H - M - 26, width: 100, height: (100 * logo.height) / logo.width });
  } catch {}
  let titleX = M;
  if (school && school.logo) {
    try {
      const img = await doc.embedPng(school.logo);
      const h = 46,
        w = (h * img.width) / img.height;
      page.drawImage(img, { x: M, y: y - h, width: w, height: h });
      titleX = M + w + 12;
    } catch {}
  }
  const y0 = y;
  text('Récapitulatif des évaluations', { f: bold, size: 18, color: accent, x: titleX, maxW: W - titleX - M - 110 });
  text(studentName(student), { f: bold, size: 14, x: titleX });
  text([school && school.name, cls.name, semesterName].filter(Boolean).join(' · '), { size: 10.5, color: grey, x: titleX });
  y = Math.min(y, y0 - 52) - 14;

  // tableau
  const cols = [
    { k: 'title', label: 'Évaluation', w: 210 },
    { k: 'kind', label: 'Type', w: 85 },
    { k: 'date', label: 'Date', w: 72 },
    { k: 'res', label: 'Résultat', w: W - 2 * M - 367 },
  ];
  const drawHead = () => {
    ensure(24);
    page.drawRectangle({ x: M, y: y - 20, width: W - 2 * M, height: 20, color: beige });
    let x = M;
    for (const c of cols) {
      page.drawText(c.label, { x: x + 6, y: y - 14, size: 9.5, font: bold, color: ink });
      x += c.w;
    }
    y -= 20;
  };
  drawHead();
  const comments = [];
  const comps = [];
  for (const a of assignments) {
    const c = copyOf(a, student);
    const done = c && c.status === 'done';
    const r = done ? computeResult(a.grid, c.evaluation) : null;
    const vals = {
      title: a.title + (a.subject ? ` (${a.subject})` : ''),
      kind: kindLabel(a.kind),
      date: shortDate(dateOf(a)),
      res: done ? r.short || 'Évalué' : c && c.pdf ? 'À corriger' : 'Non rendu',
    };
    const cells = cols.map(col => wrap(vals[col.k], col.k === 'res' ? bold : font, 9.5, col.w - 12));
    const h = Math.max(...cells.map(l => l.length)) * 12.5 + 8;
    if (y - h < M) {
      newPage();
      drawHead();
    }
    let x = M;
    cols.forEach((col, i) => {
      cells[i].forEach((ln, k) => page.drawText(ln, { x: x + 6, y: y - 13 - k * 12.5, size: 9.5, font: col.k === 'res' ? bold : font, color: ink }));
      x += col.w;
    });
    y -= h;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.89, 0.84, 0.76) });
    if (done && fullComment(c)) comments.push({ a, text: fullComment(c) });
    if (done && a.grid && a.grid.mode === 'acquis') comps.push({ a, r });
  }
  if (!assignments.length) text('Aucune évaluation sur cette période.', { color: grey });
  y -= 12;
  const avg = average(assignments, copyOf, student);
  if (avg != null) text(`Moyenne des notes : ${fmtNum(avg)} / 20`, { f: bold, size: 13, color: accent });

  if (comps.length) {
    y -= 10;
    text('Compétences', { f: bold, size: 13 });
    for (const { a, r } of comps) {
      text(a.title, { f: bold, size: 10.5, color: grey });
      for (const l of r.lines) text(`• ${l.label} : ${l.value}`, { size: 10, x: M + 10, maxW: W - 2 * M - 10 });
      y -= 4;
    }
  }
  if (comments.length) {
    y -= 10;
    text('Commentaires', { f: bold, size: 13 });
    for (const { a, text: t } of comments) {
      text(a.title, { f: bold, size: 10.5, color: grey });
      text(t, { size: 10, x: M + 10, maxW: W - 2 * M - 10 });
      y -= 4;
    }
  }
  y -= 10;
  text(`Édité le ${new Date().toLocaleDateString('fr-FR')}${settings.teacherName ? ' par ' + settings.teacherName : ''} avec IziNote`, { size: 8.5, color: grey });
  const bytes = await doc.save();
  download(new Blob([bytes], { type: 'application/pdf' }), `Recap ${studentName(student)}${semesterName ? ' - ' + semesterName : ''}.pdf`.replace(/[\\/:*?"<>|]+/g, '-'));
}
