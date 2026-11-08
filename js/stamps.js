// Tampons : symboles (✓ ✗ ★) dessinés en vectoriel, étiquettes de texte encadrées, et images importées
// (logos…) gardées dans les réglages (settings.imageStamps) et désignées par leur identifiant.
// Même géométrie à l'écran (canvas) et dans le PDF corrigé (pdf-lib).

export const BUILTIN_STAMPS = [
  { k: 'check' },
  { k: 'cross' },
  { k: 'star' },
  { k: 'text', text: 'Très bien' },
  { k: 'text', text: 'Bien' },
  { k: 'text', text: 'À revoir' },
  { k: 'text', text: 'Attention' },
  { k: 'text', text: 'Justifiez' },
  { k: 'text', text: 'Unité ?' },
  { k: 'text', text: 'Orthographe' },
  { k: 'text', text: '?' },
];

// Taille = fraction de la largeur de la page
export const STAMP_SIZES = [
  { s: 0.028, d: 6, label: 'Petit' },
  { s: 0.04, d: 10, label: 'Moyen' },
  { s: 0.056, d: 14, label: 'Grand' },
];

// Les images sont plus grandes que les symboles : même échelle Petit / Moyen / Grand, multipliée.
export const IMAGE_SCALE = 4;

// Images déjà chargées (src -> HTMLImageElement), pour dessiner sans attendre.
const imgCache = new Map();
export function preloadImage(src) {
  if (!src) return Promise.resolve(null);
  if (imgCache.has(src)) return imgCache.get(src).ready;
  const img = new Image();
  img.ready = new Promise(res => {
    img.onload = () => res(img);
    img.onerror = () => res(null);
  });
  img.src = src;
  imgCache.set(src, img);
  return img.ready;
}

// Formes en coordonnées unitaires (-0.5..0.5), y vers le bas
export function stampShapes(k) {
  if (k === 'check') return { stroke: 0.14, lines: [[[-0.42, 0.02], [-0.13, 0.32], [0.45, -0.36]]] };
  if (k === 'cross')
    return {
      stroke: 0.13,
      lines: [
        [[-0.36, -0.36], [0.36, 0.36]],
        [[0.36, -0.36], [-0.36, 0.36]],
      ],
    };
  if (k === 'star') {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.21 : 0.5;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push([r * Math.cos(a), r * Math.sin(a) + 0.04]);
    }
    return { fill: [pts] };
  }
  return null;
}

// Mesures d'une étiquette texte, à partir de la taille de police F
export const labelMetrics = (F, textWidth) => ({ padX: 0.4 * F, padY: 0.3 * F, border: Math.max(1, 0.1 * F), w: textWidth + 0.8 * F, h: F * 1.35 });

// Boîte englobante en pixels CSS de la page (pour la gomme)
export function stampBoxCss(it, W, H, g) {
  const S = it.s * W;
  const cx = it.x * W,
    cy = it.y * H;
  if (it.k === 'img') {
    const h = S / (it.ar || 1);
    return { x: cx - S / 2, y: cy - h / 2, w: S, h };
  }
  if (it.k !== 'text') return { x: cx - S / 2, y: cy - S / 2, w: S, h: S };
  const F = S * 0.5;
  g.save();
  g.font = `bold ${F}px Helvetica, Arial, sans-serif`;
  const m = labelMetrics(F, g.measureText(it.text).width);
  g.restore();
  return { x: cx - m.w / 2, y: cy - m.h / 2, w: m.w, h: m.h };
}

