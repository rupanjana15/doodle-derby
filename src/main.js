import * as THREE from 'three';
import { Track } from './track.js';
import { Car, PRESETS, TUNE_STATS, TUNE_POINTS, collideCars } from './car.js';
import { doodleCar, loadGLB, normaliseModel, EXTRAS } from './models.js';
import { Puffs } from './effects.js';
import { initSketchpad } from './sketchpad.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdcefff);
scene.fog = new THREE.Fog(0xdcefff, 160, 520);

scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cfb8, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 200 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const track = new Track(scene);
const puffs = new Puffs(scene, 160);

function resize() { renderer.setSize(innerWidth, innerHeight, false); }
addEventListener('resize', resize);
resize();

// ---------- settings ----------
const settings = { opponents: 3, laps: 3, difficulty: 'normal' };
const LIMITS = { opponents: [0, 7], laps: [1, 9] };
const DIFFICULTY = { easy: { label: 'Easy', skill: 0.8 }, normal: { label: 'Normal', skill: 0.9 }, hard: { label: 'Hard', skill: 0.99 } };
const PAINTS = [0x7bc96f, 0xffa94d, 0xb197fc, 0xff8fb1, 0xff5a36, 0x2f7cf6, 0xffd43b, 0x4fd1c5, 0x1d1b1a, 0xfbf7ee];

// ---------- garage roster ----------
// source 'doodle' = built-in placeholder, 'vi3w' = a .glb made with Vi3W.
const roster = [
  { name: 'Scribble GT', source: 'doodle', color: 0x7bc96f, shape: 'gt', preset: 'balanced' },
  { name: 'Crayon Truck', source: 'doodle', color: 0xffa94d, shape: 'truck', preset: 'heavy' },
  { name: 'Pencil Rocket', source: 'doodle', color: 0xb197fc, shape: 'rocket', preset: 'light' },
  { name: 'Marker Bubble', source: 'doodle', color: 0xff8fb1, shape: 'bubble', preset: 'drifty' },
];
let pendingSketch = null; // last sketch saved from the pad, attached to the next dropped .glb

async function modelFor(entry, paint) {
  if (entry.source === 'doodle') return doodleCar(paint ?? entry.color, entry.shape);
  if (!entry.raw) {
    $('loading').classList.remove('hidden');
    try { entry.raw = await loadGLB(entry.model); }
    finally { $('loading').classList.add('hidden'); }
  }
  const m = normaliseModel(entry.raw.clone(true), entry.turns);
  entry.turns = m.userData.turns;
  for (const name of entry.extras ?? []) EXTRAS[name]?.(m);
  return m;
}

// ---------- players ----------
// Each human has a car, a garage config, a chase camera and a HUD block.
const humans = [];
let editing = 0;

function buildHud(k) {
  const el = document.createElement('div');
  el.className = 'phud';
  el.id = `phud-${k}`;
  el.innerHTML = `
    <div class="hud-tl"><div class="lap">Lap 1/3</div><div class="time mono">0:00.00</div><div class="best mono small">Best —</div></div>
    <div class="hud-tr"><span class="pos">1</span><sup class="suf">st</sup><small class="of">/4</small></div>
    <div class="hud-speed"><span class="spd">0</span><small>km/h</small></div>
    <div class="boostbar"><div class="fill"></div><span>BOOST</span></div>
    <div class="ptag ${k ? 'p2' : ''} hidden">P${k + 1}</div>
    <div class="pmsg"></div>`;
  $('hud').appendChild(el);
  const q = (s) => el.querySelector(s);
  return { el, lap: q('.lap'), time: q('.time'), best: q('.best'), pos: q('.pos'), suf: q('.suf'), of: q('.of'),
    spd: q('.spd'), bar: q('.boostbar'), fill: q('.fill'), tag: q('.ptag'), msg: q('.pmsg'), msgUntil: 0 };
}

