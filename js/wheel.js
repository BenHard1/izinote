// Roue du hasard : choisit qui passe à l'oral (un groupe, ou un élève pour un oral individuel).
// Celui qui est tiré est retiré de la roue pour le tirage suivant. L'ordre de passage est gardé
// sur l'évaluation (a.passOrder = [id]) pour reprendre plus tard, même après avoir fermé la fenêtre.
import * as db from './db.js';
import { esc, $, modal, toast, studentName } from './util.js';

const COLORS = ['#ff7828', '#141414', '#e8b07a', '#a8490d', '#6b5f52', '#ffb27a', '#3d3229', '#d9661c'];

export async function wheelDialog(a, students, refresh) {
  const isGroup = a.kind === 'groupe';
  const all = isGroup
    ? (a.groups || []).map(g => ({ id: g.id, name: g.name + (g.title ? ' · ' + g.title : ''), sub: g.studentIds.map(id => students.find(s => s.id === id)).filter(Boolean).map(s => s.firstName || studentName(s)).join(', ') }))
    : students.map(s => ({ id: s.id, name: studentName(s), sub: '' }));
  if (all.length < 2) return toast(isGroup ? 'Créez au moins 2 groupes pour utiliser la roue.' : 'Il faut au moins 2 élèves.', 'error');
  let order = (a.passOrder || []).filter(id => all.some(x => x.id === id));
  const out = new Set(); // écartés pour cette séance (absents…)
  const left = () => all.filter(x => !order.includes(x.id) && !out.has(x.id));
  let angle = 0;
  let spinning = false;
  let last = null;
  const save = async () => {
    a.passOrder = order;
    await db.put('assignments', a);
  };

  await modal({
    title: `🎡 Ordre de passage – ${a.title}`,
    wide: true,
    body: `<div class="wheel-wrap">
      <div class="wheel-box"><canvas id="whCanvas" width="640" height="640"></canvas><div class="wheel-pin"></div></div>
      <div class="wheel-side">
        <div id="whResult" class="wheel-result muted">Touchez « Lancer la roue ».</div>
        <div class="row wrap"><button type="button" class="btn primary" id="whSpin">🎡 Lancer la roue</button></div>
        <div class="field"><span>Dans la roue <small class="muted">(touchez pour écarter un absent)</small></span><div id="whLeft" class="chips"></div></div>
        <div class="field"><span>Ordre de passage</span><ol id="whOrder" class="wheel-order"></ol>
          <button type="button" class="linkbtn" id="whReset">Tout remettre dans la roue</button></div>
      </div></div>`,
    actions: [{ label: 'Fermer', value: true, cls: 'primary' }],
    onOpen: w => {
      const cv = $('#whCanvas', w);
      const g = cv.getContext('2d');
      const draw = () => {
        const items = left();
        const R = cv.width / 2;
        g.clearRect(0, 0, cv.width, cv.height);
        if (!items.length) {
          g.fillStyle = '#efe4d3';
          g.beginPath();
          g.arc(R, R, R - 4, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#6b5f52';
          g.font = '600 34px Montserrat, sans-serif';
          g.textAlign = 'center';
          g.fillText('Tout le monde', R, R - 8);
          g.fillText('est passé ✓', R, R + 34);
          return;
        }
        const n = items.length;
        const step = (Math.PI * 2) / n;
        items.forEach((it, i) => {
          const a0 = angle + i * step;
          g.beginPath();
          g.moveTo(R, R);
          g.arc(R, R, R - 4, a0, a0 + step);
          g.closePath();
          // deux parts voisines jamais de la même couleur (y compris la dernière et la première)
          g.fillStyle = COLORS[i === n - 1 && n % COLORS.length === 1 ? 2 : i % COLORS.length];
          g.fill();
          g.strokeStyle = '#fffaf3';
          g.lineWidth = 3;
          g.stroke();
          g.save();
          g.translate(R, R);
          g.rotate(a0 + step / 2);
          g.textAlign = 'right';
          g.textBaseline = 'middle';
          const dark = ['#141414', '#a8490d', '#6b5f52', '#3d3229'].includes(g.fillStyle);
          g.fillStyle = dark ? '#fff' : '#141414';
          const fs = Math.max(16, Math.min(34, 260 / Math.max(6, it.name.length) + 8, step * R * 0.45));
          g.font = `700 ${fs}px Montserrat, sans-serif`;
          let label = it.name;
          while (g.measureText(label).width > R - 70 && label.length > 3) label = label.slice(0, -2) + '…';
          g.fillText(label, R - 24, 0);
          g.restore();
        });
        g.beginPath();
        g.arc(R, R, 34, 0, Math.PI * 2);
        g.fillStyle = '#fffaf3';
        g.fill();
      };
      // la flèche est en haut (angle -90°) : élément sous la flèche
      const pointed = () => {
        const items = left();
        const step = (Math.PI * 2) / items.length;
        const t = (((-Math.PI / 2 - angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        return items[Math.floor(t / step)];
      };
      const renderSide = () => {
        $('#whLeft', w).innerHTML = all
          .filter(x => !order.includes(x.id))
          .map(x => `<button type="button" class="chip ${out.has(x.id) ? 'off' : ''}" data-x="${x.id}" title="${out.has(x.id) ? 'Remettre dans la roue' : 'Écarter (absent)'}">${esc(x.name)}${x.sub ? ` <small>${esc(x.sub)}</small>` : ''}</button>`)
          .join('') || '<span class="muted small">Personne.</span>';
        $('#whOrder', w).innerHTML = order.map(id => all.find(x => x.id === id)).map(x => `<li>${esc(x.name)}${x.sub ? ` <small class="muted">${esc(x.sub)}</small>` : ''}</li>`).join('') || '<li class="muted">Personne n’est encore passé.</li>';
        const n = left().length;
        const btn = $('#whSpin', w);
        btn.disabled = spinning || !n;
        btn.textContent = n === 1 ? `▶ ${left()[0].name} passe en dernier` : order.length ? '🎡 Relancer sans les groupes passés' : '🎡 Lancer la roue';
        if (!isGroup && order.length && n > 1) btn.textContent = '🎡 Relancer sans les élèves passés';
        if (!n) btn.textContent = order.length ? 'Tout le monde est passé ✓' : 'Personne dans la roue';
        $$x('[data-x]').forEach(
          b =>
            (b.onclick = () => {
              if (spinning) return;
              if (out.has(b.dataset.x)) out.delete(b.dataset.x);
              else out.add(b.dataset.x);
              draw();
              renderSide();
            })
        );
      };
      const $$x = sel => [...w.querySelectorAll(sel)];
      const announce = it => {
        last = it;
        $('#whResult', w).className = 'wheel-result';
        $('#whResult', w).innerHTML = `<small>${order.length === 1 ? 'Passe en premier' : `Passe en ${order.length}ᵉ position`}</small><b>${esc(it.name)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}`;
      };
      $('#whSpin', w).onclick = async () => {
        const items = left();
        if (spinning || !items.length) return;
        if (items.length === 1) {
          order.push(items[0].id);
          announce(items[0]);
          await save();
          draw();
          return renderSide();
        }
        spinning = true;
        renderSide();
        $('#whResult', w).className = 'wheel-result muted';
        $('#whResult', w).textContent = 'La roue tourne…';
        const start = angle;
        const total = Math.PI * 2 * (5 + Math.random() * 3) + Math.random() * Math.PI * 2;
        const dur = 4200;
        const t0 = performance.now();
        await new Promise(res => {
          const tick = now => {
            const p = Math.min(1, (now - t0) / dur);
            angle = start + total * (1 - Math.pow(1 - p, 4)); // ralentit à la fin
            draw();
            if (p < 1) requestAnimationFrame(tick);
            else res();
          };
          requestAnimationFrame(tick);
        });
        const it = pointed();
        order.push(it.id);
        spinning = false;
        announce(it);
        await save();
        // le tiré quitte la roue après un court instant, pour qu'on voie où elle s'est arrêtée
        setTimeout(() => {
          draw();
          renderSide();
        }, 900);
        renderSide();
      };
      $('#whReset', w).onclick = async () => {
        if (spinning) return;
        order = [];
        out.clear();
        last = null;
        $('#whResult', w).className = 'wheel-result muted';
        $('#whResult', w).textContent = 'Touchez « Lancer la roue ».';
        await save();
        draw();
        renderSide();
      };
      draw();
      renderSide();
    },
  });
  refresh();
}
