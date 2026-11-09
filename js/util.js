// Petits outils partagés : échappement HTML, fenêtres, dictée vocale, calcul des notes.

export const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const fmtNum = n => {
  if (n == null || isNaN(n)) return '–';
  return (Math.round(n * 100) / 100).toString().replace('.', ',');
};
export const parseNum = s => {
  if (s === '' || s == null) return null;
  const n = parseFloat(String(s).replace(',', '.'));
  return isNaN(n) ? null : n;
};
export const fmtDate = ts => (ts ? new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export const studentName = s => [s.firstName, s.lastName].filter(Boolean).join(' ') || 'Sans nom';

export function normalize(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// ---------- Toast ----------
export function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, type === 'error' ? 5000 : 2600);
}

// ---------- Écran d'attente (bonhomme animé) ----------
// const b = busy('Conversion…'); b.set('Page 2…'); b.done();
export function busy(msg = 'Un instant…') {
  const w = document.createElement('div');
  w.className = 'busy-wrap';
  w.innerHTML = `<div class="busy"><img src="assets/chargement.gif" alt=""><p></p></div>`;
  const p = w.querySelector('p');
  p.textContent = msg;
  document.body.appendChild(w);
  requestAnimationFrame(() => w.classList.add('show'));
  return {
    set: m => (p.textContent = m),
    done: () => w.remove(),
  };
}

// ---------- Fenêtre modale ----------
// actions: [{label, value, cls}] ; renvoie la valeur du bouton cliqué (ou null si fermé).
// onOpen(root, close) permet de brancher des événements ; validate(value, root) peut empêcher la fermeture.
export function modal({ title, body = '', actions = [{ label: 'OK', value: true, cls: 'primary' }], onOpen, validate, wide }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn close" aria-label="Fermer">✕</button></div>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">${actions
          .map((a, i) => `<button class="btn ${a.cls || ''}" data-i="${i}">${esc(a.label)}</button>`)
          .join('')}</div>
      </div>`;
    document.body.appendChild(wrap);
    const close = v => {
      wrap.remove();
      resolve(v);
    };
    wrap.querySelector('.close').onclick = () => close(null);
    wrap.addEventListener('pointerdown', e => {
      if (e.target === wrap) wrap.dataset.down = '1';
    });
    wrap.addEventListener('click', e => {
      if (e.target === wrap && wrap.dataset.down) close(null);
      delete wrap.dataset.down;
    });
    wrap.querySelectorAll('.modal-actions .btn').forEach(b => {
      b.onclick = async () => {
        const a = actions[+b.dataset.i];
        if (validate && a.value && !(await validate(a.value, wrap))) return;
        close(a.value);
      };
    });
    onOpen && onOpen(wrap, close);
    const first = wrap.querySelector('input:not([type=checkbox]):not([type=file]), textarea, select');
    if (first) setTimeout(() => !wrap.contains(document.activeElement) && first.focus(), 50);
  });
}

export async function confirmBox(title, text, okLabel = 'Confirmer', danger = false) {
  return (
    (await modal({
      title,
      body: `<p>${esc(text)}</p>`,
      actions: [
        { label: 'Annuler', value: false },
        { label: okLabel, value: true, cls: danger ? 'danger' : 'primary' },
      ],
    })) === true
  );
}

// Confirmation forte : il faut retaper le nom.
export async function confirmTyped(title, text, expected) {
  return (
    (await modal({
      title,
      body: `<p>${esc(text)}</p><p>Pour confirmer, tapez <b>${esc(expected)}</b> :</p><input class="input" id="typed" autocomplete="off">`,
      actions: [
        { label: 'Annuler', value: false },
        { label: 'Supprimer définitivement', value: true, cls: 'danger' },
      ],
      validate: (v, root) => {
        const ok = normalize(root.querySelector('#typed').value.trim()) === normalize(expected.trim());
        if (!ok) toast('Le nom ne correspond pas.', 'error');
        return ok;
      },
    })) === true
  );
}

// Formulaire simple : fields = [{name, label, value, type, placeholder, required}]
export async function form(title, fields, okLabel = 'Enregistrer') {
  let values = null;
  const body = fields
    .map(
      f => `<label class="field"><span>${esc(f.label)}</span>${
        f.type === 'textarea'
          ? `<textarea class="input" name="${f.name}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`
          : f.type === 'select'
          ? `<select class="input" name="${f.name}">${f.options.map(o => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
          : `<input class="input" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.type === 'email' ? 'inputmode="email" autocapitalize="off"' : ''} ${f.datalist ? `list="dl-${f.name}"` : ''}>${
              f.datalist ? `<datalist id="dl-${f.name}">${f.datalist.map(v => `<option value="${esc(v)}">`).join('')}</datalist>` : ''
            }`
      }${f.help ? `<small class="muted">${esc(f.help)}</small>` : ''}</label>`
    )
    .join('');
  const r = await modal({
    title,
    body: `<form onsubmit="return false">${body}</form>`,
    actions: [
      { label: 'Annuler', value: false },
      { label: okLabel, value: true, cls: 'primary' },
    ],
    validate: (v, root) => {
      values = {};
      for (const f of fields) {
        values[f.name] = root.querySelector(`[name="${f.name}"]`).value.trim();
        if (f.required && !values[f.name]) {
          toast(`« ${f.label} » est obligatoire.`, 'error');
          return false;
        }
      }
      return true;
    },
    onOpen: (root, close) => {
      root.querySelectorAll('input').forEach(i =>
        i.addEventListener('keydown', e => {
          if (e.key === 'Enter') root.querySelector('.modal-actions .primary').click();
        })
      );
    },
  });
  return r ? values : null;
}

