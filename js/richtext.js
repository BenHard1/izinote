// Mise en forme simple et correcteur d'orthographe des zones de texte (commentaires, consignes, mails).
//
// Mise en forme : le texte reste un texte simple, avec des repères posés par les boutons de la barre :
//   **gras**   *italique*   __souligné__   « • » en début de ligne : liste à puces   « 1. » : liste numérotée.
// Les mails partent avec une version mise en forme (HTML) et une version texte propre (sans repères) ;
// la fiche PDF dessine le gras, l'italique, le soulignement et les listes.
//
// Correcteur : LanguageTool (service gratuit de correction automatique du français). Le texte est envoyé
// à LanguageTool pendant la vérification, puis les fautes sont proposées sous la zone : un clic corrige.
import { esc } from './util.js';

// ---------- Lecture des repères ----------
const LIST_RE = /^(\s*)(?:([•\-–*])\s+|(\d{1,2})[.)]\s+)(.*)$/;
// découpe une ligne en morceaux { t, b, i, u }
export function runs(line) {
  const out = [];
  let b = false,
    i = false,
    u = false,
    buf = '';
  const push = () => buf && (out.push({ t: buf, b, i, u }), (buf = ''));
  const s = String(line || '');
  for (let k = 0; k < s.length; k++) {
    const two = s.slice(k, k + 2);
    if (two === '**' && (b || s.indexOf('**', k + 2) > k + 2)) {
      push();
      b = !b;
      k++;
      continue;
    }
    if (two === '__' && (u || s.indexOf('__', k + 2) > k + 2)) {
      push();
      u = !u;
      k++;
      continue;
    }
    // italique : *mot* (pas « 5 * 3 » ni une puce)
    if (s[k] === '*' && s[k + 1] !== '*' && s[k - 1] !== '*') {
      if (i && s[k - 1] !== ' ') {
        push();
        i = false;
        continue;
      }
      if (!i && s[k + 1] && s[k + 1] !== ' ' && !/\w/.test(s[k - 1] || '') && /[^*\s]\*(?!\*)/.test(s.slice(k + 1))) {
        push();
        i = true;
        continue;
      }
    }
    buf += s[k];
  }
  push();
  return out;
}
export const hasFormatting = text => /\*\*[^*\n]+\*\*|__[^_\n]+__|(^|[^\w*])\*[^*\s][^*\n]*\*(?!\w)/.test(text || '') || /^\s*(?:[•–]\s|\d{1,2}[.)]\s)/m.test(text || '');

// Lignes structurées : { kind: 'p' | 'ul' | 'ol', n, runs }
export function blocks(text) {
  return String(text || '')
    .split('\n')
    .map(l => {
      const m = l.match(LIST_RE);
      if (m && (m[2] !== '*' || /\s/.test(l.slice(m[1].length + 1, m[1].length + 2)))) return { kind: m[3] ? 'ol' : 'ul', n: m[3] ? +m[3] : null, runs: runs(m[4]) };
      return { kind: 'p', runs: runs(l) };
    });
}

// Version texte des mails : sans repères (les puces deviennent « • »)
export function toPlain(text) {
  return blocks(text)
    .map(bl => (bl.kind === 'ul' ? '• ' : bl.kind === 'ol' ? bl.n + '. ' : '') + bl.runs.map(r => r.t).join(''))
    .join('\n');
}

const runsHtml = rs =>
  rs
    .map(r => {
      let h = esc(r.t);
      if (r.u) h = `<u>${h}</u>`;
      if (r.i) h = `<i>${h}</i>`;
      if (r.b) h = `<b>${h}</b>`;
      return h;
    })
    .join('');
// Version HTML (mails et aperçus)
export function toHtml(text) {
  const out = [];
  let list = null;
  const close = () => list && (out.push(`</${list}>`), (list = null));
  for (const bl of blocks(text)) {
    if (bl.kind === 'p') {
      close();
      out.push(bl.runs.length ? runsHtml(bl.runs) + '<br>' : '<br>');
    } else {
      if (list !== bl.kind) {
        close();
        list = bl.kind;
        out.push(bl.kind === 'ol' ? `<ol start="${bl.n || 1}" style="margin:4px 0;padding-left:24px">` : '<ul style="margin:4px 0;padding-left:24px">');
      }
      out.push(`<li>${runsHtml(bl.runs)}</li>`);
    }
  }
  close();
  return out.join('').replace(/(<br>)+$/, '');
}
export const mailHtml = text => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#141414">${toHtml(text)}</div>`;

