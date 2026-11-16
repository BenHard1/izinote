// Lecture d'une grille d'évaluation depuis un PDF ou une photo.
// PDF avec texte : lecture directe. Photo ou PDF scanné : reconnaissance de texte (Tesseract, gratuit, dans la tablette).
import { loadScript } from './util.js';

// Tesseract est inclus dans l'appli (lib/tesseract) : la lecture marche sans internet.
const TESSERACT = 'lib/tesseract/tesseract.min.js';

// Les lignes lues portent une propriété « strong » : l'ensemble des numéros de ligne écrites en gras
// (ou plus grosses que le reste). Une ligne en gras sans points est prise pour un titre de partie.

async function pdfLines(file) {
  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines = [];
  const strong = new Set();
  for (let p = 1; p <= Math.min(pdf.numPages, 5); p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    // polices en gras : leur nom contient « Bold », « Black », « Heavy »… (il faut charger les polices pour le savoir)
    const boldFont = {};
    try {
      await page.getOperatorList();
      for (const fn of new Set(tc.items.map(it => it.fontName).filter(Boolean))) {
        let name = '';
        try {
          const f = page.commonObjs.get(fn);
          name = (f && (f.name || f.loadedName || '')) + ' ' + ((tc.styles[fn] || {}).fontFamily || '');
        } catch {}
        boldFont[fn] = /bold|black|heavy|semibold|demi|gras/i.test(name);
      }
    } catch {}
    // regroupe les morceaux de texte par ligne (même hauteur)
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5],
        x = it.transform[4];
      let row = rows.find(r => Math.abs(r.y - y) < 4);
      if (!row) rows.push((row = { y, parts: [], size: 0 }));
      row.parts.push({ x, s: it.str, bold: !!boldFont[it.fontName], n: it.str.trim().length });
      row.size = Math.max(row.size, Math.abs(it.transform[3]) || it.height || 0);
    }
    rows.sort((a, b) => b.y - a.y);
    const sizes = rows.map(r => r.size).filter(Boolean).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] || 0;
    for (const r of rows) {
      const n = r.parts.reduce((t, x) => t + x.n, 0);
      const nb = r.parts.filter(x => x.bold).reduce((t, x) => t + x.n, 0);
      if ((n && nb / n > 0.6) || (median && r.size > median * 1.2)) strong.add(lines.length);
      lines.push(r.parts.sort((a, b) => a.x - b.x).map(p => p.s).join(' ').replace(/\s+/g, ' ').trim());
    }
  }
  lines.strong = strong;
  const textOk = lines.join('').replace(/\s/g, '').length > 20;
  return { lines, pdf, textOk };
}

// Photo → canvas (taille raisonnable), pour la lecture et la mesure de l'épaisseur du trait
async function toCanvas(src) {
  if (src instanceof HTMLCanvasElement) return src;
  const bmp = await createImageBitmap(src);
  const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

// Seuil noir / blanc (méthode d'Otsu) sur l'image en niveaux de gris
function otsu(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i += 4) hist[gray[i]]++;
  const total = gray.length / 4;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0,
    wB = 0,
    best = 0,
    th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB,
      mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) (best = v), (th = t);
  }
  return th;
}

// Épaisseur moyenne du trait d'une ligne (longueur moyenne des segments noirs horizontaux) :
// le gras et les titres plus gros ont un trait nettement plus épais que le reste.
function strokeWidth(px, W, th, boxes) {
  let dark = 0,
    runs = 0;
  for (const b of boxes) {
    for (let y = Math.max(0, b.y0); y < b.y1; y++) {
      let inRun = false;
      for (let x = Math.max(0, b.x0); x < Math.min(W, b.x1); x++) {
        const d = px[(y * W + x) * 4] < th;
        if (d) {
          dark++;
          if (!inRun) runs++;
        }
        inRun = d;
      }
    }
  }
  return runs ? dark / runs : 0;
}