function addHuman(rosterIdx, paint = null) {
  const k = humans.length;
  const entry = roster[rosterIdx];
  const cfg = { rosterIdx, paint, tune: { ...PRESETS[entry.preset].tune } };
  const car = new Car(scene, doodleCar(paint ?? entry.color ?? 0xdddddd, entry.shape ?? 'gt'), cfg.tune, entry.name);
  car.tag = `P${k + 1}`;
  const view = { cam: new THREE.PerspectiveCamera(62, 1, 0.1, 1200), pos: new THREE.Vector3(), look: new THREE.Vector3(), orbit: 0 };
  const h = { k, cfg, car, view, hud: buildHud(k) };
  humans.push(h);
  return h;
}

function removeHuman() {
  const h = humans.pop();
  scene.remove(h.car.root);
  h.hud.el.remove();
  editing = 0;
}

async function applyHuman(h) {
  const entry = roster[h.cfg.rosterIdx];
  h.car.setModel(await modelFor(entry, h.cfg.paint));
  h.car.setTune(h.cfg.tune);
  h.car.name = entry.name;
  renderGarage();
}

function pickCar(h, rosterIdx) {
  const entry = roster[rosterIdx];
  Object.assign(h.cfg, { rosterIdx, paint: null, tune: { ...PRESETS[entry.preset ?? 'balanced'].tune } });
  return applyHuman(h);
}

addHuman(0);

// ---------- opponents ----------
const AI_SPECS = [
  { name: 'Red Crayon', color: 0xff5a36, shape: 'gt', preset: 'balanced', lane: -2.5 },
  { name: 'Blue Biro', color: 0x2f7cf6, shape: 'bubble', preset: 'light', lane: 2.5 },
  { name: 'Yellow Hi-Liter', color: 0xffd43b, shape: 'rocket', preset: 'heavy', lane: 0 },
  { name: 'Teal Gel Pen', color: 0x4fd1c5, shape: 'truck', preset: 'heavy', lane: -4 },
  { name: 'Purple Pastel', color: 0xb197fc, shape: 'gt', preset: 'drifty', lane: 4 },
  { name: 'Orange Oil-Stick', color: 0xffa94d, shape: 'bubble', preset: 'balanced', lane: -1.5 },
  { name: 'Grey Graphite', color: 0x8a8580, shape: 'rocket', preset: 'light', lane: 1.5 },
];
let ais = [];

function rebuildAIs() {
  for (const a of ais) scene.remove(a.root);
  const base = DIFFICULTY[settings.difficulty].skill;
  ais = AI_SPECS.slice(0, settings.opponents).map((s, k) =>
    Object.assign(new Car(scene, doodleCar(s.color, s.shape), PRESETS[s.preset].tune, s.name), { lane: s.lane, skill: base - k * 0.012 }));
  placeOnGrid();
}

const allCars = () => [...ais, ...humans.map((h) => h.car)];

function placeOnGrid() {
  // Two abreast, 12 m between rows; humans start at the back.
  allCars().forEach((car, k) => {
    const i = track.wrap(-8 - Math.floor(k / 2) * 8);
    const p = track.pointAt(i, k % 2 ? 4 : -4);
    const t = track.tangents[i];
    car.reset(p.x, p.z, Math.atan2(t.x, t.z), i);
  });
}
rebuildAIs();

// ---------- garage UI ----------
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const el = (tag, cls, html) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, html != null ? { innerHTML: html } : {});

