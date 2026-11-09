// Fabrique le PDF corrigé : la copie d'origine + les annotations au stylet + une page « Fiche d'évaluation ».
import { computeResult, studentName, fmtDate, fullComment } from './util.js';
import { drawStampPdf } from './stamps.js';

const { PDFDocument, StandardFonts, rgb, LineCapStyle, PageSizes } = window.PDFLib;

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// Les polices standard du PDF ne gèrent pas tous les caractères (emojis…) : on remplace ceux qui manquent.
function makeSafe(font) {
  const cache = new Map();
  const ok = ch => {
    if (!cache.has(ch)) {
      try {
        font.encodeText(ch);
        cache.set(ch, true);
      } catch {
        cache.set(ch, false);
      }
    }
    return cache.get(ch);
  };
  const subs = { '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', ' ': ' ', ' ': ' ', '\t': '  ' };
  return s =>
    [...String(s || '')]
      .map(ch => (ok(ch) ? ch : subs[ch] && ok(subs[ch]) ? subs[ch] : ch.normalize('NFD')[0] && ok(ch.normalize('NFD')[0]) ? ch.normalize('NFD')[0] : '?'))
      .join('');
}

function wrapText(text, font, size, maxWidth) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    const words = para.split(/ +/);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) line = test;
      else {
        if (line) out.push(line);
        // mot trop long : on le coupe
        let rest = w;
        while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
          let i = rest.length;
          while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > maxWidth) i--;
          out.push(rest.slice(0, i));
          rest = rest.slice(i);
        }
        line = rest;
      }
    }
    out.push(line);
  }
  return out;
}

