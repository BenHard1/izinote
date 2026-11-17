// Chronomètre des oraux et travaux de groupe : une petite fenêtre flottante qui reste affichée
// quand on passe d'un élève (ou d'un groupe) à l'autre. Il compte le temps écoulé : démarrer,
// pause, remise à zéro, et « Tour » pour noter le temps de chaque passage.
let el = null;
let running = false;
let startAt = 0; // moment du dernier démarrage
let acc = 0; // temps accumulé avant ce démarrage (ms)
let laps = [];
let tick = null;
let small = false;

const elapsed = () => acc + (running ? Date.now() - startAt : 0);
const fmt = ms => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    r = s % 60;
  return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(r).padStart(2, '0')}`;
};

function update() {
  if (!el) return;
  el.querySelector('.tm-time').textContent = fmt(elapsed());
  el.classList.toggle('running', running);
  const go = el.querySelector('[data-t=go]');
  go.textContent = running ? '⏸' : '▶';
  go.title = running ? 'Pause' : elapsed() ? 'Reprendre' : 'Démarrer';
}

function start() {
  startAt = Date.now();
  running = true;
  clearInterval(tick);
  tick = setInterval(update, 250);
  update();
}
function pause() {
  acc = elapsed();
  running = false;
  clearInterval(tick);
  update();
}
function reset() {
  running = false;
  clearInterval(tick);
  acc = 0;
  laps = [];
  render();
}
function lap() {
  const t = elapsed();
  if (!t) return;
  const prev = laps.length ? laps[laps.length - 1].total : 0;
  laps.push({ total: t, part: t - prev });
  render();
}

function render() {
  el.innerHTML = `<div class="tm-head"><span class="tm-time"></span>
      <button type="button" data-t="go" class="tm-btn primary">▶</button>
      <button type="button" data-t="lap" class="tm-btn" title="Tour : noter le temps de ce passage">⚑</button>
      <button type="button" data-t="reset" class="tm-btn" title="Remettre à zéro">↺</button>
      <button type="button" data-t="min" class="tm-btn" title="${small ? 'Agrandir' : 'Réduire'}">${small ? '▴' : '▾'}</button>
      <button type="button" data-t="close" class="tm-btn" title="Fermer le chronomètre">✕</button></div>
    ${
      small || !laps.length
        ? ''
        : `<ol class="tm-laps">${laps
            .map((l, i) => `<li><span>Passage ${i + 1}</span><b>${fmt(l.part)}</b></li>`)
            .reverse()
            .join('')}</ol>`
    }`;
  el.classList.toggle('small', small);
  update();
}

export function openTimer() {
  if (el) {
    el.classList.add('pulse');
    setTimeout(() => el && el.classList.remove('pulse'), 600);
    return;
  }
  el = document.createElement('div');
  el.className = 'timer-box';
  el.setAttribute('role', 'timer');
  el.setAttribute('aria-label', 'Chronomètre');
  document.body.appendChild(el);
  render();
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const t = b.dataset.t;
    if (t === 'go') return running ? pause() : start();
    if (t === 'lap') return lap();
    if (t === 'reset') return reset();
    if (t === 'min') return (small = !small), render();
    if (t === 'close') {
      pause();
      el.remove();
      el = null;
    }
  });
}