function renderGarage() {
  const h = humans[editing];
  const entry = roster[h.cfg.rosterIdx];

  // Player tabs: P1, P2 (removable) or "+ Player 2".
  const tabs = $('player-tabs');
  tabs.innerHTML = '';
  humans.forEach((p, k) => {
    const b = el('button', 'btn' + (k === editing ? ' sel' : ''), `P${k + 1}${k ? '<span class="x" title="Remove player 2">✕</span>' : ''}`);
    b.onclick = (e) => {
      if (e.target.classList.contains('x')) { removeHuman(); placeOnGrid(); renderGarage(); return; }
      editing = k; renderGarage();
    };
    tabs.appendChild(b);
  });
  if (humans.length < 2 && !isTouch) {
    const add = el('button', 'btn add', '+ Player 2');
    add.title = 'Split-screen on one keyboard';
    add.onclick = () => {
      addHuman(roster.length > 4 ? 0 : 1, null);
      editing = 1;
      placeOnGrid();
      applyHuman(humans[1]);
    };
    tabs.appendChild(add);
  }

  // Car cards with P1/P2 badges.
  const list = $('car-list');
  list.innerHTML = '';
  roster.forEach((e, k) => {
    const who = humans.filter((p) => p.cfg.rosterIdx === k).map((p) => `<i class="p${p.k + 1}">P${p.k + 1}</i>`).join('');
    const thumb = e.sketch ? `<img src="${e.sketch}" alt="">` : `<div class="swatch" style="background:${hex(e.color ?? 0xdddddd)}"></div>`;
    const b = el('button', 'car-card' + (k === h.cfg.rosterIdx ? ' sel' : ''),
      `<div class="who">${who}</div><div class="thumb">${thumb}</div>${escapeHtml(e.name)}<span class="src">${e.source === 'vi3w' ? '✨ made with Vi3W' : 'doodle'}</span>`);
    b.onclick = () => pickCar(h, k);
    list.appendChild(b);
  });

  // Paint: doodle cars only.
  const paints = $('paints');
  paints.innerHTML = '';
  const canPaint = entry.source === 'doodle';
  paints.classList.toggle('off', !canPaint);
  $('paint-note').classList.toggle('hidden', canPaint);
  const auto = el('button', 'auto' + (h.cfg.paint == null ? ' sel' : ''));
  auto.title = 'Original colour';
  auto.onclick = () => { h.cfg.paint = null; applyHuman(h); };
  paints.appendChild(auto);
  for (const c of PAINTS) {
    const b = el('button', h.cfg.paint === c ? 'sel' : '');
    b.style.background = hex(c);
    b.onclick = () => { h.cfg.paint = c; applyHuman(h); };
    paints.appendChild(b);
  }

  // Handling: presets fill the sliders; sliders share a points budget.
  const tune = h.cfg.tune;
  const used = Object.values(tune).reduce((a, b) => a + b, 0);
  const left = TUNE_POINTS - used;
  $('points-left').textContent = `${left} point${left === 1 ? '' : 's'} left`;
  $('points-left').classList.toggle('left', left > 0);
  const pre = $('presets');
  pre.innerHTML = '';
  for (const [key, p] of Object.entries(PRESETS)) {
    const match = Object.keys(TUNE_STATS).every((s) => p.tune[s] === tune[s]);
    const b = el('button', 'btn small' + (match ? ' sel' : ''), p.label);
    b.onclick = () => { h.cfg.tune = { ...p.tune }; h.car.setTune(h.cfg.tune); renderGarage(); };
    pre.appendChild(b);
  }
  const tuneEl = $('tune');
  tuneEl.innerHTML = '';
  for (const [stat, label] of Object.entries(TUNE_STATS)) {
    tuneEl.appendChild(el('span', null, label));
    const ctl = el('div', 'ctl');
    const minus = el('button', null, '−');
    const plus = el('button', null, '+');
    minus.disabled = tune[stat] <= 1;
    plus.disabled = tune[stat] >= 5 || left <= 0;
    const change = (d) => () => { tune[stat] += d; h.car.setTune(tune); renderGarage(); };
    minus.onclick = change(-1);
    plus.onclick = change(1);
    const pips = el('div', 'pips', Array.from({ length: 5 }, (_, i) => `<i class="${i < tune[stat] ? 'on' : ''}"></i>`).join(''));
    ctl.append(minus, pips, plus);
    tuneEl.appendChild(ctl);
  }

  $('btn-rotate').disabled = entry.source !== 'vi3w';

  // Race setup.
  $('val-opponents').textContent = settings.opponents;
  $('val-laps').textContent = settings.laps;
  const diff = $('difficulty');
  diff.innerHTML = '';
  for (const [key, d] of Object.entries(DIFFICULTY)) {
    const b = el('button', 'btn small' + (settings.difficulty === key ? ' sel' : ''), d.label);
    b.onclick = () => { settings.difficulty = key; rebuildAIs(); renderGarage(); };
    diff.appendChild(b);
  }
  document.querySelectorAll('[data-step]').forEach((b) => {
    const [lo, hi] = LIMITS[b.dataset.step];
    const v = settings[b.dataset.step] + Number(b.dataset.d);
    b.disabled = v < lo || v > hi;
  });

  $('keys').innerHTML = humans.length > 1
    ? '<b>P1</b> WASD · Space drift · L-Shift boost · R reset<br><b>P2</b> Arrows · / drift · R-Shift boost · . reset'
    : '↑↓←→ / WASD drive · Space drift · Shift boost · R reset';
}

