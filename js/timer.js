// Minuteur des oraux et travaux de groupe : une petite fenêtre flottante qui reste affichée
// quand on passe d'un élève (ou d'un groupe) à l'autre. Compte à rebours avec durées rapides,
// passage en orange à la dernière minute, sonnerie et dépassement affiché (« +0:12 ») à la fin.
const PRESETS = [3, 5, 10, 15, 20];
const PREF = 'izinote.timer';
let el = null;
let dur = 5 * 60; // secondes
let left = dur;
let running = false;
let endAt = 0;
let tick = null;
let rang = false;
let small = false;

try {
  const p = JSON.parse(localStorage.getItem(PREF) || '{}');
  if (p.dur > 0) dur = left = p.dur;
} catch {}
const savePref = () => {
  try {
    localStorage.setItem(PREF, JSON.stringify({ dur }));
  } catch {}
};

const fmt = s => {
  const neg = s < 0;
  s = Math.abs(Math.round(s));
  const m = Math.floor(s / 60),
    r = s % 60;
  return `${neg ? '+' : ''}${m}:${String(r).padStart(2, '0')}`;
};

function beep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    [0, 0.35, 0.7].forEach(t => {
      const o = ac.createOscillator(),
        g = ac.createGain();
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.4, ac.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.28);
      o.start(ac.currentTime + t);
      o.stop(ac.currentTime + t + 0.3);
    });
    setTimeout(() => ac.close(), 1500);
  } catch {}
  try {
    navigator.vibrate && navigator.vibrate([300, 150, 300]);
  } catch {}
}

function update() {
  if (running) left = (endAt - Date.now()) / 1000;
  if (running && left <= 0 && !rang) {
    rang = true;
    beep();
  }
  if (!el) return;
  const t = el.querySelector('.tm-time');
  t.textContent = fmt(left > 0 ? Math.ceil(left) : left);
  el.classList.toggle('warn', left > 0 && left <= 60);
  el.classList.toggle('over', left <= 0);
  el.classList.toggle('running', running);
  el.querySelector('[data-t=go]').textContent = running ? '⏸' : '▶';
  el.querySelector('[data-t=go]').title = running ? 'Pause' : 'Démarrer';
  const bar = el.querySelector('.tm-bar span');
  bar.style.width = `${Math.max(0, Math.min(100, (left / dur) * 100))}%`;
}

function start() {
  if (left <= 0) reset();
  endAt = Date.now() + left * 1000;
  running = true;
  clearInterval(tick);
  tick = setInterval(update, 250);
  update();
}
function pause() {
  update();
  running = false;
  clearInterval(tick);
  update();
}
function reset() {
  running = false;
  clearInterval(tick);
  left = dur;
  rang = false;
  update();
}
function setDur(min) {
  dur = Math.max(1, Math.round(min * 60));
  savePref();
  reset();
}

function render() {
  el.innerHTML = `<div class="tm-head"><span class="tm-time"></span>
      <button type="button" data-t="go" class="tm-btn primary">▶</button>
      <button type="button" data-t="reset" class="tm-btn" title="Remettre à zéro">↺</button>
      <button type="button" data-t="min" class="tm-btn" title="${small ? 'Agrandir' : 'Réduire'}">${small ? '▴' : '▾'}</button>
      <button type="button" data-t="close" class="tm-btn" title="Fermer le minuteur">✕</button></div>
    <div class="tm-bar"><span></span></div>
    ${
      small
        ? ''
        : `<div class="tm-presets">${PRESETS.map(m => `<button type="button" data-m="${m}" class="${dur === m * 60 ? 'on' : ''}">${m} min</button>`).join('')}
      <label>autre <input type="number" min="1" max="180" step="1" inputmode="numeric" class="tm-custom" value="${PRESETS.includes(dur / 60) ? '' : Math.round(dur / 60)}" placeholder="min"></label></div>
      <div class="tm-quick"><button type="button" data-add="-60">− 1 min</button><button type="button" data-add="60">+ 1 min</button></div>`
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
  document.body.appendChild(el);
  render();
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.t === 'go') return running ? pause() : start();
    if (b.dataset.t === 'reset') return reset();
    if (b.dataset.t === 'min') return (small = !small), render();
    if (b.dataset.t === 'close') {
      pause();
      el.remove();
      el = null;
      return;
    }
    if (b.dataset.m) return setDur(+b.dataset.m), render();
    if (b.dataset.add) {
      const d = +b.dataset.add;
      if (running) endAt += d * 1000;
      else left += d;
      if (!running) left = Math.max(0, left);
      if (left > 0 || endAt > Date.now()) rang = false;
      return update();
    }
  });
  el.addEventListener('change', e => {
    if (e.target.matches('.tm-custom') && +e.target.value > 0) {
      setDur(+e.target.value);
      render();
    }
  });
}