export function pickFiles({ accept = 'application/pdf', multiple = false, capture = false } = {}) {
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.multiple = multiple;
    if (capture) i.setAttribute('capture', 'environment');
    i.onchange = () => resolve([...i.files]);
    i.click();
  });
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export const safeFileName = s =>
  normalize(s).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'document';

// ---------- Dictée vocale (Web Speech API de Chrome, gratuite) ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const speechSupported = !!SR;
let active = null;

// Pendant la dictée, on empêche l'écran de se mettre en veille (et la tablette de se verrouiller) :
// parler ne compte pas comme une utilisation de l'écran pour Android.
let wakeLock = null;
async function keepAwake(on) {
  if (!('wakeLock' in navigator)) return;
  try {
    if (on && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!on && wakeLock) {
      const w = wakeLock;
      wakeLock = null;
      await w.release();
    }
  } catch (e) {
    console.warn('Mise en veille non bloquée :', e.message);
  }
}
// le verrou saute quand l'appli passe en arrière-plan : on le reprend au retour si la dictée continue
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && active) keepAwake(true);
});

// Branche un bouton micro sur une zone de texte. Le texte dicté est ajouté à la fin.
export function attachDictation(button, textarea, onChange) {
  if (!SR) {
    button.disabled = true;
    button.title = "La dictée n'est pas disponible dans ce navigateur (utilisez Chrome).";
    return;
  }
  button.addEventListener('click', () => {
    if (active && active.button === button) return active.stop();
    if (active) active.stop();
    start();
  });

  function start() {
    let stopped = false;
    let rec = null;
    const base = () => textarea.value;
    const interim = document.createElement('div');
    interim.className = 'interim';
    textarea.insertAdjacentElement('afterend', interim);

    const run = () => {
      rec = new SR();
      rec.lang = 'fr-FR';
      rec.interimResults = true;
      rec.continuous = false; // plus fiable sur Android : on relance à chaque pause
      rec.onresult = e => {
        let fin = '',
          tmp = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) fin += r[0].transcript;
          else tmp += r[0].transcript;
        }
        interim.textContent = tmp ? '🎙 ' + tmp : '';
        if (fin) {
          fin = punctuate(fin.trim());
          const cur = base();
          const sep = !cur || /[\s\n]$/.test(cur) ? '' : ' ';
          textarea.value = cur + sep + capitalizeIfNeeded(cur, fin);
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          onChange && onChange(textarea.value);
        }
      };
      rec.onerror = e => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          toast("Accès au micro refusé. Autorisez le micro pour ce site dans Chrome.", 'error');
          stop();
        } else if (e.error === 'network') {
          toast('La dictée nécessite une connexion internet.', 'error');
          stop();
        }
      };
      rec.onend = () => {
        // écran quitté (copie suivante…) : on arrête la dictée et on rend la mise en veille
        if (!stopped && !button.isConnected) return stop();
        if (!stopped) {
          try {
            run();
          } catch {
            stop();
          }
        }
      };
      rec.start();
    };
    const stop = () => {
      stopped = true;
      try {
        rec && rec.stop();
      } catch {}
      button.classList.remove('rec');
      interim.remove();
      if (active && active.button === button) {
        active = null;
        keepAwake(false);
      }
    };
    active = { button, stop };
    button.classList.add('rec');
    keepAwake(true);
    run();
  }
}