document.querySelectorAll('[data-step]').forEach((b) => {
  b.addEventListener('click', () => {
    const key = b.dataset.step, [lo, hi] = LIMITS[key];
    settings[key] = Math.max(lo, Math.min(hi, settings[key] + Number(b.dataset.d)));
    if (key === 'opponents') rebuildAIs();
    renderGarage();
  });
});

$('btn-rotate').onclick = () => {
  const h = humans[editing], e = roster[h.cfg.rosterIdx];
  if (e.source !== 'vi3w') return;
  e.turns = ((e.turns ?? 0) + 1) % 4;
  applyHuman(h);
};

const pad = initSketchpad((url) => { pendingSketch = url; });
$('btn-sketch').onclick = () => pad.open();

async function addFiles(files) {
  const h = humans[editing];
  const models = files.filter((f) => /\.(glb|gltf)$/i.test(f.name));
  const images = files.filter((f) => f.type.startsWith('image/'));
  const imgURL = images[0] ? URL.createObjectURL(images[0]) : null;
  if (!models.length) {
    // Just an image: attach it to the selected Vi3W car, or keep it for the next .glb.
    const entry = roster[h.cfg.rosterIdx];
    if (imgURL && entry.source === 'vi3w') { entry.sketch = imgURL; renderGarage(); }
    else if (imgURL) pendingSketch = imgURL;
    return;
  }
  for (const f of models) {
    roster.push({
      name: f.name.replace(/\.(glb|gltf)$/i, '').replace(/[-_]+/g, ' ').slice(0, 22),
      source: 'vi3w', model: URL.createObjectURL(f), sketch: imgURL || pendingSketch, preset: 'balanced',
    });
  }
  pendingSketch = null;
  try { await pickCar(h, roster.length - 1); }
  catch (err) { alert('Could not load that model: ' + err.message); roster.pop(); pickCar(h, 0); }
}

addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  if (state === 'garage') addFiles([...e.dataTransfer.files]);
});
$('file-input').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });

// Cars listed in cars/cars.json are loaded on start, so a finished build can ship with them.
fetch('cars/cars.json').then((r) => (r.ok ? r.json() : [])).then((list) => {
  for (const c of list) roster.push({ source: 'vi3w', preset: 'balanced', ...c });
  if (list.length) pickCar(humans[0], roster.length - list.length); else renderGarage();
}).catch(() => renderGarage());
renderGarage();

// ---------- input ----------
const KEYMAPS = {
  solo: { up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
    drift: ['Space'], boost: ['ShiftLeft', 'ShiftRight'], reset: ['KeyR'] },
  p1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], drift: ['Space'], boost: ['ShiftLeft'], reset: ['KeyR'] },
  p2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], drift: ['Slash'], boost: ['ShiftRight'], reset: ['Period'] },
};
const keymap = (k) => (humans.length > 1 ? (k ? KEYMAPS.p2 : KEYMAPS.p1) : KEYMAPS.solo);

