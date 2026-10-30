// The circuit: a closed spline sampled into evenly spaced points. Everything
// (road mesh, walls, AI, lap counting) works off those samples.
import * as THREE from 'three';
import { inked, canvasTexture } from './toon.js';

export const TRACK_WIDTH = 16;
export const HALF = TRACK_WIDTH / 2;
export const WALL = HALF + 4.5;

const SCALE = 1.9;
const CONTROL = [
  [0, 0], [60, -12], [118, 6], [150, 58], [132, 118], [84, 142], [46, 112],
  [12, 138], [-48, 152], [-92, 112], [-84, 52], [-44, 28],
];

export class Track {
  constructor(scene) {
    const curve = new THREE.CatmullRomCurve3(
      CONTROL.map(([x, z]) => new THREE.Vector3(x * SCALE, 0, z * SCALE)), true, 'centripetal'
    );
    this.length = curve.getLength();
    this.N = Math.round(this.length / 1.5);
    this.points = curve.getSpacedPoints(this.N).slice(0, this.N);
    this.tangents = [];
    this.sides = [];
    for (let i = 0; i < this.N; i++) {
      const a = this.points[(i - 1 + this.N) % this.N], b = this.points[(i + 1) % this.N];
      const t = b.clone().sub(a).normalize();
      this.tangents.push(t);
      this.sides.push(new THREE.Vector3(t.z, 0, -t.x)); // up × tangent
    }
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildGround();
    this.buildRoad();
    this.buildBarriers();
    this.buildScenery();
  }

  wrap(i) { return ((i % this.N) + this.N) % this.N; }

  // Point on the track at sample i, shifted sideways by `lateral` metres.
  pointAt(i, lateral = 0) {
    i = this.wrap(Math.round(i));
    return this.points[i].clone().addScaledVector(this.sides[i], lateral);
  }