async function ocr(src, onProgress) {
  await loadScript(TESSERACT);
  const base = new URL('lib/tesseract/', location.href).href;
  const canvas = await toCanvas(src);
  const worker = await window.Tesseract.createWorker('fra', 1, {
    workerPath: base + 'worker.min.js',
    corePath: base,
    langPath: base + 'lang',
    workerBlobURL: false,
    logger: m => m.status === 'recognizing text' && onProgress && onProgress(Math.round(m.progress * 100)),
  });
  try {
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const tl = (data.blocks || []).flatMap(b => (b.paragraphs || []).flatMap(p => p.lines || []));
    if (!tl.length) return Object.assign(data.text.split('\n').map(l => l.trim()), { strong: new Set() });
    const lines = tl.map(l => (l.text || '').replace(/\s+/g, ' ').trim());
    const strong = new Set();
    try {
      // niveaux de gris
      const g = canvas.getContext('2d', { willReadFrequently: true });
      const img = g.getImageData(0, 0, canvas.width, canvas.height);
      const px = img.data;
      for (let i = 0; i < px.length; i += 4) px[i] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
      const th = otsu(px);
      const sw = tl.map(l => {
        const boxes = (l.words || []).filter(w => /[a-zA-ZÀ-ÿ]/.test(w.text || '')).map(w => w.bbox);
        return boxes.length ? strokeWidth(px, canvas.width, th, boxes) : 0;
      });
      const ref = sw.filter((v, i) => v && lines[i].replace(/[^a-zA-ZÀ-ÿ]/g, '').length >= 3).sort((a, b) => a - b);
      const median = ref[Math.floor(ref.length / 2)] || 0;
      if (median && ref.length >= 3) sw.forEach((v, i) => v > median * 1.3 && strong.add(i));
    } catch (e) {
      console.warn('Mesure du gras impossible', e);
    }
    return Object.assign(lines, { strong });
  } finally {
    await worker.terminate();
  }
}

// Lignes de texte d'un PDF ou d'une photo (reconnaissance de texte si besoin).
export async function readLines(file, onProgress = () => {}) {
  let lines;
  if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
    onProgress('Lecture du PDF…');
    const r = await pdfLines(file);
    if (r.textOk) lines = r.lines;
    else {
      onProgress('PDF scanné : reconnaissance du texte…');
      const page = await r.pdf.getPage(1);
      const vp = page.getViewport({ scale: 2.5 });
      const c = document.createElement('canvas');
      c.width = vp.width;
      c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      lines = await ocr(c, p => onProgress(`Reconnaissance du texte… ${p} %`));
    }
  } else {
    onProgress('Reconnaissance du texte de la photo…');
    lines = await ocr(file, p => onProgress(`Reconnaissance du texte… ${p} %`));
  }
  return lines;
}

export async function readGridFile(file, onProgress = () => {}) {
  return parseGrid(await readLines(file, onProgress));
}

// Transforme des lignes de texte en critères. Repère les points : « /4 », « 4 pts », « (2 points) », « 3 » en fin de ligne.
// Expressions qui repèrent des points en fin de ligne
const PTS = [/[/]\s*(\d+(?:[.,]\d+)?)\s*(?:pts?|points?)?\s*\)?\s*$/i, /\(?\s*(\d+(?:[.,]\d+)?)\s*(?:pts?|points?)\s*\)?\s*$/i, /[:\-–]\s*(\d+(?:[.,]\d+)?)\s*$/, /\s(\d{1,2}(?:[.,]\d+)?)\s*$/];
// la ligne suivante (non vide) a-t-elle des points ?
function nextHasPts(lines, i) {
  for (let k = i + 1; k < lines.length; k++) {
    const t = String(lines[k] || '').trim();
    if (t.length < 3) continue;
    return PTS.some(r => r.test(t));
  }
  return false;
}