const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (state !== 'garage' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash'].includes(e.code)) e.preventDefault();
  if (state === 'race') for (const h of humans) if (keymap(h.k).reset.includes(e.code)) resetToTrack(h.car);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const touch = { left: false, right: false, gas: false, brake: false, drift: false, boost: false };
if (isTouch) {
  document.querySelectorAll('#touch button').forEach((b) => {
    const k = b.dataset.k;
    const set = (v) => (e) => { e.preventDefault(); touch[k] = v; b.classList.toggle('on', v); };
    b.addEventListener('pointerdown', set(true));
    b.addEventListener('pointerup', set(false));
    b.addEventListener('pointercancel', set(false));
    b.addEventListener('pointerleave', set(false));
  });
}

function humanInput(h) {
  const m = keymap(h.k);
  const t = h.k === 0 ? touch : {};
  const on = (name) => m[name].some((c) => keys.has(c));
  return {
    throttle: on('up') || t.gas ? 1 : 0,
    brake: on('down') || t.brake ? 1 : 0,
    steer: (on('left') || t.left ? 1 : 0) - (on('right') || t.right ? 1 : 0),
    drift: on('drift') || !!t.drift,
    boost: on('boost') || !!t.boost,
  };
}
const IDLE = { throttle: 0, brake: 0, steer: 0, drift: false, boost: false };

function resetToTrack(car) {
  const i = car.idx < 0 ? 0 : car.idx;
  const p = track.points[i], t = track.tangents[i];
  Object.assign(car, { x: p.x, z: p.z, h: Math.atan2(t.x, t.z), vx: 0, vz: 0, stuck: 0 });
}

// ---------- race flow ----------
let state = 'garage';
let raceTime = 0, countdown = 0, lastCount = null;

function show(id, on) { $(id).classList.toggle('hidden', !on); }

function startRace() {
  placeOnGrid();
  raceTime = 0;
  countdown = 3;
  lastCount = null;
  state = 'countdown';
  show('garage', false); show('results', false); show('hud', true);
  show('touch', isTouch);
  const two = humans.length > 1;
  $('hud').classList.toggle('two', two);
  for (const h of humans) {
    h.hud.tag.classList.toggle('hidden', !two);
    h.hud.msg.classList.remove('show');
    h.hud.msgUntil = 0;
    h.view.pos.set(h.car.x - Math.sin(h.car.h) * 9, 4.2, h.car.z - Math.cos(h.car.h) * 9);
  }
  const sk = roster[humans[0].cfg.rosterIdx].sketch;
  show('sketch-badge', !!sk && !two);
  if (sk) $('sketch-badge').querySelector('img').src = sk;
}
$('btn-race').onclick = startRace;
$('btn-again').onclick = startRace;
$('btn-garage').onclick = () => {
  state = 'garage';
  placeOnGrid();
  show('results', false); show('hud', false); show('touch', false); show('countdown', false); show('garage', true);
};

function progress(car) { return car.finished ? 1e9 - car.finishTime : car.lap * track.N + car.idx; }
const standings = () => allCars().sort((a, b) => progress(b) - progress(a));

function lapLogic(car) {
  const N = track.N;
  if (car.idx > N * 0.4 && car.idx < N * 0.6) car.halfway = true;
  if (car.prevIdx > N * 0.8 && car.idx < N * 0.2 && car.halfway) {
    if (car.lap > 0) car.lapTimes.push(raceTime - car.lapStart);
    car.lap++;
    car.halfway = false;
    car.lapStart = raceTime;
    if (car.lap > settings.laps && !car.finished) { car.finished = true; car.finishTime = raceTime; }
    return true;
  }
  return false;
}

const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const ordinal = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['st', 'nd', 'rd'][(n % 10) - 1] || 'th');

function flash(h, text, secs = 1.2) {
  h.hud.msg.textContent = text;
  h.hud.msg.classList.add('show');
  h.hud.msgUntil = raceTime + secs;
}