  // Nearest sample to (x, z). Searches near `hint` when given, so per-frame lookups are cheap.
  nearest(x, z, hint = -1) {
    let best = 0, bestD = Infinity;
    const scan = (i) => {
      const p = this.points[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    };
    if (hint < 0) for (let i = 0; i < this.N; i++) scan(i);
    else for (let k = -30; k <= 30; k++) scan(this.wrap(hint + k));
    const p = this.points[best], s = this.sides[best];
    const lat = (x - p.x) * s.x + (z - p.z) * s.z;
    return { i: best, lat, dist: Math.sqrt(bestD) };
  }

  ribbon(inner, outer, texture, vScale, y) {
    const pos = [], uv = [], idx = [];
    let dist = 0;
    for (let i = 0; i <= this.N; i++) {
      const k = i % this.N;
      if (i > 0) dist += this.points[k].distanceTo(this.points[i - 1]);
      for (const [lat, u] of [[inner, 0], [outer, 1]]) {
        const p = this.pointAt(k, lat);
        pos.push(p.x, y, p.z);
        uv.push(u, dist / vScale);
      }
      if (i < this.N) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Winding depends on the curve direction; render both sides so it never disappears.
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  buildGround() {
    const paper = canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#f6f0df'; c.fillRect(0, 0, w, h);
      for (let n = 0; n < 1400; n++) { // paper grain
        c.fillStyle = `rgba(120,100,60,${Math.random() * 0.05})`;
        c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      c.strokeStyle = 'rgba(80,130,220,0.35)'; c.lineWidth = 2;
      for (let y = 0; y < h; y += 32) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(w, y + 0.5); c.stroke(); }
      c.strokeStyle = 'rgba(230,80,80,0.3)';
      c.beginPath(); c.moveTo(40, 0); c.lineTo(40, h); c.stroke();
    });
    paper.repeat.set(160, 160);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshLambertMaterial({ map: paper }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  buildRoad() {
    const road = canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#9b978f'; c.fillRect(0, 0, w, h);
      for (let n = 0; n < 900; n++) { // pencil-shading scribbles
        c.strokeStyle = `rgba(40,40,40,${0.04 + Math.random() * 0.06})`;
        c.lineWidth = 1;
        const x = Math.random() * w, y = Math.random() * h;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + 10, y - 6); c.stroke();
      }
      c.fillStyle = '#fbf7ee'; // centre dashes
      c.fillRect(w / 2 - 5, 20, 10, 100);
      c.fillStyle = '#1d1b1a'; // inked edges
      c.fillRect(0, 0, 6, h); c.fillRect(w - 6, 0, 6, h);
    });
    this.ribbon(-HALF, HALF, road, 16, 0.01);

    const curb = canvasTexture(64, 128, (c, w, h) => {
      c.fillStyle = '#fbf7ee'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#ff5a36'; c.fillRect(0, 0, w, h / 2);
      c.strokeStyle = '#1d1b1a'; c.lineWidth = 4; c.strokeRect(0, 0, w, h);
    });
    this.ribbon(HALF, HALF + 1.4, curb, 4, 0.03);
    this.ribbon(-HALF - 1.4, -HALF, curb, 4, 0.03);

    // Chequered start/finish line across sample 0.
    const chk = canvasTexture(128, 32, (c) => {
      for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
        c.fillStyle = (x + y) % 2 ? '#1d1b1a' : '#fbf7ee';
        c.fillRect(x * 8, y * 8, 8, 8);
      }
    }, false);
    const s = this.sides[0];
    const faceSide = Math.atan2(-s.z, s.x); // yaw that points local +x along the track's side vector
    const lineHolder = new THREE.Group();
    const line = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_WIDTH, 2.5), new THREE.MeshLambertMaterial({ map: chk }));
    line.rotation.x = -Math.PI / 2;
    lineHolder.add(line);
    lineHolder.rotation.y = faceSide;
    lineHolder.position.copy(this.points[0]).setY(0.04);
    this.group.add(lineHolder);

    // A hand-drawn banner over the line.
    const postGeo = new THREE.CylinderGeometry(0.35, 0.35, 8, 8);
    for (const side of [-1, 1]) {
      const post = inked(postGeo, 0xfbf7ee, 0.06);
      post.position.copy(this.points[0]).addScaledVector(s, side * (HALF + 2)).setY(4);
      this.group.add(post);
    }
    const bannerTex = canvasTexture(512, 96, (c, w, h) => {
      c.fillStyle = '#fbf7ee'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#ff5a36'; c.font = '64px "Permanent Marker", cursive'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('DOODLE DERBY', w / 2, h / 2 + 4);
    }, false);
    this.bannerTex = bannerTex;
    const banner = new THREE.Mesh(new THREE.BoxGeometry(TRACK_WIDTH + 4, 2.4, 0.3),
      [0, 0, 0, 0, 1, 1].map((k) => (k ? new THREE.MeshBasicMaterial({ map: bannerTex }) : new THREE.MeshBasicMaterial({ color: 0x1d1b1a }))));
    banner.position.copy(this.points[0]).setY(8.2);
    banner.rotation.y = faceSide;
    this.group.add(banner);
    // Redraw once the marker font has loaded.
    document.fonts?.load('64px "Permanent Marker"').then(() => {
      const c = bannerTex.image.getContext('2d');
      c.fillStyle = '#fbf7ee'; c.fillRect(0, 0, 512, 96);
      c.fillStyle = '#ff5a36'; c.font = '64px "Permanent Marker", cursive'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('DOODLE DERBY', 256, 52);
      bannerTex.needsUpdate = true;
    });
  }

  buildBarriers() {
    // Tyre stacks along both walls.
    const geo = new THREE.TorusGeometry(0.55, 0.32, 6, 10);
    const count = Math.ceil(this.N / 3) * 2;
    const tyres = new THREE.InstancedMesh(geo, new THREE.MeshToonMaterial({ color: 0x2b2a28 }), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let n = 0;
    for (let i = 0; i < this.N; i += 3) {
      for (const side of [-1, 1]) {
        const p = this.pointAt(i, side * (WALL + 0.6));
        e.set(Math.PI / 2, 0, 0);
        q.setFromEuler(e);
        m.compose(p.setY(0.3), q, new THREE.Vector3(1, 1, 1));
        tyres.setMatrixAt(n++, m);
      }
    }
    tyres.count = n;
    tyres.castShadow = true;
    this.group.add(tyres);
  }

  buildScenery() {
    const trunk = new THREE.CylinderGeometry(0.35, 0.5, 2.4, 6);
    const crowns = [new THREE.ConeGeometry(2.2, 5, 7), new THREE.IcosahedronGeometry(2.4, 0)];
    const greens = [0x7bc96f, 0x5fae5a, 0x9bd27a];
    let placed = 0, tries = 0;
    while (placed < 140 && tries < 4000) {
      tries++;
      const x = 55 + (Math.random() - 0.5) * 600, z = 133 + (Math.random() - 0.5) * 560;
      const q = this.nearest(x, z);
      if (q.dist < WALL + 6) continue;
      const tree = new THREE.Group();
      const tr = inked(trunk, 0x9a6b45, 0.08); tr.position.y = 1.2; tree.add(tr);
      const kind = Math.random() < 0.6 ? 0 : 1;
      const cr = inked(crowns[kind], greens[placed % 3], 0.1);
      cr.position.y = kind ? 4.4 : 4.6;
      tree.add(cr);
      const s = 0.7 + Math.random() * 0.8;
      tree.scale.setScalar(s);
      tree.rotation.y = Math.random() * Math.PI;
      tree.position.set(x, 0, z);
      this.group.add(tree);
      placed++;
    }
    // A few doodled clouds for the sky.
    const puff = new THREE.SphereGeometry(6, 8, 6);
    for (let c = 0; c < 12; c++) {
      const cloud = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const p = inked(puff, 0xffffff, 0.25);
        p.castShadow = false;
        p.position.set(k * 7 - 7, Math.random() * 2, Math.random() * 3);
        p.scale.setScalar(0.8 + Math.random() * 0.5);
        cloud.add(p);
      }
      const a = Math.random() * Math.PI * 2;
      cloud.position.set(80 + Math.cos(a) * 330, 70 + Math.random() * 30, 150 + Math.sin(a) * 330);
      this.group.add(cloud);
    }
  }
}