// Mots dictés « virgule », « point », « à la ligne » transformés en ponctuation.
function punctuate(t) {
  return t
    .replace(/\s*\bvirgule\b/gi, ',')
    .replace(/\s*\bpoint d'interrogation\b/gi, ' ?')
    .replace(/\s*\bpoint d'exclamation\b/gi, ' !')
    .replace(/\s*\bdeux points\b/gi, ' :')
    .replace(/\s*\bpoint à la ligne\b\s*/gi, '.\n')
    .replace(/\s*\b(à la ligne|nouvelle ligne)\b\s*/gi, '\n')
    .replace(/\s*\bpoint\b(?!\s*(de|d'))/gi, '.');
}
function capitalizeIfNeeded(prev, t) {
  if (!prev.trim() || /[.!?\n]\s*$/.test(prev)) return t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

// ---------- Grilles d'évaluation ----------
export const DEFAULT_LEVELS = ['Non acquis', "En cours d'acquisition", 'Acquis'];

export function newGrid(mode = 'note') {
  return {
    mode,
    scaleTo: mode === 'note' ? 20 : null,
    levels: [...DEFAULT_LEVELS],
    criteria: [],
  };
}

// Malus cochés pour une copie (evaluation[id du malus] = true).
export function appliedMalus(grid, evaluation = {}) {
  return ((grid && grid.mode === 'note' && grid.maluses) || []).filter(m => evaluation && evaluation[m.id]);
}

// Résultat d'une évaluation : { complete, total, max, scaled, text, short }
export function computeResult(grid, evaluation = {}) {
  if (!grid || !grid.criteria || !grid.criteria.length) return { complete: true, short: '', lines: [] };
  const lines = [];
  if (grid.mode === 'note') {
    let total = 0,
      max = 0,
      complete = true;
    for (const c of grid.criteria) {
      const v = evaluation[c.id];
      max += +c.max || 0;
      if (v == null) complete = false;
      else total += v;
      lines.push({ label: c.label, value: v == null ? '–' : `${fmtNum(v)} / ${fmtNum(c.max)}` });
    }
    let scaled = grid.scaleTo && max ? (total / max) * grid.scaleTo : null;
    // Malus (ex. « Excès d'IA : −1 ») : retirés de la note finale (sur 20 si la note est ramenée sur 20).
    const malus = appliedMalus(grid, evaluation);
    const minus = malus.reduce((t, m) => t + (+m.pts || 0), 0);
    for (const m of malus) lines.push({ label: m.label, value: `− ${fmtNum(+m.pts || 0)}`, malus: true });
    // Participation individuelle (travail de groupe) : points en plus ou en moins pour un élève.
    const part = +(evaluation && evaluation._part) || 0;
    if (part) lines.push({ label: 'Participation individuelle', value: `${part > 0 ? '+' : '−'} ${fmtNum(Math.abs(part))}` });
    const rawTotal = total;
    if (minus || part) {
      const top = scaled != null ? +grid.scaleTo : max;
      if (scaled != null) scaled = Math.min(top, Math.max(0, scaled - minus + part));
      else total = Math.min(top, Math.max(0, total - minus + part));
    }
    const short = scaled != null ? `${fmtNum(scaled)}/${grid.scaleTo}` : `${fmtNum(total)}/${fmtNum(max)}`;
    const extras = [minus ? `malus − ${fmtNum(minus)}` : '', part ? `participation ${part > 0 ? '+' : '−'} ${fmtNum(Math.abs(part))}` : ''].filter(Boolean).join(', ');
    const detail = extras ? `${fmtNum(rawTotal)} / ${fmtNum(max)} points, ${extras}` : `${fmtNum(total)} / ${fmtNum(max)} points`;
    const totalLine =
      scaled != null && (max !== grid.scaleTo || extras)
        ? `Note : ${fmtNum(scaled)} / ${grid.scaleTo} (${detail})`
        : scaled != null
        ? `Note : ${fmtNum(scaled)} / ${grid.scaleTo}`
        : `Note : ${fmtNum(total)} / ${fmtNum(max)}${extras ? ` (${extras})` : ''}`;
    return { complete, total, max, scaled, short, lines, totalLine, minus, part };
  } else {
    const levels = grid.levels && grid.levels.length ? grid.levels : DEFAULT_LEVELS;
    let complete = true,
      acquired = 0;
    for (const c of grid.criteria) {
      const v = evaluation[c.id];
      if (v == null) complete = false;
      else if (v === levels.length - 1) acquired++;
      lines.push({ label: c.label, value: v == null ? '–' : levels[v] });
    }
    const short = `${acquired}/${grid.criteria.length} acquis`;
    return { complete, short, lines, totalLine: `Compétences acquises : ${acquired} / ${grid.criteria.length}` };
  }
}

export function resultText(grid, evaluation) {
  const r = computeResult(grid, evaluation);
  if (!r.lines.length) return '';
  return ['Évaluation :', ...r.lines.map(l => `- ${l.label} : ${l.value}`), r.totalLine].join('\n');
}

// Note ramenée sur 20 (grilles en points seulement), ou null.
export function noteOn20(grid, evaluation = {}) {
  if (!grid || grid.mode !== 'note' || !grid.criteria || !grid.criteria.length) return null;
  const r = computeResult(grid, evaluation);
  if (!r.max || !Object.keys(evaluation || {}).some(k => grid.criteria.some(c => c.id === k))) return null;
  if (r.scaled != null) return (r.scaled / grid.scaleTo) * 20;
  return (r.total / r.max) * 20;
}

// Valeur affichée dans un tableur : nombre (note) ou texte (acquis).
export function resultCell(grid, evaluation = {}) {
  if (!grid || !grid.criteria || !grid.criteria.length) return '';
  const r = computeResult(grid, evaluation);
  if (grid.mode === 'note') {
    if (!Object.keys(evaluation || {}).length) return '';
    const v = r.scaled != null ? r.scaled : r.total;
    return Math.round(v * 100) / 100;
  }
  return r.short;
}

export const KINDS = [
  { value: 'devoir', label: 'Devoir (copie PDF)' },
  { value: 'projet', label: 'Projet (copie PDF)' },
  { value: 'oral', label: 'Oral (sans copie)' },
  { value: 'groupe', label: 'Travail de groupe' },
];
export const kindLabel = k => ({ devoir: 'Devoir', projet: 'Projet', oral: 'Oral', groupe: 'Travail de groupe' })[k] || 'Devoir';

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Chargement impossible (connexion internet ?)'));
    document.head.appendChild(s);
  });
}

// Image (fichier ou URL) -> PNG en data URL, réduit à max px.
export function imageToDataUrl(src, max = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      try {
        resolve(c.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("Image introuvable"));
    img.src = src instanceof Blob ? URL.createObjectURL(src) : src;
  });
}

export const dateOf = a => (a.dueDate ? new Date(a.dueDate + 'T12:00:00') : new Date(a.createdAt || Date.now()));
export const shortDate = d => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
