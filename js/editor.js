// Écran de correction : affichage du PDF, annotation au stylet, grille, commentaire (écrit ou dicté).
import { esc, $, $$, modal, toast, attachDictation, speechSupported, computeResult, fmtNum, parseNum, studentName, download, pickFiles, imageToDataUrl } from './util.js';
import { buildCorrectedPdf, correctedFileName } from './pdfexport.js';
import { BUILTIN_STAMPS, STAMP_SIZES, IMAGE_SCALE, drawStampCanvas, stampBoxCss, preloadImage } from './stamps.js';

const COLORS = ['#d62828', '#1f8a3a', '#1d4ed8', '#111111'];
const HL_COLORS = ['#ffd60a', '#7ee081', '#7cc6fe', '#ff9ecd'];
// Épaisseurs en pixels à l'écran : un trait fin reste fin même quand on zoome pour écrire.
const WIDTHS = [
  { px: 1.1, d: 3, label: 'Très fin' },
  { px: 2, d: 5, label: 'Fin' },
  { px: 3.5, d: 8, label: 'Moyen' },
  { px: 6, d: 12, label: 'Épais' },
];
const TEXT_SIZES = [
  { s: 0.018, label: 'Petit' },
  { s: 0.024, label: 'Moyen' },
  { s: 0.034, label: 'Grand' },
];

const prefs = (() => {
  try {
    return JSON.parse(localStorage.getItem('editor-prefs') || '{}');
  } catch {
    return {};
  }
})();
const savePrefs = () => {
  try {
    localStorage.setItem('editor-prefs', JSON.stringify(prefs));
  } catch {}
};

