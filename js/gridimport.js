// Lecture d'une grille d'évaluation depuis un PDF ou une photo.
// PDF avec texte : lecture directe. Photo ou PDF scanné : reconnaissance de texte (Tesseract, gratuit, dans la tablette).
import { loadScript } from './util.js';

// Tesseract est inclus dans l'appli (lib/tesseract) : la lecture marche sans internet.
const TESSERACT = 'lib/tesseract/tesseract.min.js';

async function pdfLines(file) {
  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 5); p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    // regroupe les morceaux de texte par ligne (même hauteur)
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5],
        x = it.transform[4];
      let row = rows.find(r => Math.abs(r.y - y) < 4);
      if (!row) rows.push((row = { y, parts: [] }));
      row.parts.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) lines.push(r.parts.sort((a, b) => a.x - b.x).map(p => p.s).join(' ').replace(/\s+/g, ' ').trim());
  }
  const textOk = lines.join('').replace(/\s/g, '').length > 20;
  return { lines, pdf, textOk };
}

async function ocr(canvasOrFile, onProgress) {
  await loadScript(TESSERACT);
  const base = new URL('lib/tesseract/', location.href).href;
  const worker = await window.Tesseract.createWorker('fra', 1, {
    workerPath: base + 'worker.min.js',
    corePath: base,
    langPath: base + 'lang',
    workerBlobURL: false,
    logger: m => m.status === 'recognizing text' && onProgress && onProgress(Math.round(m.progress * 100)),
  });
  try {
    const { data } = await worker.recognize(canvasOrFile);
    return data.text.split('\n').map(l => l.trim());
  } finally {
    await worker.terminate();
  }
}

export async function readGridFile(file, onProgress = () => {}) {
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
  return parseGrid(lines);
}

// Transforme des lignes de texte en critères. Repère les points : « /4 », « 4 pts », « (2 points) », « 3 » en fin de ligne.
export function parseGrid(lines) {
  const crits = [];
  const skip = /^(grille|crit[eè]re|comp[ée]tence|bar[eè]me|nom|pr[ée]nom|classe|date|total|note\s*(finale|globale)?|points?|niveau|appr[ée]ciation|commentaire)s?\s*[:\-]?\s*$/i;
  for (let raw of lines) {
    let l = String(raw || '')
      .replace(/[|_]{2,}/g, ' ')
      .replace(/[□☐❑▢○●•▪◦·]/g, ' ')
      .replace(/^\s*[-–—*>]+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (l.length < 3 || skip.test(l) || /^grille\s+d/i.test(l) || /^(crit[eè]res?|comp[ée]tences?|items?)(\s+(points?|bar[eè]me|niveaux?|notes?|acquis|en cours|non acquis))*\s*$/i.test(l)) continue;
    if (/^total\b/i.test(l)) continue;
    let max = null;
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
  const withPts = crits.filter(c => c.max != null).length;
  const mode = crits.length && withPts >= crits.length / 2 ? 'note' : 'acquis';
  return { mode, criteria: crits };
}