export async function buildCorrectedPdf({ copy, student, assignment, cls, settings }) {
  let doc;
  const hasPdf = copy.pdf instanceof Blob;
  if (hasPdf) {
    const bytes = new Uint8Array(await copy.pdf.arrayBuffer());
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const safe = makeSafe(font);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    const safeBold = makeSafe(boldFont);
    // pdf.js sert à convertir nos coordonnées (relatives à la page affichée) en coordonnées PDF,
    // ce qui gère les pages tournées et les marges de cadrage.
    const pj = await window.pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const annots = copy.annotations || {};
    // tampons image utilisés dans cette copie
    const images = {};
    for (const items of Object.values(annots))
      for (const it of items || [])
        if (it.t === 'stamp' && it.k === 'img' && !(it.img in images)) {
          const def = ((settings && settings.imageStamps) || []).find(x => x.id === it.img);
          images[it.img] = null;
          if (def) {
            try {
              images[it.img] = await doc.embedPng(def.src);
            } catch (e) {
              console.warn('Tampon image illisible', e);
            }
          }
        }
    for (const key of Object.keys(annots)) {
      const i = +key;
      const items = annots[key];
      if (!items || !items.length || i >= doc.getPageCount()) continue;
      const page = doc.getPage(i);
      const vp = (await pj.getPage(i + 1)).getViewport({ scale: 1 });
      const toPdf = (x, y) => vp.convertToPdfPoint(x * vp.width, y * vp.height);
      for (const it of items) {
        if (it.t === 'ink' && it.p.length) {
          const pts = it.p.map(([x, y]) => toPdf(x, y));
          if (pts.length === 1) pts.push([pts[0][0] + 0.01, pts[0][1]]);
          const path = pts.map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(2)},${(-p[1]).toFixed(2)}`).join(' ');
          page.drawSvgPath(path, {
            x: 0,
            y: 0,
            borderColor: hexToRgb(it.c),
            borderWidth: it.w * vp.width,
            borderOpacity: it.o ?? 1,
            borderLineCap: LineCapStyle.Round,
          });
        } else if (it.t === 'stamp') {
          drawStampPdf(page, it, { toPdf, vpW: vp.width, vpH: vp.height, rgbColor: hexToRgb(it.c), bold: boldFont, safe: safeBold, images });
        } else if (it.t === 'text' && it.text) {
          const size = it.s * vp.width;
          const lines = String(it.text).split('\n');
          lines.forEach((ln, k) => {
            const [px, py] = toPdf(it.x, it.y + ((k + 0.8) * size * 1.2) / vp.height);
            page.drawText(safe(ln), { x: px, y: py, size, font, color: hexToRgb(it.c) });
          });
        }
      }
    }
    pj.destroy();
  } else {
    doc = await PDFDocument.create();
  }

  await addEvaluationPage(doc, { copy, student, assignment, cls, settings });
  return doc.save();
}

async function addEvaluationPage(doc, { copy, student, assignment, cls, settings }) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const safe = makeSafe(font);
  const [W, H] = PageSizes.A4;
  const M = 50;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const ink = rgb(0.08, 0.08, 0.08);
  const grey = rgb(0.42, 0.37, 0.32);
  const accent = rgb(0.76, 0.34, 0.06);
  const orange = rgb(1, 0.47, 0.16);
  // bandeau IziNote : filet orange + logo simplifié en haut à droite
  page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: orange });
  try {
    const logoBytes = await (await fetch('assets/logo-simplifie.png')).arrayBuffer();
    const logo = await doc.embedPng(logoBytes);
    const lw = 110;
    page.drawImage(logo, { x: W - M - lw, y: H - M - (lw * logo.height) / logo.width + 14, width: lw, height: (lw * logo.height) / logo.width });
  } catch {}
  // logo de l'école en haut à gauche, s'il a été ajouté
  let indent = 0;
  try {
    const school = cls ? await (await import('./db.js')).get('schools', cls.schoolId) : null;
    if (school && school.logo) {
      const img = await doc.embedPng(school.logo);
      const h = 44,
        w = (h * img.width) / img.height;
      page.drawImage(img, { x: M, y: H - M - h + 4, width: w, height: h });
      indent = w + 12;
    }
  } catch {}

  const ensure = h => {
    if (y - h < M) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };
  const text = (s, { f = font, size = 11, color = ink, x = M, maxW = W - 2 * M, lh = 1.35 } = {}) => {
    for (const ln of wrapText(safe(s), f, size, maxW)) {
      ensure(size * lh);
      page.drawText(ln, { x, y: y - size, size, font: f, color });
      y -= size * lh;
    }
  };

  text("Fiche d'évaluation", { f: bold, size: 20, color: accent, x: M + indent, maxW: W - 2 * M - indent - 120 });
  y -= 6;
  text(assignment.title || 'Devoir', { f: bold, size: 14, x: M + indent, maxW: W - 2 * M - indent - 120 });
  text(`${studentName(student)}${cls ? ' · ' + cls.name : ''}`, { size: 12, color: grey, x: M + indent });
  text(`Évalué le ${fmtDate(copy.correctedAt || Date.now())}${settings.teacherName ? ' par ' + settings.teacherName : ''}`, { size: 10, color: grey, x: M + indent });
  y -= 14;

  const grid = assignment.grid;
  const r = computeResult(grid, copy.evaluation || {});
  if (r.mark) {
    // absent / non rendu : une seule ligne
    text(r.totalLine, { f: bold, size: 14, color: accent });
    y -= 10;
  } else if (r.lines && r.lines.length) {
    const colW = W - 2 * M;
    const valW = 170;
    ensure(24);
    page.drawRectangle({ x: M, y: y - 22, width: colW, height: 22, color: rgb(0.96, 0.93, 0.88) });
    page.drawText(grid.mode === 'note' ? 'Critère' : 'Compétence', { x: M + 8, y: y - 15, size: 10, font: bold, color: ink });
    page.drawText(grid.mode === 'note' ? 'Points' : 'Niveau', { x: M + colW - valW + 8, y: y - 15, size: 10, font: bold, color: ink });
    y -= 22;
    for (const l of r.lines) {
      const lab = wrapText(safe(l.label), font, 10.5, colW - valW - 16);
      const val = wrapText(safe(l.value), font, 10.5, valW - 16);
      const h = Math.max(lab.length, val.length) * 14 + 10;
      ensure(h);
      lab.forEach((t, k) => page.drawText(t, { x: M + 8, y: y - 16 - k * 14, size: 10.5, font, color: ink }));
      val.forEach((t, k) => page.drawText(t, { x: M + colW - valW + 8, y: y - 16 - k * 14, size: 10.5, font: bold, color: ink }));
      y -= h;
      page.drawLine({ start: { x: M, y }, end: { x: M + colW, y }, thickness: 0.5, color: rgb(0.89, 0.84, 0.76) });
    }
    y -= 12;
    text(r.totalLine, { f: bold, size: 14, color: accent });
    y -= 10;
  }

  if (fullComment(copy)) {
    y -= 6;
    text('Commentaire', { f: bold, size: 13 });
    y -= 2;
    text(fullComment(copy), { size: 11.5, lh: 1.45 });
  }
}

export function correctedFileName(student, assignment) {
  const base = `${assignment.title || 'devoir'} - ${studentName(student)} - corrigé`;
  return base.replace(/[\\/:*?"<>|]+/g, '-') + '.pdf';
}