export async function mountEditor(root, ctx) {
  const { copy, student, assignment, settings } = ctx;
  copy.annotations = copy.annotations || {};
  copy.evaluation = copy.evaluation || {};

  const st = {
    tool: prefs.tool || 'pen',
    color: prefs.color || COLORS[0],
    hlColor: prefs.hlColor || HL_COLORS[0],
    width: Math.min(WIDTHS.length - 1, prefs.width2 ?? 1),
    stamp: prefs.stamp || BUILTIN_STAMPS[0],
    stampSize: prefs.stampSize ?? 1,
    textSize: prefs.textSize ?? 1,
    zoom: 1,
    stylusOnly: prefs.stylusOnly ?? settings.stylusOnly,
    panelOpen: prefs.panelOpen ?? true,
  };
  if (st.tool === 'hand') st.tool = 'pen';
  let destroyed = false;
  let undo = [],
    redo = [];
  let pdf = null;
  const pages = [];

  const idx = ctx.order.indexOf(student.id);
  const prevId = idx > 0 ? ctx.order[idx - 1] : null;
  const nextId = idx >= 0 && idx < ctx.order.length - 1 ? ctx.order[idx + 1] : null;

  root.innerHTML = `
  <div class="editor ${st.panelOpen ? 'panel-open' : ''}">
    <div class="ed-top">
      <button class="icon-btn" data-act="back" title="Retour au devoir">←</button>
      <div class="ed-title"><b>${esc(studentName(student))}</b><small>${esc(assignment.title)} · ${idx + 1}/${ctx.order.length}</small></div>
      <button class="icon-btn" data-act="prev" ${prevId ? '' : 'disabled'} title="Étudiant précédent">‹</button>
      <button class="icon-btn" data-act="next" ${nextId ? '' : 'disabled'} title="Étudiant suivant">›</button>
      <button class="btn small" data-act="panel">📝 Évaluation</button>
    </div>
    <div class="ed-tools">
      <div class="tool-group">
        <button class="tool" data-tool="pen" title="Stylo">✒️</button>
        <button class="tool" data-tool="hl" title="Surligneur">🖍️</button>
        <button class="tool" data-tool="text" title="Texte (clavier ou dictée)">T</button>
        <button class="tool" data-tool="stamp" title="Tampons">🏷️</button>
        <button class="tool" data-tool="eraser" title="Gomme">⌫</button>
        <button class="tool" data-tool="hand" title="Déplacer">✋</button>
      </div>
      <div class="tool-group colors"></div>
      <div class="tool-group widths"></div>
      <div class="tool-group stamps"></div>
      <div class="tool-group">
        <button class="tool" data-act="undo" title="Annuler">↶</button>
        <button class="tool" data-act="redo" title="Rétablir">↷</button>
      </div>
      <div class="tool-group">
        <button class="tool" data-act="zoomout" title="Dézoomer">−</button>
        <button class="tool zoomlabel" data-act="zoomfit" title="Ajuster à la largeur">100%</button>
        <button class="tool" data-act="zoomin" title="Zoomer">+</button>
      </div>
      <label class="tool-toggle" title="Si activé, seul le stylet écrit ; le doigt sert à défiler et zoomer.">
        <input type="checkbox" data-act="stylus" ${st.stylusOnly ? 'checked' : ''}> Stylet seul
      </label>
    </div>
    <div class="ed-main">
      <div class="ed-scroll"><div class="ed-pages"><div class="loading">Chargement de la copie…</div></div></div>
      <aside class="ed-panel"></aside>
    </div>
  </div>`;

  const ed = $('.editor', root);
  const scroll = $('.ed-scroll', root);
  const pagesEl = $('.ed-pages', root);
  const panel = $('.ed-panel', root);

  // ---------- Barre d'outils ----------
  // Les écouteurs posés sur `root` (partagé entre les copies) sont retirés quand on change de copie.
  const life = new AbortController();
  const customColors = () => (settings.customColors = settings.customColors || []);
  const customStamps = () => (settings.customStamps = settings.customStamps || []);
  // tampons image : on garde aussi ceux qu'on retire de la liste (deleted), pour les copies déjà tamponnées
  const imageStamps = () => (settings.imageStamps = settings.imageStamps || []);
  const imgSrc = id => (imageStamps().find(x => x.id === id) || {}).src;
  const sameStamp = (a, b) => a && b && a.k === b.k && (a.k === 'img' ? a.img === b.img : a.k !== 'text' || a.text === b.text);
  await Promise.all(imageStamps().map(x => preloadImage(x.src)));

  function renderToolbar() {
    $$('.tool[data-tool]', root).forEach(b => b.classList.toggle('on', b.dataset.tool === st.tool));
    const colorList = [...(st.tool === 'hl' ? HL_COLORS : COLORS), ...customColors()];
    const cur = st.tool === 'hl' ? st.hlColor : st.color;
    $('.colors', root).innerHTML =
      colorList.map(c => `<button class="swatch ${c === cur ? 'on' : ''}" data-color="${c}" style="--c:${c}" title="Couleur"></button>`).join('') +
      `<button class="swatch add" data-act="colors" title="Couleurs personnalisées">＋</button>`;
    const isText = st.tool === 'text',
      isStamp = st.tool === 'stamp';
    const sizes = isText ? TEXT_SIZES : isStamp ? STAMP_SIZES : WIDTHS;
    const curSize = isText ? st.textSize : isStamp ? st.stampSize : st.width;
    $('.widths', root).innerHTML = sizes
      .map((w, i) => `<button class="tool wbtn ${i === curSize ? 'on' : ''}" data-w="${i}" title="${w.label}"><span style="--d:${w.d || 4 + i * 4}px"></span></button>`)
      .join('');
    const stamps = [
      ...BUILTIN_STAMPS,
      ...customStamps().map(text => ({ k: 'text', text })),
      ...imageStamps().filter(x => !x.deleted).map(x => ({ k: 'img', img: x.id, ar: x.ar })),
    ];
    $('.stamps', root).innerHTML = isStamp
      ? stamps
          .map(
            (sp, i) =>
              `<button class="stamp-btn ${sp.k === 'img' ? 'img' : ''} ${sameStamp(sp, st.stamp) ? 'on' : ''}" data-stamp="${i}" style="--c:${st.color}" title="Tampon">${
                sp.k === 'check' ? '✓' : sp.k === 'cross' ? '✗' : sp.k === 'star' ? '★' : sp.k === 'img' ? `<img src="${esc(imgSrc(sp.img))}" alt="">` : esc(sp.text)
              }</button>`
          )
          .join('') +
        `<button class="stamp-btn add" data-act="stamps" title="Créer ou supprimer des tampons (texte ou image)">＋ Tampon</button>`
      : '';
    $('.stamps', root).style.display = isStamp ? '' : 'none';
    $('.colors', root).style.display = st.tool === 'eraser' || st.tool === 'hand' ? 'none' : '';
    $('.widths', root).style.display = st.tool === 'eraser' || st.tool === 'hand' ? 'none' : '';
    $('.zoomlabel', root).textContent = Math.round(st.zoom * 100) + '%';
    $('[data-act=undo]', root).disabled = !undo.length;
    $('[data-act=redo]', root).disabled = !redo.length;
    scroll.dataset.tool = st.tool;
    renderToolbar.stamps = stamps;
    if (st.tool !== 'stamp') hideStampBar();
  }

  async function manageColors() {
    let picked = null;
    const r = await modal({
      title: 'Couleurs personnalisées',
      body: `<p class="muted small">Choisissez une couleur puis « Ajouter ». Elle reste disponible pour toutes les copies (8 au maximum).</p>
        <div class="row"><input type="color" id="cpick" value="${st.tool === 'hl' ? st.hlColor : st.color}" class="color-input"><span class="muted">Touchez le carré pour choisir</span></div>
        <div class="custom-list">${customColors()
          .map((c, i) => `<span class="custom-item"><span class="swatch" style="--c:${c}"></span><button class="icon-btn" data-delc="${i}" title="Retirer">✕</button></span>`)
          .join('') || '<p class="muted small">Aucune couleur personnalisée pour l’instant.</p>'}</div>`,
      actions: [
        { label: 'Fermer', value: null },
        { label: 'Ajouter cette couleur', value: 'add', cls: 'primary' },
      ],
      onOpen: (w, close) =>
        $$('[data-delc]', w).forEach(
          b =>
            (b.onclick = async () => {
              customColors().splice(+b.dataset.delc, 1);
              await ctx.saveSettings(settings);
              close('deleted');
            })
        ),
      validate: (v, w) => {
        picked = $('#cpick', w).value;
        return true;
      },
    });
    if (r === 'add' && picked) {
      const list = customColors().filter(c => c !== picked);
      list.push(picked);
      settings.customColors = list.slice(-8);
      if (st.tool === 'hl') st.hlColor = prefs.hlColor = picked;
      else {
        st.color = prefs.color = picked;
        if (st.tool !== 'text' && st.tool !== 'stamp') st.tool = prefs.tool = 'pen';
      }
      await ctx.saveSettings(settings);
      savePrefs();
    }
    renderToolbar();
    if (r === 'deleted') manageColors();
  }

  async function manageStamps() {
    let text = '';
    const r = await modal({
      title: 'Mes tampons',
      body: `<p class="muted small">Créez des tampons pour les remarques que vous écrivez souvent (ex. « Bonne démarche », « Cf. cours », « Hors sujet »).</p>
        <div class="row"><input class="input" id="stext" maxlength="40" placeholder="Texte du tampon"><span></span></div>
        <div class="custom-list">${customStamps()
          .map((t, i) => `<span class="custom-item stamp-chip">${esc(t)}<button class="icon-btn" data-dels="${i}" title="Supprimer">✕</button></span>`)
          .join('') || '<p class="muted small">Aucun tampon texte personnel pour l’instant.</p>'}</div>
        <h3 style="margin-top:18px">Tampons image</h3>
        <p class="muted small">Un logo, une signature, un autocollant… Image PNG (de préférence à fond transparent) ou JPG.</p>
        <button class="btn" id="simg">🖼 Importer une image</button>
        <div class="custom-list">${imageStamps()
          .filter(x => !x.deleted)
          .map(x => `<span class="custom-item img-chip"><img src="${esc(x.src)}" alt=""><button class="icon-btn" data-deli="${esc(x.id)}" title="Supprimer">✕</button></span>`)
          .join('')}</div>`,
      actions: [
        { label: 'Fermer', value: null },
        { label: 'Créer le tampon', value: 'add', cls: 'primary' },
      ],
      onOpen: (w, close) => {
        $$('[data-dels]', w).forEach(
          b =>
            (b.onclick = async () => {
              customStamps().splice(+b.dataset.dels, 1);
              await ctx.saveSettings(settings);
              close('deleted');
            })
        );
        $$('[data-deli]', w).forEach(
          b =>
            (b.onclick = async () => {
              const x = imageStamps().find(y => y.id === b.dataset.deli);
              if (x) x.deleted = true; // les copies déjà tamponnées gardent l'image
              await ctx.saveSettings(settings);
              close('deleted');
            })
        );
        $('#simg', w).onclick = async () => {
          const [f] = await pickFiles({ accept: 'image/*' });
          if (!f) return;
          try {
            const src = await imageToDataUrl(f, 600);
            const img = await preloadImage(src);
            if (!img) throw new Error('image illisible');
            const def = { id: 'i' + Date.now().toString(36), src, ar: img.naturalWidth / img.naturalHeight };
            imageStamps().push(def);
            await ctx.saveSettings(settings);
            st.stamp = prefs.stamp = { k: 'img', img: def.id, ar: def.ar };
            st.tool = prefs.tool = 'stamp';
            savePrefs();
            toast('Tampon image ajouté : touchez la copie pour le poser.', 'success');
            close('image');
          } catch (e) {
            toast('Impossible de lire cette image (' + e.message + ').', 'error');
          }
        };
      },
      validate: (v, w) => {
        text = $('#stext', w).value.trim();
        if (!text) toast('Écrivez le texte du tampon.', 'error');
        return !!text;
      },
    });
    if (r === 'add') {
      if (!customStamps().includes(text)) customStamps().push(text);
      st.stamp = prefs.stamp = { k: 'text', text };
      await ctx.saveSettings(settings);
      savePrefs();
    }
    renderToolbar();
    if (r === 'deleted') manageStamps();
  }

  root.addEventListener(
    'click',
    e => {
      const t = e.target.closest('button, input');
      if (!t || !root.contains(t) || t.closest('.ed-panel')) return;
      if (t.dataset.tool) {
        st.tool = t.dataset.tool;
        if (st.tool !== 'hand') prefs.tool = st.tool;
      } else if (t.dataset.color) {
        if (st.tool === 'hl') st.hlColor = prefs.hlColor = t.dataset.color;
        else {
          st.color = prefs.color = t.dataset.color;
          if (st.tool !== 'text' && st.tool !== 'stamp') st.tool = prefs.tool = 'pen';
        }
      } else if (t.dataset.w != null) {
        if (st.tool === 'text') st.textSize = prefs.textSize = +t.dataset.w;
        else if (st.tool === 'stamp') st.stampSize = prefs.stampSize = +t.dataset.w;
        else st.width = prefs.width2 = +t.dataset.w;
      } else if (t.dataset.stamp != null) {
        st.stamp = prefs.stamp = renderToolbar.stamps[+t.dataset.stamp];
      } else {
        switch (t.dataset.act) {
          case 'back':
            return ctx.exit();
          case 'prev':
            return prevId && ctx.goto(prevId);
          case 'next':
            return nextId && ctx.goto(nextId);
          case 'panel':
            st.panelOpen = prefs.panelOpen = !st.panelOpen;
            ed.classList.toggle('panel-open', st.panelOpen);
            savePrefs();
            setTimeout(relayout, 260);
            return;
          case 'undo':
            return doUndo();
          case 'redo':
            return doRedo();
          case 'zoomin':
            return setZoom(st.zoom * 1.25);
          case 'zoomout':
            return setZoom(st.zoom / 1.25);
          case 'zoomfit':
            return setZoom(1);
          case 'colors':
            return manageColors();
          case 'stamps':
            return manageStamps();
          case 'stylus':
            st.stylusOnly = prefs.stylusOnly = t.checked;
            savePrefs();
            toast(st.stylusOnly ? 'Seul le stylet écrit. Le doigt fait défiler.' : 'Le doigt écrit aussi (2 doigts pour défiler).');
            return;
          default:
            return;
        }
      }
      savePrefs();
      renderToolbar();
    },
    { signal: life.signal }
  );

  // ---------- Historique (annuler / rétablir) ----------
  const snapshot = () => JSON.stringify(copy.annotations);
  function pushHistory() {
    undo.push(snapshot());
    if (undo.length > 60) undo.shift();
    redo = [];
  }
  function doUndo() {
    hideStampBar();
    if (!undo.length) return;
    redo.push(snapshot());
    copy.annotations = JSON.parse(undo.pop());
    pages.forEach(redrawCache);
    changed();
  }
  function doRedo() {
    hideStampBar();
    if (!redo.length) return;
    undo.push(snapshot());
    copy.annotations = JSON.parse(redo.pop());
    pages.forEach(redrawCache);
    changed();
  }

  let saveTimer = null;
  function changed() {
    renderToolbar();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ctx.save(copy), 600);
  }

  // ---------- Chargement du PDF ----------
  if (copy.pdf instanceof Blob) {
    try {
      const data = new Uint8Array(await copy.pdf.arrayBuffer());
      pdf = await window.pdfjsLib.getDocument({ data }).promise;
      pagesEl.innerHTML = '';
      for (let i = 0; i < pdf.numPages; i++) {
        const pg = await pdf.getPage(i + 1);
        const vp1 = pg.getViewport({ scale: 1 });
        const div = document.createElement('div');
        div.className = 'page';
        div.dataset.i = i;
        div.innerHTML = `<canvas class="pdf"></canvas><canvas class="ink"></canvas>`;
        pagesEl.appendChild(div);
        pages.push({ i, pg, vp1, div, pdfC: div.children[0], inkC: div.children[1], cache: document.createElement('canvas'), task: null, renderedW: 0 });
      }
    } catch (err) {
      console.error(err);
      pagesEl.innerHTML = `<div class="empty-copy"><p>Impossible d'ouvrir ce PDF (${esc(err.message)}).</p></div>`;
    }
  } else {
    const k = ctx.kind;
    pagesEl.innerHTML =
      k === 'oral' || k === 'groupe'
        ? `<div class="empty-copy"><div class="big-ico">${k === 'oral' ? '🎤' : '👥'}</div>
          <p><b>${k === 'oral' ? 'Évaluation orale' : 'Travail de groupe'}</b> : remplissez la grille et le commentaire à droite${student.isGroup ? ', ils seront reportés sur la fiche de chaque membre du groupe' : ''}.</p>
          <button class="btn" data-act2="import">Joindre un document PDF (facultatif)</button></div>`
        : `<div class="empty-copy"><p>Pas encore de copie PDF pour ${esc(studentName(student))}.</p>
      <button class="btn primary" data-act2="import">Importer le PDF</button>
      <p class="muted">Vous pouvez aussi remplir uniquement la grille et le commentaire.</p></div>`;
    if (!st.panelOpen && (k === 'oral' || k === 'groupe')) {
      st.panelOpen = true;
      ed.classList.add('panel-open');
    }
    $('[data-act2=import]', pagesEl).onclick = () => ctx.importPdf();
  }

  // ---------- Mise en page & rendu ----------
  const PAD = 12;
  function pageCssWidth(p) {
    const avail = Math.max(200, scroll.clientWidth - PAD * 2);
    // on évite qu'une page paysage soit gigantesque et qu'une page portrait soit minuscule
    return avail * st.zoom;
  }
  function relayout() {
    for (const p of pages) {
      const w = pageCssWidth(p);
      const h = (w * p.vp1.height) / p.vp1.width;
      p.cssW = w;
      p.cssH = h;
      p.div.style.width = w + 'px';
      p.div.style.height = h + 'px';
    }
    if (stampSel) placeStampBar();
    scheduleRender();
  }

  // ---------- Tampon sélectionné : agrandir / réduire / supprimer ----------
  let stampSel = null;
  const stampOutline = document.createElement('div');
  stampOutline.className = 'stamp-sel';
  const stampBar = document.createElement('div');
  stampBar.className = 'stamp-bar';
  stampBar.innerHTML = `<button data-sb="smaller" title="Réduire">−</button><button data-sb="bigger" title="Agrandir">+</button><button data-sb="delete" title="Supprimer ce tampon">🗑</button><button data-sb="ok" title="Terminé">✓</button>`;
  // les touches sur la barre ne doivent ni dessiner ni faire défiler la copie
  ['pointerdown', 'pointerup', 'pointermove'].forEach(t => stampBar.addEventListener(t, e => e.stopPropagation()));
  stampBar.addEventListener('click', e => {
    const b = e.target.closest('[data-sb]');
    if (!b || !stampSel) return;
    const { p, it } = stampSel;
    const act = b.dataset.sb;
    if (act === 'ok') return hideStampBar();
    pushHistory();
    if (act === 'delete') {
      copy.annotations[p.i] = itemsOf(p).filter(x => x !== it);
      hideStampBar();
    } else {
      const k = act === 'bigger' ? 1.2 : 1 / 1.2;
      it.s = Math.min(0.9, Math.max(0.01, it.s * k));
      placeStampBar();
    }
    redrawCache(p);
    changed();
  });
  function placeStampBar() {
    const { p, it } = stampSel;
    const b = stampBoxCss(it, p.cssW, p.cssH, p.cache.getContext('2d'));
    Object.assign(stampOutline.style, { left: b.x - 4 + 'px', top: b.y - 4 + 'px', width: b.w + 8 + 'px', height: b.h + 8 + 'px' });
    const below = b.y + b.h + 60 < p.cssH;
    Object.assign(stampBar.style, { left: Math.min(Math.max(b.x + b.w / 2, 110), p.cssW - 110) + 'px', top: (below ? b.y + b.h + 10 : b.y - 58) + 'px' });
    if (stampBar.parentNode !== p.div) p.div.append(stampOutline, stampBar);
  }
  function showStampBar(p, it) {
    stampSel = { p, it };
    placeStampBar();
  }
  function hideStampBar() {
    stampSel = null;
    stampOutline.remove();
    stampBar.remove();
  }
  let renderTimer = null;
  function scheduleRender(delay = 120) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderAll, delay);
  }
  async function renderAll() {
    for (const p of pages) {
      if (destroyed) return;
      await renderPage(p);
    }
  }
  async function renderPage(p) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let pxW = Math.round(p.cssW * dpr);
    const maxPx = 4096;
    if (pxW > maxPx) pxW = maxPx;
    if (p.renderedW === pxW) return;
    const scale = pxW / p.vp1.width;
    const vp = p.pg.getViewport({ scale });
    const pxH = Math.round(vp.height);
    if (p.task) {
      try {
        p.task.cancel();
      } catch {}
    }
    const off = document.createElement('canvas');
    off.width = pxW;
    off.height = pxH;
    p.task = p.pg.render({ canvasContext: off.getContext('2d'), viewport: vp });
    try {
      await p.task.promise;
    } catch (e) {
      if (e && e.name === 'RenderingCancelledException') return;
      throw e;
    }
    p.task = null;
    p.pdfC.width = pxW;
    p.pdfC.height = pxH;
    p.pdfC.getContext('2d').drawImage(off, 0, 0);
    p.inkC.width = p.cache.width = pxW;
    p.inkC.height = p.cache.height = pxH;
    p.renderedW = pxW;
    redrawCache(p);
  }

  function itemsOf(p) {
    return (copy.annotations[p.i] = copy.annotations[p.i] || []);
  }

  function drawItem(g, it, W, H) {
    if (it.t === 'ink') {
      const pts = it.p;
      if (!pts.length) return;
      g.save();
      g.globalAlpha = it.o ?? 1;
      if (it.hl) g.globalCompositeOperation = 'multiply';
      g.strokeStyle = it.c;
      g.lineWidth = Math.max(1, it.w * W);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(pts[0][0] * W, pts[0][1] * H);
      if (pts.length === 1) g.lineTo(pts[0][0] * W + 0.1, pts[0][1] * H);
      for (let k = 1; k < pts.length - 1; k++) {
        const mx = ((pts[k][0] + pts[k + 1][0]) / 2) * W;
        const my = ((pts[k][1] + pts[k + 1][1]) / 2) * H;
        g.quadraticCurveTo(pts[k][0] * W, pts[k][1] * H, mx, my);
      }
      if (pts.length > 1) g.lineTo(pts[pts.length - 1][0] * W, pts[pts.length - 1][1] * H);
      g.stroke();
      g.restore();
    } else if (it.t === 'stamp') {
      drawStampCanvas(g, it, W, H, imgSrc);
    } else if (it.t === 'text') {
      const size = it.s * W;
      g.save();
      g.fillStyle = it.c;
      g.font = `${size}px Helvetica, Arial, sans-serif`;
      g.textBaseline = 'alphabetic';
      String(it.text)
        .split('\n')
        .forEach((ln, k) => g.fillText(ln, it.x * W, it.y * H + (k + 0.8) * size * 1.2));
      g.restore();
    }
  }
  function textBox(it, p) {
    // boîte englobante en coordonnées CSS de la page
    const g = p.cache.getContext('2d');
    const size = it.s * p.cssW;
    g.font = `${size}px Helvetica, Arial, sans-serif`;
    const lines = String(it.text).split('\n');
    const w = Math.max(...lines.map(l => g.measureText(l).width), 10);
    return { x: it.x * p.cssW, y: it.y * p.cssH, w, h: lines.length * size * 1.2 };
  }

  function redrawCache(p) {
    if (!p.renderedW) return;
    const g = p.cache.getContext('2d');
    const W = p.cache.width,
      H = p.cache.height;
    g.clearRect(0, 0, W, H);
    for (const it of copy.annotations[p.i] || []) drawItem(g, it, W, H);
    paintInk(p);
  }
  function paintInk(p, live) {
    const g = p.inkC.getContext('2d');
    g.clearRect(0, 0, p.inkC.width, p.inkC.height);
    g.drawImage(p.cache, 0, 0);
    if (live) drawItem(g, live, p.inkC.width, p.inkC.height);
  }

  function setZoom(z, anchor) {
    z = Math.min(4, Math.max(0.5, z));
    const r = scroll.getBoundingClientRect();
    const ax = anchor ? anchor.x - r.left : scroll.clientWidth / 2;
    const ay = anchor ? anchor.y - r.top : scroll.clientHeight / 2;
    const cx = (scroll.scrollLeft + ax) / st.zoom;
    const cy = (scroll.scrollTop + ay) / st.zoom;
    st.zoom = z;
    relayout();
    scroll.scrollLeft = cx * z - ax;
    scroll.scrollTop = cy * z - ay;
    renderToolbar();
  }

  // ---------- Saisie au stylet / doigt ----------
  const touches = new Map();
  let drawing = null; // {pointerId, p, item, rect}
  let pinch = null;
  let inertia = null;

  function pageAt(x, y) {
    for (const p of pages) {
      const r = p.div.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { p, r };
    }
    return null;
  }
  const norm = (e, r) => [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];

  function capture(id) {
    try {
      scroll.setPointerCapture(id);
    } catch {}
  }

  function isNavPointer(e) {
    if (st.tool === 'hand') return true;
    if (e.pointerType === 'touch' && (st.stylusOnly || touches.size > 0)) return true;
    return false;
  }

  scroll.addEventListener('pointerdown', e => {
    if (e.button && e.button !== 0 && e.pointerType === 'mouse') return;
    if (inertia) cancelAnimationFrame(inertia), (inertia = null);
    if (isNavPointer(e) || (e.pointerType === 'touch' && drawing)) {
      if (drawing && drawing.pointerType === 'touch') cancelDrawing();
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0 });
      capture(e.pointerId);
      if (touches.size === 2) startPinch();
      return;
    }
    if (drawing) return;
    hideStampBar();
    const hit = pageAt(e.clientX, e.clientY);
    if (!hit) {
      // hors page : on fait défiler
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0 });
      capture(e.pointerId);
      return;
    }
    e.preventDefault();
    capture(e.pointerId);
    const [x, y] = norm(e, hit.r);
    if (st.tool === 'pen' || st.tool === 'hl') {
      const w = WIDTHS[st.width].px / hit.r.width;
      const item = st.tool === 'pen' ? { t: 'ink', c: st.color, w, o: 1, p: [[x, y]] } : { t: 'ink', c: st.hlColor, w: Math.max(w * 4.5, 10 / hit.r.width), o: 0.45, hl: true, p: [[x, y]] };
      drawing = { pointerId: e.pointerId, pointerType: e.pointerType, p: hit.p, item, r: hit.r };
      paintInk(hit.p, item);
    } else if (st.tool === 'eraser') {
      drawing = { pointerId: e.pointerId, pointerType: e.pointerType, p: hit.p, r: hit.r, erased: false };
      eraseAt(drawing, e);
    } else if (st.tool === 'text') {
      drawing = { pointerId: e.pointerId, pointerType: e.pointerType, p: hit.p, r: hit.r, text: [x, y], sx: e.clientX, sy: e.clientY };
    } else if (st.tool === 'stamp') {
      drawing = { pointerId: e.pointerId, pointerType: e.pointerType, p: hit.p, r: hit.r, stampAt: [x, y], sx: e.clientX, sy: e.clientY };
    }
  });

  scroll.addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) {
      const t = touches.get(e.pointerId);
      const now = performance.now();
      const dx = e.clientX - t.x,
        dy = e.clientY - t.y;
      const dt = Math.max(1, now - t.t);
      t.vx = 0.8 * (dx / dt) + 0.2 * t.vx;
      t.vy = 0.8 * (dy / dt) + 0.2 * t.vy;
      t.x = e.clientX;
      t.y = e.clientY;
      t.t = now;
      if (pinch && touches.size >= 2) updatePinch();
      else if (touches.size === 1) {
        scroll.scrollLeft -= dx;
        scroll.scrollTop -= dy;
      }
      return;
    }
    if (!drawing || drawing.pointerId !== e.pointerId) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (drawing.item) {
      const pts = drawing.item.p;
      const minD = 0.6 / drawing.r.width;
      for (const ev of evs.length ? evs : [e]) {
        const [x, y] = norm(ev, drawing.r);
        const last = pts[pts.length - 1];
        if (Math.abs(x - last[0]) + Math.abs(y - last[1]) > minD) pts.push([x, y]);
      }
      if (!drawing.raf)
        drawing.raf = requestAnimationFrame(() => {
          if (!drawing) return;
          drawing.raf = null;
          paintInk(drawing.p, drawing.item);
        });
    } else if (st.tool === 'eraser') {
      for (const ev of evs.length ? evs : [e]) eraseAt(drawing, ev);
    }
  });

  function endPointer(e) {
    if (touches.has(e.pointerId)) {
      const t = touches.get(e.pointerId);
      touches.delete(e.pointerId);
      if (pinch && touches.size < 2) endPinch();
      else if (!pinch && touches.size === 0 && performance.now() - t.t < 80) startInertia(t.vx, t.vy);
      return;
    }
    if (!drawing || drawing.pointerId !== e.pointerId) return;
    const d = drawing;
    drawing = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    if (d.item) {
      if (e.type === 'pointercancel') return paintInk(d.p);
      pushHistory();
      itemsOf(d.p).push(simplify(d.item));
      redrawCache(d.p);
      changed();
    } else if (d.erased) {
      changed();
    } else if (d.text && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 12 && e.type !== 'pointercancel') {
      textAt(d.p, d.text[0], d.text[1]);
    } else if (d.stampAt && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 16 && e.type !== 'pointercancel') {
      // toucher un tampon déjà posé le sélectionne (pour l'agrandir, le réduire ou le supprimer)
      const ex = e.clientX - d.r.left,
        ey = e.clientY - d.r.top;
      const g = d.p.cache.getContext('2d');
      const touched = itemsOf(d.p)
        .filter(it => it.t === 'stamp')
        .reverse()
        .find(it => {
          const b = stampBoxCss(it, d.r.width, d.r.height, g);
          return ex > b.x - 4 && ex < b.x + b.w + 4 && ey > b.y - 4 && ey < b.y + b.h + 4;
        });
      if (touched) return showStampBar(d.p, touched);
      const sp = st.stamp;
      if (sp.k === 'img' && !imgSrc(sp.img)) return toast('Ce tampon image a été supprimé.', 'error');
      pushHistory();
      const item = { t: 'stamp', k: sp.k, text: sp.text || '', c: st.color, s: STAMP_SIZES[st.stampSize].s * (sp.k === 'img' ? IMAGE_SCALE : 1), x: d.stampAt[0], y: d.stampAt[1] };
      if (sp.k === 'img') Object.assign(item, { img: sp.img, ar: sp.ar });
      itemsOf(d.p).push(item);
      redrawCache(d.p);
      changed();
      showStampBar(d.p, item);
    }
  }
  scroll.addEventListener('pointerup', endPointer);
  scroll.addEventListener('pointercancel', endPointer);

  function cancelDrawing() {
    if (!drawing) return;
    if (drawing.raf) cancelAnimationFrame(drawing.raf);
    const p = drawing.p;
    drawing = null;
    paintInk(p);
  }

  function startInertia(vx, vy) {
    let last = performance.now();
    const step = now => {
      const dt = now - last;
      last = now;
      scroll.scrollLeft -= vx * dt;
      scroll.scrollTop -= vy * dt;
      const f = Math.pow(0.995, dt);
      vx *= f;
      vy *= f;
      inertia = Math.abs(vx) + Math.abs(vy) > 0.02 ? requestAnimationFrame(step) : null;
    };
    if (Math.abs(vx) + Math.abs(vy) > 0.15) inertia = requestAnimationFrame(step);
  }

  function pinchInfo() {
    const [a, b] = [...touches.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  function startPinch() {
    const i = pinchInfo();
    pinch = { d0: i.d, z0: st.zoom, x: i.x, y: i.y };
  }
  function updatePinch() {
    const i = pinchInfo();
    scroll.scrollLeft -= i.x - pinch.x;
    scroll.scrollTop -= i.y - pinch.y;
    pinch.x = i.x;
    pinch.y = i.y;
    const z = Math.min(4, Math.max(0.5, pinch.z0 * (i.d / pinch.d0)));
    if (Math.abs(z - st.zoom) > 0.01) setZoom(z, i);
  }
  function endPinch() {
    pinch = null;
    touches.clear();
  }

  // Gomme : efface les traits touchés
  function eraseAt(d, e) {
    const p = d.p;
    const r = d.r;
    const ex = e.clientX - r.left,
      ey = e.clientY - r.top;
    const rad = 14;
    const items = itemsOf(p);
    const keep = [];
    let removed = false;
    for (const it of items) {
      let hit = false;
      if (it.t === 'ink') {
        const tol = rad + (it.w * r.width) / 2;
        hit = it.p.some(([x, y]) => Math.hypot(x * r.width - ex, y * r.height - ey) < tol);
      } else if (it.t === 'text') {
        const b = textBox(it, p);
        hit = ex > b.x - rad && ex < b.x + b.w + rad && ey > b.y - rad && ey < b.y + b.h + rad;
      } else if (it.t === 'stamp') {
        const b = stampBoxCss(it, r.width, r.height, p.cache.getContext('2d'));
        hit = ex > b.x - rad && ex < b.x + b.w + rad && ey > b.y - rad && ey < b.y + b.h + rad;
      }
      if (hit) removed = true;
      else keep.push(it);
    }
    if (removed) {
      if (!d.erased) pushHistory();
      d.erased = true;
      copy.annotations[p.i] = keep;
      redrawCache(p);
    }
  }

  // Simplification légère des traits (moins de points stockés)
  function simplify(item) {
    const pts = item.p;
    if (pts.length < 4) return item;
    const out = [pts[0]];
    for (let k = 1; k < pts.length - 1; k++) {
      const a = out[out.length - 1],
        b = pts[k];
      if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 0.0012) out.push(b);
    }
    out.push(pts[pts.length - 1]);
    item.p = out.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
    return item;
  }

  // Outil texte : toucher une zone pour écrire (ou dicter) un texte ; toucher un texte existant pour le modifier.
  async function textAt(p, x, y) {
    const items = itemsOf(p);
    const px = x * p.cssW,
      py = y * p.cssH;
    const existing = items.find(it => {
      if (it.t !== 'text') return false;
      const b = textBox(it, p);
      return px >= b.x - 6 && px <= b.x + b.w + 6 && py >= b.y - 6 && py <= b.y + b.h + 6;
    });
    const actions = [{ label: 'Annuler', value: null }];
    if (existing) actions.push({ label: 'Supprimer', value: 'delete', cls: 'danger' });
    actions.push({ label: existing ? 'Modifier' : 'Ajouter', value: 'ok', cls: 'primary' });
    let text = '';
    const res = await modal({
      title: existing ? 'Modifier le texte' : 'Ajouter un texte sur la copie',
      body: `<div class="dictate-wrap"><textarea class="input" id="ttext" rows="4" placeholder="Écrivez, ou appuyez sur 🎙 pour dicter">${esc(existing ? existing.text : '')}</textarea>
        <button class="mic" id="tmic" title="Dicter">🎙</button></div>
        ${speechSupported ? '<p class="muted small">Astuce : dites « virgule », « point », « à la ligne ».</p>' : ''}`,
      actions,
      onOpen: w => attachDictation($('#tmic', w), $('#ttext', w)),
      validate: (v, w) => {
        text = $('#ttext', w).value.replace(/\s+$/, '');
        return true;
      },
    });
    if (!res) return;
    pushHistory();
    if (res === 'delete') copy.annotations[p.i] = items.filter(it => it !== existing);
    else if (existing) {
      if (!text) copy.annotations[p.i] = items.filter(it => it !== existing);
      else existing.text = text;
    } else if (text) {
      items.push({ t: 'text', c: st.color, s: TEXT_SIZES[st.textSize].s, x, y: Math.max(0, y - (TEXT_SIZES[st.textSize].s * p.cssW * 0.6) / p.cssH), text });
    } else {
      undo.pop();
      return;
    }
    redrawCache(p);
    changed();
  }

  // ---------- Panneau d'évaluation ----------
  function renderPanel() {
    const grid = assignment.grid;
    const res = computeResult(grid, copy.evaluation);
    let gridHtml = '';
    if (!grid || !grid.criteria || !grid.criteria.length) {
      gridHtml = `<p class="muted">Pas encore de grille pour ce devoir.</p><button class="btn small" data-p="grid">Créer la grille</button>`;
    } else if (grid.mode === 'note') {
      gridHtml = grid.criteria
        .map(
          c => `<div class="crit">
          <div class="crit-label">${esc(c.label)}</div>
          <div class="stepper">
            <button class="icon-btn" data-p="minus" data-c="${c.id}">−</button>
            <input class="input num" inputmode="decimal" data-c="${c.id}" value="${copy.evaluation[c.id] == null ? '' : fmtNum(copy.evaluation[c.id])}" placeholder="–">
            <span class="max">/ ${fmtNum(c.max)}</span>
            <button class="icon-btn" data-p="plus" data-c="${c.id}">+</button>
            <button class="icon-btn" data-p="full" data-c="${c.id}" title="Tous les points">✓</button>
          </div></div>`
        )
        .join('');
    } else {
      const levels = grid.levels;
      gridHtml = grid.criteria
        .map(
          c => `<div class="crit">
          <div class="crit-label">${esc(c.label)}</div>
          <div class="levels">${levels
            .map((l, i) => `<button class="lvl lvl-${Math.round((i / Math.max(1, levels.length - 1)) * 2)} ${copy.evaluation[c.id] === i ? 'on' : ''}" data-p="lvl" data-c="${c.id}" data-l="${i}">${esc(l)}</button>`)
            .join('')}</div></div>`
        )
        .join('');
    }
    const fold = prefs.fold || {};
    const foldBtn = (key, title) =>
      `<button class="fold-btn" data-p="fold" data-k="${key}" aria-expanded="${!fold[key]}" title="${fold[key] ? 'Ouvrir' : 'Fermer'}"><span class="fold-arrow">▾</span><h3>${title}</h3></button>`;
    panel.innerHTML = `
      <div class="panel-sec ${fold.eval ? 'folded' : ''}">
        <div class="panel-head">
          ${foldBtn('eval', 'Évaluation')}
          ${res.short ? `<span class="score ${res.complete ? '' : 'partial'}">${esc(res.short)}</span>` : ''}
        </div>
        <div class="fold-body">${gridHtml}</div>
      </div>
      <div class="panel-sec ${fold.comment ? 'folded' : ''}">
        <div class="panel-head">
          ${foldBtn('comment', 'Commentaire')}
          ${fold.comment && (copy.comment || '').trim() ? '<span class="muted small">✓ rédigé</span>' : ''}
        </div>
        <div class="fold-body">
        <div class="dictate-wrap">
          <textarea class="input" id="comment" rows="6" placeholder="Écrivez votre commentaire, ou appuyez sur 🎙 pour le dicter">${esc(copy.comment || '')}</textarea>
          <button class="mic" id="cmic" title="Dicter le commentaire">🎙</button>
        </div>
        ${speechSupported ? '<p class="muted small">Dictée : dites « virgule », « point », « à la ligne ».</p>' : '<p class="muted small">Dictée indisponible dans ce navigateur : utilisez Chrome, ou le micro du clavier Samsung.</p>'}
        </div>
      </div>
      <div class="panel-sec actions">
        <button class="btn ${copy.status === 'done' ? 'success' : 'primary'} block" data-p="done">${copy.status === 'done' ? '✓ Copie corrigée' : 'Marquer comme corrigée'}</button>
        ${nextId ? `<button class="btn block" data-p="next">Étudiant suivant →</button>` : ''}
        ${copy.pdf ? `<button class="btn ghost block" data-p="adddoc">📎 Ajouter un document</button>` : ''}
        <button class="btn ghost block" data-p="pdf">⬇ Télécharger le PDF corrigé</button>
      </div>`;
    const ta = $('#comment', panel);
    ta.addEventListener('input', () => {
      copy.comment = ta.value;
      changed();
    });
    attachDictation($('#cmic', panel), ta);
    $$('input.num', panel).forEach(inp =>
      inp.addEventListener('change', () => {
        setScore(inp.dataset.c, parseNum(inp.value));
      })
    );
  }
  function setScore(cid, v) {
    const c = assignment.grid.criteria.find(x => x.id === cid);
    if (v != null) v = Math.min(+c.max, Math.max(0, v));
    if (v == null) delete copy.evaluation[cid];
    else copy.evaluation[cid] = v;
    renderPanel();
    changed();
  }
  panel.addEventListener('click', async e => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const cid = b.dataset.c;
    switch (b.dataset.p) {
      case 'fold': {
        // plier / déplier une partie du panneau (mémorisé d'une copie à l'autre)
        prefs.fold = { ...(prefs.fold || {}), [b.dataset.k]: !(prefs.fold || {})[b.dataset.k] };
        savePrefs();
        renderPanel();
        if (b.dataset.k === 'comment' && !prefs.fold.comment) $('#comment', panel).focus({ preventScroll: true });
        return;
      }
      case 'grid':
        return ctx.editGrid();
      case 'minus':
      case 'plus': {
        const cur = copy.evaluation[cid];
        const c = assignment.grid.criteria.find(x => x.id === cid);
        const step = +c.max <= 2 ? 0.25 : 0.5;
        const base = cur == null ? (b.dataset.p === 'plus' ? 0 : +c.max) : cur + (b.dataset.p === 'plus' ? step : -step);
        return setScore(cid, base);
      }
      case 'full':
        return setScore(cid, +assignment.grid.criteria.find(x => x.id === cid).max);
      case 'lvl': {
        const l = +b.dataset.l;
        if (copy.evaluation[cid] === l) delete copy.evaluation[cid];
        else copy.evaluation[cid] = l;
        renderPanel();
        return changed();
      }
      case 'done': {
        if (copy.status !== 'done') {
          const r = computeResult(assignment.grid, copy.evaluation);
          if (!r.complete) {
            const ok = await modal({
              title: 'Grille incomplète',
              body: '<p>Certains critères ne sont pas remplis. Marquer quand même la copie comme corrigée ?</p>',
              actions: [
                { label: 'Annuler', value: false },
                { label: 'Oui, corrigée', value: true, cls: 'primary' },
              ],
            });
            if (!ok) return;
          }
          copy.status = 'done';
          copy.correctedAt = Date.now();
          toast('Copie marquée comme corrigée ✓', 'success');
        } else {
          copy.status = 'todo';
        }
        renderPanel();
        changed();
        await ctx.save(copy);
        if (copy.status === 'done') ctx.onDone && ctx.onDone();
        return;
      }
      case 'next':
        return ctx.goto(nextId);
      case 'adddoc':
        await ctx.save(copy);
        return ctx.importPdf(true);
      case 'pdf': {
        b.disabled = true;
        try {
          await ctx.save(copy);
          const bytes = await buildCorrectedPdf({ copy, student, assignment, cls: ctx.cls, settings });
          download(new Blob([bytes], { type: 'application/pdf' }), correctedFileName(student, assignment));
        } catch (err) {
          console.error(err);
          toast('Erreur lors de la création du PDF : ' + err.message, 'error');
        }
        b.disabled = false;
        return;
      }
    }
  });

  // ---------- Démarrage ----------
  renderToolbar();
  renderPanel();
  relayout();
  const ro = new ResizeObserver(() => {
    if (!pinch) relayout();
  });
  ro.observe(scroll);

  const onKey = e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') doUndo();
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') doRedo();
  };
  document.addEventListener('keydown', onKey);

  return async function destroy() {
    destroyed = true;
    life.abort();
    ro.disconnect();
    document.removeEventListener('keydown', onKey);
    clearTimeout(saveTimer);
    await ctx.save(copy);
    if (pdf) pdf.destroy();
  };
}