// ---------- Barre d'outils ----------
const PREF = 'izinote.spell';
const spellOn = () => {
  try {
    return localStorage.getItem(PREF) !== 'off';
  } catch {
    return true;
  }
};
const fire = ta => ta.dispatchEvent(new Event('input', { bubbles: true }));

function wrapSel(ta, mark) {
  const { selectionStart: a, selectionEnd: b, value: v } = ta;
  if (a === b) {
    // pas de sélection : on pose les repères et on écrit entre les deux
    ta.setRangeText(mark + mark, a, b, 'end');
    ta.setSelectionRange(a + mark.length, a + mark.length);
  } else {
    const sel = v.slice(a, b);
    // déjà mis en forme : on enlève
    if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length > 2 * mark.length) ta.setRangeText(sel.slice(mark.length, -mark.length), a, b, 'select');
    else if (v.slice(a - mark.length, a) === mark && v.slice(b, b + mark.length) === mark) {
      ta.setRangeText(sel, a - mark.length, b + mark.length, 'select');
    } else {
      // les espaces au bord de la sélection restent hors des repères
      const lead = sel.match(/^\s*/)[0],
        trail = sel.match(/\s*$/)[0];
      ta.setRangeText(lead + mark + sel.trim() + mark + trail, a, b, 'select');
    }
  }
  ta.focus();
  fire(ta);
}
function listSel(ta, numbered) {
  const v = ta.value;
  const a = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let b = v.indexOf('\n', ta.selectionEnd);
  if (b < 0) b = v.length;
  const lines = v.slice(a, b).split('\n');
  const already = lines.every(l => !l.trim() || (numbered ? /^\s*\d{1,2}[.)]\s/.test(l) : /^\s*[•\-–]\s/.test(l)));
  let n = 0;
  const out = lines.map(l => {
    const bare = l.replace(/^\s*(?:[•\-–]|\d{1,2}[.)])\s+/, '');
    if (already) return bare;
    if (!l.trim() && lines.length > 1) return l;
    return (numbered ? `${++n}. ` : '• ') + bare;
  });
  ta.setRangeText(out.join('\n'), a, b, 'end');
  ta.focus();
  fire(ta);
}