// Titres de partie : « Partie 1 : … », une ligne en gras sans points, ou une ligne sans points en majuscules,
// numérotée (« I. », « A) ») ou finie par « : » juste avant des critères notés.
export function parseGrid(lines, strong = (lines && lines.strong) || new Set()) {
  const crits = [];
  const skip = /^(grille|crit[eè]re|comp[ée]tence|bar[eè]me|nom|pr[ée]nom|classe|date|total|note\s*(finale|globale)?|points?|niveau|appr[ée]ciation|commentaire)s?\s*[:\-]?\s*$/i;
  // grille presque entièrement notée : une ligne sans points juste avant des critères est un titre de partie
  const textLines = [...lines].map(x => String(x || '').trim()).filter(x => x.length >= 3 && /[a-zA-ZÀ-ÿ]{3}/.test(x));
  const mostPts = textLines.length >= 4 && textLines.filter(x => PTS.some(r => r.test(x))).length >= textLines.length * 0.6;
  for (const [idx, raw] of [...lines].entries()) {
    let l = String(raw || '')
      .replace(/[|_]{2,}/g, ' ')
      .replace(/[□☐❑▢○●•▪◦·]/g, ' ')
      .replace(/^\s*[-–—*>]+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (l.length < 3 || skip.test(l) || /^grille\s+d/i.test(l) || /^(crit[eè]res?|comp[ée]tences?|items?)(\s+(points?|bar[eè]me|niveaux?|notes?|acquis|en cours|non acquis))*\s*$/i.test(l)) continue;
    if (/^total\b/i.test(l)) continue;
    // titre de partie : « Partie 1 : Présentation de l'entreprise », « II - Animation »… (sans points)
    const pm = l.match(/^(partie|section)\s*([0-9]{1,2}|[IVX]{1,4}|[A-H])\b\s*[:.\-–]?\s*(.*)$/i);
    if (pm && !/(\d+(?:[.,]\d+)?)\s*(pts?|points?)\s*\)?\s*$/i.test(pm[3] || '')) {
      crits.push({ partTitle: l.replace(/[\s:]+$/, '') });
      continue;
    }
    let max = null;
    if (!PTS.some(r => r.test(l)) && /[a-zA-ZÀ-ÿ]{3}/.test(l)) {
      const letters = l.replace(/[^a-zA-ZÀ-ÿ]/g, '');
      const caps = letters.length >= 4 && letters === letters.toUpperCase();
      const numbered = /^([IVX]{1,4}|[A-H]|\d{1,2})\s*[.)\-–]\s+\S/.test(l);
      if (strong.has(idx) || ((caps || numbered || /:\s*$/.test(l) || mostPts) && nextHasPts(lines, idx))) {
        crits.push({ partTitle: l.replace(/[\s:]+$/, '') });
        continue;
      }
    }
    const m =
      l.match(/[/]\s*(\d+(?:[.,]\d+)?)\s*(?:pts?|points?)?\s*\)?\s*$/i) ||
      l.match(/\(?\s*(\d+(?:[.,]\d+)?)\s*(?:pts?|points?)\s*\)?\s*$/i) ||
      l.match(/[:\-–]\s*(\d+(?:[.,]\d+)?)\s*$/) ||
      l.match(/\s(\d{1,2}(?:[.,]\d+)?)\s*$/);
    if (m) {
      max = parseFloat(m[1].replace(',', '.'));
      l = l.slice(0, m.index).replace(/[\s:\-–.…(]+$/, '').trim();
    }
    // numérotation en début de ligne (1. / a) / I -)
    l = l.replace(/^(\d{1,2}|[a-hA-H]|[IVX]{1,4})\s*[.)\-–]\s+/, '').trim();
    if (l.length < 3 || !/[a-zA-ZÀ-ÿ]{3}/.test(l)) continue;
    // niveaux de compétence sur la même ligne : on les retire
    l = l.replace(/\s+(non acquis|en cours( d'acquisition)?|acquis|ma[iî]tris[ée]e?|insuffisant|fragile|satisfaisant|tr[eè]s bonne ma[iî]trise)(\s+.*)?$/i, '').trim();
    if (l.length < 3) continue;
    crits.push({ label: l.charAt(0).toUpperCase() + l.slice(1), max: max != null && max > 0 && max <= 100 ? max : null });
  }
  // les titres de partie sont rangés à part : chaque critère porte le titre de sa partie
  const out = [];
  let part = null;
  for (const c of crits) {
    if (c.partTitle) part = c.partTitle;
    else out.push(part ? { ...c, part } : c);
  }
  const withPts = out.filter(c => c.max != null).length;
  const mode = out.length && withPts >= out.length / 2 ? 'note' : 'acquis';
  return { mode, criteria: out };
}
