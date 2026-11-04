// Conversion des documents rendus par les étudiants en PDF : PDF (tel quel), Word .docx, photos.
// Tout se fait dans la tablette, sans service en ligne. Plusieurs fichiers sont assemblés à la suite.
import { loadScript } from './util.js';

const { PDFDocument } = window.PDFLib;

export const ACCEPT_DOCS =
  'application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*';

const isPdf = f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
const isDocx = f => /\.docx$/i.test(f.name) || /wordprocessingml/.test(f.type);
const isImage = f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|gif|bmp)$/i.test(f.name);

export function checkSupported(f) {
  if (isPdf(f) || isDocx(f) || isImage(f)) return null;
  if (/\.(doc|odt|rtf|pages)$/i.test(f.name)) return `« ${f.name} » : ce format n'est pas lu directement. Enregistrez-le en .docx ou en PDF depuis Word.`;
  return `« ${f.name} » n'est ni un PDF, ni un fichier Word (.docx), ni une photo.`;
}

// Word (.docx) -> pages en image -> PDF
async function docxToPdf(file) {
  await loadScript('lib/word/jszip.min.js');
  await loadScript('lib/word/docx-preview.min.js');
  await loadScript('lib/word/html2canvas.min.js');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1000px;background:#fff;z-index:-1';
  document.body.appendChild(host);
  try {
    await window.docx.renderAsync(file, host, null, {
      inWrapper: false,
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
      ignoreWidth: false,
      ignoreHeight: false,
      renderHeaders: true,
      renderFooters: true,
      useBase64URL: true,
    });
    // laisse le temps aux images et polices de s'afficher
    await new Promise(r => setTimeout(r, 300));
    const sections = [...host.querySelectorAll('section.docx')];
    if (!sections.length) throw new Error('document Word vide ou illisible');
    const doc = await PDFDocument.create();
    for (const sec of sections) {
      const w = sec.offsetWidth || 794;
      const pageH = Math.round(w * 1.4142); // A4
      const canvas = await window.html2canvas(sec, { scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: true });
      const totalH = canvas.height / 2;
      const slices = Math.max(1, Math.ceil(totalH / pageH - 0.05));
      for (let i = 0; i < slices; i++) {
        const sh = Math.min(pageH, totalH - i * pageH);
        if (sh < 20 && i > 0) break;
        const c = document.createElement('canvas');
        c.width = canvas.width;
        c.height = Math.round(pageH * 2);
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(canvas, 0, i * pageH * 2, canvas.width, sh * 2, 0, 0, canvas.width, sh * 2);
        const jpg = await doc.embedJpg(c.toDataURL('image/jpeg', 0.88));
        const page = doc.addPage([w * 0.75, pageH * 0.75]);
        page.drawImage(jpg, { x: 0, y: 0, width: w * 0.75, height: pageH * 0.75 });
      }
    }
    return doc.save();
  } finally {
    host.remove();
  }
}

// Photo -> une page PDF (largeur A4, hauteur selon la photo)
async function imageToPdf(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`photo « ${file.name} » illisible`));
      i.src = url;
    });
    const max = 2200;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    const doc = await PDFDocument.create();
    const jpg = await doc.embedJpg(c.toDataURL('image/jpeg', 0.85));
    const W = 595.28;
    const H = (W * c.height) / c.width;
    doc.addPage([W, H]).drawImage(jpg, { x: 0, y: 0, width: W, height: H });
    return doc.save();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function fileToPdfBytes(file) {
  const err = checkSupported(file);
  if (err) throw new Error(err);
  if (isPdf(file)) return new Uint8Array(await file.arrayBuffer());
  if (isDocx(file)) return docxToPdf(file);
  return imageToPdf(file);
}

// Assemble plusieurs PDF (Uint8Array) en un seul.
export async function mergePdfs(list) {
  if (list.length === 1) return list[0];
  const out = await PDFDocument.create();
  for (const bytes of list) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  return out.save();
}

// Convertit et assemble des fichiers ; `existing` (Blob PDF) est gardé en tête si fourni.
export async function filesToPdfBlob(files, existing = null, onProgress = () => {}) {
  const parts = [];
  if (existing) parts.push(new Uint8Array(await existing.arrayBuffer()));
  let i = 0;
  for (const f of files) {
    onProgress(`Préparation de « ${f.name} » (${++i}/${files.length})…`);
    parts.push(await fileToPdfBytes(f));
  }
  return new Blob([await mergePdfs(parts)], { type: 'application/pdf' });
}