// Ajoute la barre (gras, italique, souligné, listes, orthographe) au-dessus d'une zone de texte.
// Sans effet si elle est déjà là.
export function attachTextTools(ta, { spell = true, format = true } = {}) {
  if (!ta || ta.dataset.tools) return;
  ta.dataset.tools = '1';
  const bar = document.createElement('div');
  bar.className = 'fmt-bar';
  bar.innerHTML = `${
    format
      ? `<button type="button" data-f="b" title="Gras"><b>G</b></button><button type="button" data-f="i" title="Italique"><i>I</i></button><button type="button" data-f="u" title="Souligné"><u>S</u></button>
    <button type="button" data-f="ul" title="Liste à puces">• Liste</button><button type="button" data-f="ol" title="Liste numérotée">1. Liste</button><span class="fmt-sep"></span>`
      : ''
  }
    ${spell ? `<button type="button" data-f="spell" title="Vérifier l’orthographe">✓ Orthographe</button><label class="fmt-auto" title="Vérifier pendant que vous écrivez"><input type="checkbox" ${spellOn() ? 'checked' : ''}> auto</label>` : ''}`;
  // la barre se place au-dessus du bloc (zone + micro)
  const host = ta.closest('.dictate-wrap') || ta;
  host.insertAdjacentElement('beforebegin', bar);
  const below = document.createElement('div');
  below.className = 'fmt-below';
  host.insertAdjacentElement('afterend', below);
  // les boutons ne prennent pas le focus : la sélection du texte est gardée
  bar.addEventListener('mousedown', e => e.target.closest('button') && e.preventDefault());
  bar.addEventListener('click', e => {
    const f = e.target.closest('button')?.dataset.f;
    if (!f) return;
    if (f === 'b') wrapSel(ta, '**');
    else if (f === 'i') wrapSel(ta, '*');
    else if (f === 'u') wrapSel(ta, '__');
    else if (f === 'ul') listSel(ta, false);
    else if (f === 'ol') listSel(ta, true);
    else if (f === 'spell') check(true);
  });
  const auto = bar.querySelector('.fmt-auto input');
  if (auto)
    auto.onchange = () => {
      try {
        localStorage.setItem(PREF, auto.checked ? 'on' : 'off');
      } catch {}
      if (auto.checked) check(false);
      else spellBox.innerHTML = '';
    };

  // Aperçu de la mise en forme (seulement s'il y a des repères)
  const prev = document.createElement('div');
  prev.className = 'fmt-preview';
  const spellBox = document.createElement('div');
  spellBox.className = 'spell-box';
  below.append(spellBox, prev);
  const preview = () => {
    const on = hasFormatting(ta.value);
    prev.hidden = !on;
    if (on) prev.innerHTML = `<small class="muted">Aperçu</small><div>${toHtml(ta.value)}</div>`;
  };
  preview();

  // ---------- Orthographe ----------
  let timer = null,
    seq = 0,
    lastChecked = null;
  const check = async manual => {
    clearTimeout(timer);
    const text = ta.value;
    if (!text.trim()) return (spellBox.innerHTML = manual ? '<span class="muted small">Rien à vérifier.</span>' : '');
    if (!manual && text === lastChecked) return;
    const my = ++seq;
    if (manual) spellBox.innerHTML = '<span class="muted small">Vérification…</span>';
    let matches;
    try {
      matches = await spellCheck(text);
    } catch (e) {
      if (my === seq && manual) spellBox.innerHTML = `<span class="muted small">Correcteur indisponible${navigator.onLine === false ? ' (pas d’internet)' : ''}.</span>`;
      return;
    }
    if (my !== seq || ta.value !== text) return; // le texte a changé entre-temps
    lastChecked = text;
    render(matches, manual);
  };
  const render = (matches, manual) => {
    const fixes = matches.filter(m => m.replacements && m.replacements.length);
    if (!fixes.length) {
      spellBox.innerHTML = matches.length || manual ? '<span class="spell-ok small">✓ Aucune faute trouvée</span>' : '';
      return;
    }
    spellBox.innerHTML = `<span class="small"><b>✎ ${fixes.length} correction${fixes.length > 1 ? 's' : ''} proposée${fixes.length > 1 ? 's' : ''}</b></span>
      ${fixes
        .slice(0, 12)
        .map(
          (m, k) =>
            `<button type="button" class="spell-fix" data-k="${k}" title="${esc(m.message || '')}"><s>${esc(ta.value.substr(m.offset, m.length))}</s> → <b>${esc(m.replacements[0].value)}</b></button>`
        )
        .join('')}
      ${fixes.length > 1 ? '<button type="button" class="linkbtn small" data-all="1">Tout corriger</button>' : ''}
      <button type="button" class="linkbtn small" data-x="1">Ignorer</button>`;
    const apply = list => {
      // de la fin vers le début, pour garder les positions ; on vérifie que le mot n'a pas changé
      let v = ta.value;
      for (const m of [...list].sort((x, y) => y.offset - x.offset)) {
        if (v.substr(m.offset, m.length) !== m.original) continue;
        v = v.slice(0, m.offset) + m.replacements[0].value + v.slice(m.offset + m.length);
      }
      ta.value = v;
      fire(ta);
      check(true);
    };
    fixes.forEach(m => (m.original = ta.value.substr(m.offset, m.length)));
    spellBox.querySelectorAll('[data-k]').forEach(b => (b.onclick = () => apply([fixes[+b.dataset.k]])));
    const all = spellBox.querySelector('[data-all]');
    if (all) all.onclick = () => apply(fixes);
    spellBox.querySelector('[data-x]').onclick = () => (spellBox.innerHTML = '');
  };
  ta.addEventListener('input', () => {
    preview();
    clearTimeout(timer);
    if (spell && spellOn()) timer = setTimeout(() => check(false), 1800);
  });
  // texte dicté ou collé, sans frappe : on vérifie aussi en quittant la zone
  ta.addEventListener('blur', () => spell && spellOn() && setTimeout(() => check(false), 200));
}

// Appel à LanguageTool. Les repères de mise en forme sont signalés comme « balisage » pour ne pas être pris pour des fautes.
const LT = 'https://api.languagetool.org/v2/check';
export async function spellCheck(text) {
  const annotation = [];
  // repères de mise en forme et champs {prenom}… : ignorés par le correcteur
  for (const part of String(text).split(/(\*\*|__|\*|\{\w+\})/)) if (part) annotation.push(/^(\*\*|__|\*|\{\w+\})$/.test(part) ? { markup: part } : { text: part });
  const body = new URLSearchParams({ data: JSON.stringify({ annotation }), language: 'fr', level: 'default' });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(LT, { method: 'POST', body, signal: ctl.signal });
    if (!res.ok) throw new Error('LanguageTool ' + res.status);
    const data = await res.json();
    // on ignore les remarques de style sans correction et les espaces avant « : » (usage français variable)
    return (data.matches || []).filter(m => m.rule?.issueType !== 'whitespace' || (m.replacements || []).length);
  } finally {
    clearTimeout(t);
  }
}
