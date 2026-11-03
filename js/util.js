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
    if (first) setTimeout(() => first.focus(), 50);
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
          : `<input class="input" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.type === 'email' ? 'inputmode="email" autocapitalize="off"' : ''}>`
      }</label>`
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

export function pickFiles({ accept = 'application/pdf', multiple = false } = {}) {
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.multiple = multiple;
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
      if (active && active.button === button) active = null;
    };
    active = { button, stop };
    button.classList.add('rec');
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
    const scaled = grid.scaleTo && max ? (total / max) * grid.scaleTo : null;
    const short = scaled != null ? `${fmtNum(scaled)}/${grid.scaleTo}` : `${fmtNum(total)}/${fmtNum(max)}`;
    const totalLine = scaled != null && max !== grid.scaleTo ? `Note : ${fmtNum(scaled)} / ${grid.scaleTo} (${fmtNum(total)} / ${fmtNum(max)} points)` : scaled != null ? `Note : ${fmtNum(scaled)} / ${grid.scaleTo}` : `Note : ${fmtNum(total)} / ${fmtNum(max)}`;
    return { complete, total, max, scaled, short, lines, totalLine };
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
