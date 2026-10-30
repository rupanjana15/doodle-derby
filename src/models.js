// Car models: built-in doodle cars, plus loading and normalising Vi3W .glb exports.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { inked, addOutlines, gradient } from './toon.js';

export const CAR_LENGTH = 4.2;

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d, 1, 1, 1);
const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.36, 12).rotateZ(Math.PI / 2);

// Shape presets for the placeholder cars. All face +Z, sit on y = 0.
const SHAPES = {
  gt: { body: [2, 0.6, 4.2], cab: [1.5, 0.55, 1.8], cabZ: -0.3, lift: 0.35, spoiler: true },
  truck: { body: [2.2, 0.9, 4.2], cab: [1.9, 0.9, 1.6], cabZ: 0.9, lift: 0.5, spoiler: false },
  rocket: { body: [1.5, 0.5, 4.4], cab: [1, 0.45, 1.2], cabZ: -0.6, lift: 0.3, spoiler: false, fin: true },
  bubble: { body: [2, 0.7, 3.6], cab: [1.7, 0.8, 1.9], cabZ: -0.1, lift: 0.4, spoiler: false },
};

export function doodleCar(color, shape = 'gt') {
  const s = SHAPES[shape];
  const g = new THREE.Group();
  const body = inked(box(...s.body), color);
  body.position.y = s.lift + s.body[1] / 2;
  g.add(body);
  const cab = inked(box(...s.cab), 0xcfe8ff);
  cab.position.set(0, s.lift + s.body[1] + s.cab[1] / 2, s.cabZ);
  g.add(cab);
  const zw = s.body[2] / 2 - 0.75, xw = s.body[0] / 2;
  for (const [x, z] of [[-xw, zw], [xw, zw], [-xw, -zw], [xw, -zw]]) {
    const w = inked(wheelGeo, 0x2b2a28, 0.04);
    w.position.set(x, 0.42, z);
    w.userData.wheel = true;
    g.add(w);
  }
  if (s.spoiler) {
    const sp = inked(box(2, 0.12, 0.5), color);
    sp.position.set(0, s.lift + s.body[1] + 0.45, -s.body[2] / 2 + 0.25);
    g.add(sp);
    for (const x of [-0.7, 0.7]) {
      const leg = inked(box(0.12, 0.4, 0.12), 0x2b2a28, 0.03);
      leg.position.set(x, s.lift + s.body[1] + 0.2, -s.body[2] / 2 + 0.25);
      g.add(leg);
    }
  }
  if (s.fin) {
    const fin = inked(box(0.12, 0.9, 1), color);
    fin.position.set(0, s.lift + s.body[1] + 0.45, -s.body[2] / 2 + 0.5);
    g.add(fin);
  }
  // Headlights: little marker dots.
  for (const x of [-xw + 0.35, xw - 0.35]) {
    const l = inked(box(0.35, 0.2, 0.08), 0xfff3b0, 0.03);
    l.position.set(x, s.lift + s.body[1] * 0.6, s.body[2] / 2 + 0.02);
    g.add(l);
  }
  return g;
}

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(draco);

export function loadGLB(url) {
  return new Promise((resolve, reject) => loader.load(url, (g) => resolve(g.scene), undefined, reject));
}

// Scale any model to car size, centre it, put its wheels on the ground and add ink outlines.
// `yaw` is in quarter turns, for models that were exported facing a different way.
export function normaliseModel(object, yaw = null) {
  const holder = new THREE.Group();
  const spin = new THREE.Group();
  spin.add(object);
  holder.add(spin);

  let b = new THREE.Box3().setFromObject(object);
  const size = b.getSize(new THREE.Vector3());
  // Guess: a car is longer than it is wide, so its long axis should be Z.
  const turns = yaw ?? (size.x > size.z ? 1 : 0);

  // Measure and centre with `spin` unrotated, then turn it: rotation about the centre keeps it centred.
  object.scale.multiplyScalar(CAR_LENGTH / Math.max(size.x, size.z, 1e-6));
  object.updateMatrixWorld(true);
  b = new THREE.Box3().setFromObject(object);
  const c = b.getCenter(new THREE.Vector3());
  object.position.sub(new THREE.Vector3(c.x, b.min.y, c.z));
  spin.rotation.y = turns * Math.PI / 2;

  // Swap PBR materials for cel shading that keeps the model's own texture. This matches the
  // doodle look, and textured exports that default to fully metallic no longer render black.
  object.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const swap = (m) => (m.isMeshStandardMaterial
      ? new THREE.MeshToonMaterial({ map: m.map, color: m.color, gradientMap: gradient, flatShading: !o.geometry.attributes.normal || m.flatShading, transparent: m.transparent, opacity: m.opacity, side: m.side })
      : m);
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  addOutlines(holder, 0.035);
  holder.userData.turns = turns;
  holder.userData.spin = spin;
  return holder;
}

// Footprint of the model's flat top (car space), from the vertices within `band` of its highest point.
function roofBounds(holder, band = 0.06) {
  holder.updateMatrixWorld(true);
  const pts = [];
  const v = new THREE.Vector3();
  holder.traverse((o) => {
    if (!o.isMesh || o.userData.isOutline) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).clone());
  });
  const top = Math.max(...pts.map((p) => p.y));
  const roof = pts.filter((p) => p.y > top - band);
  const r = new THREE.Box3().setFromPoints(roof);
  return { y: top, minX: r.min.x, maxX: r.max.x, minZ: r.min.z, maxZ: r.max.z };
}

// Additions drawn in code for parts a Vi3W export left out. Listed per car in cars.json as "extras".
export const EXTRAS = {
  // Glass crystal peaks on the roof, as in the Crystal Drill concept render.
  crystals(holder) {
    const r = roofBounds(holder);
    const len = r.maxZ - r.minZ, wid = r.maxX - r.minX;
    const glass = new THREE.MeshToonMaterial({
      color: 0xe4f6ff, gradientMap: gradient, flatShading: true, transparent: true, opacity: 0.82,
    });
    // [along roof 0 = rear .. 1 = front, across -1..1, height, radius]: two big peaks, a small one at
    // the front and low shards filling the gaps.
    const peaks = [
      [0.32, -0.1, 1.05, 0.5], [0.66, 0.05, 1.0, 0.48], [0.88, 0.2, 0.45, 0.28],
      [0.14, 0.35, 0.55, 0.32], [0.48, -0.45, 0.6, 0.34], [0.5, 0.5, 0.5, 0.3], [0.82, -0.45, 0.4, 0.26],
    ];
    const group = new THREE.Group();
    peaks.forEach(([t, s, h, rad], k) => {
      const geo = new THREE.ConeGeometry(rad, h, 4 + (k % 2), 1);
      const m = new THREE.Mesh(geo, glass);
      m.position.set(r.minX + wid * (0.5 + s * 0.38), r.y + h / 2 - 0.05, r.minZ + len * t);
      m.rotation.set((k % 3 - 1) * 0.12, k * 0.9, ((k + 1) % 3 - 1) * 0.1);
      m.castShadow = true;
      group.add(m);
    });
    addOutlines(group, 0.03);
    holder.add(group);
  },
};