function showResults() {
  state = 'finished';
  const order = standings();
  const places = humans.map((h) => order.indexOf(h.car) + 1);
  if (humans.length > 1) {
    const winner = places[0] < places[1] ? 0 : 1;
    $('res-title').textContent = `P${winner + 1} wins! 🏆`;
  } else {
    $('res-title').textContent = places[0] === 1 ? 'You won! 🏆' : `${places[0]}${ordinal(places[0])} place`;
  }
  const best = humans.map((h) => `${humans.length > 1 ? h.car.tag + ' ' : ''}Time ${fmt(h.car.finishTime)} · Best lap ${fmt(Math.min(...h.car.lapTimes))}`).join('<br>');
  $('res-body').innerHTML = `<p>${best}</p><table>${order
    .map((c, k) => `<tr class="${c.tag ? 'me' : ''}"><td>${k + 1}.</td><td>${c.tag ? `<b>${c.tag}</b> ` : ''}${escapeHtml(c.name)}</td><td>${c.finished ? fmt(c.finishTime) : '—'}</td></tr>`)
    .join('')}</table>`;
  show('results', true);
  show('touch', false);
}

// ---------- camera, effects, HUD ----------
const clock = new THREE.Clock();

function updateChaseCam(h, dt) {
  const { car, view } = h;
  const fx = Math.sin(car.h), fz = Math.cos(car.h);
  const back = car.boosting ? 10.5 : 9;
  const want = new THREE.Vector3(car.x - fx * back, 4.2, car.z - fz * back);
  view.pos.lerp(want, 1 - Math.exp(-6 * dt));
  view.cam.position.copy(view.pos);
  if (car.hitWall > 0) view.cam.position.x += (Math.random() - 0.5) * 0.3;
  view.look.set(car.x + fx * 4, 1.2, car.z + fz * 4);
  view.cam.lookAt(view.look);
  const fov = 62 + Math.min(car.speed, 60) * 0.28 + (car.boosting ? 8 : 0);
  view.cam.fov += (fov - view.cam.fov) * Math.min(1, 4 * dt);
}

function updateGarageCam(h, dt) {
  const { car, view } = h;
  view.orbit += dt * 0.35;
  view.cam.position.set(car.x + Math.sin(view.orbit) * 9, 3.2, car.z + Math.cos(view.orbit) * 9);
  view.cam.lookAt(car.x, 1, car.z);
  view.cam.fov = 62;
}

function emitEffects(car) {
  const fx = Math.sin(car.h), fz = Math.cos(car.h);
  const rearX = car.x - fx * 1.9, rearZ = car.z - fz * 1.9;
  const sliding = Math.abs(car.lat) > 4 && car.speed > 8;
  if ((sliding && Math.random() < 0.7) || (car.offroad && car.speed > 6 && Math.random() < 0.5)) {
    const side = Math.random() < 0.5 ? -1 : 1;
    puffs.spawn(rearX + fz * side * 0.9, 0.4, rearZ - fx * side * 0.9, car.offroad ? 0xd9b98c : 0xffffff, car.offroad ? 1.1 : 1.4);
  }
  if (car.boosting) puffs.spawn(rearX, 0.8, rearZ, Math.random() < 0.5 ? 0xff8a3d : 0xffd43b, 0.9);
  if (car.hitWall > 0.25) puffs.spawn(car.x, 1, car.z, 0xfff3b0, 1.8);
}

function updateHUD() {
  const order = standings();
  for (const h of humans) {
    const { car, hud } = h;
    const place = order.indexOf(car) + 1;
    hud.pos.textContent = place;
    hud.suf.textContent = ordinal(place);
    hud.of.textContent = `/${order.length}`;
    hud.lap.textContent = `Lap ${Math.max(1, Math.min(car.lap, settings.laps))}/${settings.laps}`;
    hud.time.textContent = fmt(car.finished ? car.finishTime : raceTime);
    hud.best.textContent = car.lapTimes.length ? `Best ${fmt(Math.min(...car.lapTimes))}` : 'Best —';
    hud.spd.textContent = Math.round(Math.max(0, car.fwd) * 3.6);
    hud.fill.style.width = `${car.boost * 100}%`;
    hud.bar.classList.toggle('on', car.boosting);
    if (car.driftBonus) { flash(h, `+${Math.round(car.driftBonus * 100)}% boost`, 0.9); car.driftBonus = 0; }
    if (!car.finished && hud.msgUntil && raceTime > hud.msgUntil) { hud.msg.classList.remove('show'); hud.msgUntil = 0; }
  }
}