// `srcOf(id)` donne l'image (data URL) d'un tampon image.
export function drawStampCanvas(g, it, W, H, srcOf = () => null) {
  const S = it.s * W;
  const cx = it.x * W,
    cy = it.y * H;
  if (it.k === 'img') {
    const b = stampBoxCss(it, W, H, g);
    const img = imgCache.get(srcOf(it.img));
    g.save();
    if (img && img.complete && img.naturalWidth) g.drawImage(img, b.x, b.y, b.w, b.h);
    else {
      // image absente (supprimée ou pas encore chargée) : simple cadre
      g.strokeStyle = '#999';
      g.setLineDash([6, 4]);
      g.lineWidth = Math.max(1, S * 0.01);
      g.strokeRect(b.x, b.y, b.w, b.h);
    }
    g.restore();
    return;
  }
  g.save();
  g.strokeStyle = g.fillStyle = it.c;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const sh = stampShapes(it.k);
  if (sh && sh.lines) {
    g.lineWidth = sh.stroke * S;
    for (const l of sh.lines) {
      g.beginPath();
      l.forEach(([ux, uy], i) => (i ? g.lineTo : g.moveTo).call(g, cx + ux * S, cy + uy * S));
      g.stroke();
    }
  } else if (sh && sh.fill) {
    for (const poly of sh.fill) {
      g.beginPath();
      poly.forEach(([ux, uy], i) => (i ? g.lineTo : g.moveTo).call(g, cx + ux * S, cy + uy * S));
      g.closePath();
      g.fill();
    }
  } else {
    const F = S * 0.5;
    g.font = `bold ${F}px Helvetica, Arial, sans-serif`;
    const tw = g.measureText(it.text).width;
    const m = labelMetrics(F, tw);
    const x = cx - m.w / 2,
      y = cy - m.h / 2,
      r = F * 0.3;
    g.lineWidth = m.border;
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + m.w, y, x + m.w, y + m.h, r);
    g.arcTo(x + m.w, y + m.h, x, y + m.h, r);
    g.arcTo(x, y + m.h, x, y, r);
    g.arcTo(x, y, x + m.w, y, r);
    g.closePath();
    g.save();
    g.globalAlpha = 0.85;
    g.fillStyle = '#ffffff';
    g.fill();
    g.restore();
    g.globalAlpha = 0.95;
    g.stroke();
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText(it.text, cx, cy + F * 0.04);
  }
  g.restore();
}

// Dessin dans le PDF. toPdf(x, y) convertit des coordonnées relatives (0..1) de la page en points PDF.
// `images` : identifiant -> image déjà intégrée au PDF (doc.embedPng).
export function drawStampPdf(page, it, { toPdf, vpW, vpH, rgbColor, bold, safe, images = {} }) {
  const white = window.PDFLib.rgb(1, 1, 1);
  const S = it.s * vpW;
  if (it.k === 'img') {
    const img = images[it.img];
    if (!img) return;
    const h = S / (it.ar || 1);
    const [x0, y0] = toPdf(it.x - S / 2 / vpW, it.y + h / 2 / vpH); // coin bas-gauche
    page.drawImage(img, { x: x0, y: y0, width: S, height: h });
    return;
  }
  const sh = stampShapes(it.k);
  const pt = (ux, uy) => toPdf(it.x + (ux * S) / vpW, it.y + (uy * S) / vpH);
  const path = (poly, close) => poly.map(([ux, uy], i) => {
    const [px, py] = pt(ux, uy);
    return `${i ? 'L' : 'M'}${px.toFixed(2)},${(-py).toFixed(2)}`;
  }).join(' ') + (close ? ' Z' : '');
  if (sh && sh.lines) {
    for (const l of sh.lines)
      page.drawSvgPath(path(l), { x: 0, y: 0, borderColor: rgbColor, borderWidth: sh.stroke * S, borderLineCap: 1 });
  } else if (sh && sh.fill) {
    for (const poly of sh.fill) page.drawSvgPath(path(poly, true), { x: 0, y: 0, color: rgbColor });
  } else {
    const F = S * 0.5;
    const text = safe(it.text);
    const m = labelMetrics(F, bold.widthOfTextAtSize(text, F));
    const [x0, y0] = toPdf(it.x - m.w / 2 / vpW, it.y + m.h / 2 / vpH); // coin bas-gauche
    page.drawRectangle({ x: x0, y: y0, width: m.w, height: m.h, color: white, opacity: 0.85, borderColor: rgbColor, borderWidth: m.border, borderOpacity: 0.95 });
    const [tx, ty] = toPdf(it.x - (m.w / 2 - m.padX) / vpW, it.y + (F * 0.35) / vpH);
    page.drawText(text, { x: tx, y: ty, size: F, font: bold, color: rgbColor });
  }
}