// Cars that sit still against a wall for a few seconds get put back on the road.
function unstick(car, wantsToMove, dt) {
  car.stuck = wantsToMove && car.speed < 1.5 ? car.stuck + dt : 0;
  if (car.stuck > 2.5) resetToTrack(car);
}

// ---------- loop ----------
function render() {
  const w = innerWidth, hgt = innerHeight;
  const split = state !== 'garage' && humans.length > 1;
  if (!split) {
    const h = state === 'garage' ? humans[editing] : humans[0];
    const cam = h.view.cam;
    cam.aspect = w / hgt;
    if (state === 'garage') {
      // Shift the view so the car sits beside the garage panel.
      cam.setViewOffset(w, hgt, w > 720 ? -w * 0.14 : 0, w > 720 ? 0 : hgt * 0.22, w, hgt);
    } else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    followSun(h.car);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, hgt);
    renderer.render(scene, cam);
    return;
  }
  // Split screen: P1 on top, P2 below. The sun (and its shadow box) moves to each player in turn.
  renderer.setScissorTest(true);
  humans.forEach((h, k) => {
    const y = k === 0 ? hgt / 2 : 0;
    const cam = h.view.cam;
    cam.clearViewOffset();
    cam.aspect = w / (hgt / 2);
    cam.updateProjectionMatrix();
    followSun(h.car);
    renderer.setViewport(0, y, w, hgt / 2);
    renderer.setScissor(0, y, w, hgt / 2);
    renderer.render(scene, cam);
  });
}

function followSun(car) {
  sun.position.set(car.x + 40, 70, car.z + 25);
  sun.target.position.set(car.x, 0, car.z);
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
}

// One simulation step, kept apart from rendering so it can also be run headless for testing.
function step(dt) {
  const cars = allCars();

  if (state === 'countdown') {
    countdown -= dt;
    const n = Math.ceil(countdown);
    const label = n > 0 ? String(n) : 'GO!';
    if (label !== lastCount) {
      lastCount = label;
      const c = $('countdown');
      c.textContent = label;
      c.classList.remove('hidden', 'pop');
      void c.offsetWidth;
      c.classList.add('pop');
    }
    for (const c of cars) c.update(dt, IDLE, track);
    if (countdown <= 0) state = 'race';
    updateHUD();
  } else if (state === 'race' || state === 'finished') {
    if (countdown > -0.8) { countdown -= dt; if (countdown <= -0.8) show('countdown', false); }
    raceTime += dt;
    for (const ai of ais) {
      const input = ai.finished ? IDLE : ai.aiInput(track, ai.lane, ai.skill);
      ai.update(dt, input, track, ai.skill);
      unstick(ai, !ai.finished, dt);
    }
    for (const h of humans) {
      const input = state === 'race' && !h.car.finished ? humanInput(h) : IDLE;
      h.car.update(dt, input, track);
      unstick(h.car, input.throttle > 0, dt);
    }
    collideCars(cars);
    for (const c of cars) {
      if (lapLogic(c) && c.tag) {
        const h = humans.find((x) => x.car === c);
        if (c.finished) { const p = standings().indexOf(c) + 1; flash(h, `Finished ${p}${ordinal(p)}!`, 1e9); }
        else if (c.lap === settings.laps) flash(h, 'Final lap!');
        else if (c.lap > 1) flash(h, `Lap ${c.lap}`);
      }
      c.sync(0);
      emitEffects(c);
    }
    if (state === 'race' && humans.every((h) => h.car.finished)) showResults();
    updateHUD();
  } else {
    for (const h of humans) h.car.sync(dt);
  }

  puffs.update(dt);
}

function tick() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  step(dt);
  if (state === 'garage') updateGarageCam(humans[editing], dt);
  else for (const h of humans) updateChaseCam(h, dt);
  render();
  requestAnimationFrame(tick);
}
tick();

// Handy for debugging from the console.
Object.assign(window, { __dd: { humans, get ais() { return ais; }, get state() { return state; }, track, settings, allCars, startRace, step } });
