// Arcade car physics on a flat track. Heading 0 faces +Z; forward = (sin h, cos h).
import * as THREE from 'three';
import { HALF, WALL } from './track.js';

// Tuning: four stats from 1 to 5 sharing a budget of TUNE_POINTS. Presets are just starting spreads.
export const TUNE_STATS = { speed: 'Top speed', accel: 'Acceleration', grip: 'Grip', steer: 'Steering' };
export const TUNE_POINTS = 12;
export const PRESETS = {
  balanced: { label: 'Balanced', tune: { speed: 3, accel: 3, grip: 3, steer: 3 } },
  heavy: { label: 'Heavy', tune: { speed: 5, accel: 2, grip: 4, steer: 1 } },
  light: { label: 'Light', tune: { speed: 2, accel: 5, grip: 3, steer: 2 } },
  drifty: { label: 'Drifty', tune: { speed: 3, accel: 3, grip: 1, steer: 5 } },
};

export function tuneParams(t) {
  return {
    top: 36 + t.speed * 3.5,
    accel: 12 + t.accel * 4,
    grip: 1.5 + t.grip * 1.5,
    turn: 1.5 + t.steer * 0.35,
    drag: 0.3,
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Car {
  constructor(scene, model, tune = PRESETS.balanced.tune, name = 'Car') {
    this.name = name;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    scene.add(this.root);
    this.setModel(model);
    this.setTune(tune);
    this.reset(0, 0, 0);
  }

  setModel(model) {
    if (this.model) this.body.remove(this.model);
    this.model = model;
    this.body.add(model);
    this.wheels = [];
    model.traverse((o) => { if (o.userData.wheel) this.wheels.push(o); });
  }

  setTune(tune) { this.tune = { ...tune }; this.p = tuneParams(tune); }

  reset(x, z, heading, trackIdx = -1) {
    this.x = x; this.z = z; this.h = heading;
    this.vx = 0; this.vz = 0;
    this.steer = 0;
    this.fwd = 0; this.lat = 0; this.accelVis = 0;
    this.idx = trackIdx; this.trackLat = 0;
    this.offroad = false;
    this.hitWall = 0;
    this.lap = 0; this.halfway = true; this.finished = false;
    this.lapStart = 0; this.lapTimes = []; this.finishTime = 0;
    this.boost = 0.3; this.boosting = false; this.driftTime = 0; this.driftBonus = 0;
    this.stuck = 0;
    this.sync(0);
  }

  get speed() { return Math.hypot(this.vx, this.vz); }

  // input: { throttle 0..1, brake 0..1, steer -1..1 (+1 = left), drift bool, boost bool }
  update(dt, input, track, topMul = 1) {
    const p = this.p;
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    const sx = fz, sz = -fx;
    let fwd = this.vx * fx + this.vz * fz;
    let lat = this.vx * sx + this.vz * sz;
    const prevFwd = fwd;

    // Boost burns the meter for extra push and a higher cap; it refills slowly on its own.
    this.boosting = !!input.boost && this.boost > 0.02 && fwd > 3;
    if (this.boosting) { fwd += 26 * dt; this.boost = Math.max(0, this.boost - 0.4 * dt); }
    else this.boost = Math.min(1, this.boost + 0.04 * dt);

    // Holding a drift and letting go pays out boost.
    if (input.drift && Math.abs(fwd) > 10) this.driftTime += dt;
    else {
      if (this.driftTime > 0.6) {
        this.driftBonus = Math.min(0.35, this.driftTime * 0.15);
        this.boost = Math.min(1, this.boost + this.driftBonus);
      }
      this.driftTime = 0;
    }

    // Engine and brakes.
    fwd += p.accel * input.throttle * dt;
    if (input.brake > 0) fwd -= (fwd > 0.5 ? 38 : 14) * input.brake * dt;
    fwd -= fwd * p.drag * dt;
    if (!input.throttle && !input.brake) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 3 * dt);
    const cap = p.top * topMul * (this.offroad ? 0.45 : 1) * (this.boosting ? 1.3 : 1);
    if (fwd > cap) fwd += (cap - fwd) * Math.min(1, 2.5 * dt);
    fwd = Math.max(fwd, -12);

    // Grip pulls sideways velocity back in line; part of it is kept as forward speed so drifts flow.
    const grip = p.grip * (input.drift ? 0.22 : 1) * (this.offroad ? 0.7 : 1);
    const keep = Math.exp(-grip * dt);
    const lost = lat * (1 - keep);
    lat *= keep;
    if (fwd > 2) fwd += Math.abs(lost) * 0.45;

    // Steering: needs some speed, softer at top speed, sharper when drifting.
    this.steer += (input.steer - this.steer) * Math.min(1, 8 * dt);
    const sf = clamp(Math.abs(fwd) / 8, 0, 1) * (1 - 0.35 * clamp(Math.abs(fwd) / p.top, 0, 1));
    this.h += this.steer * p.turn * sf * Math.sign(fwd || 1) * (input.drift ? 1.35 : 1) * dt;

    this.vx = fwd * fx + lat * sx;
    this.vz = fwd * fz + lat * sz;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Track: off-road detection and the tyre walls.
    const q = track.nearest(this.x, this.z, this.idx);
    this.prevIdx = this.idx < 0 ? q.i : this.idx;
    this.idx = q.i;
    this.trackLat = q.lat;
    this.offroad = Math.abs(q.lat) > HALF + 1.4;
    this.hitWall = Math.max(0, this.hitWall - dt);
    if (Math.abs(q.lat) > WALL) {
      const s = track.sides[q.i], dir = Math.sign(q.lat);
      const over = Math.abs(q.lat) - WALL;
      this.x -= s.x * over * dir;
      this.z -= s.z * over * dir;
      const vn = this.vx * s.x + this.vz * s.z;
      if (vn * dir > 0) {
        this.vx -= s.x * vn * 1.4;
        this.vz -= s.z * vn * 1.4;
        this.vx *= 0.96; this.vz *= 0.96;
        if (Math.abs(vn) > 4) this.hitWall = 0.3;
      }
    }

    this.fwd = fwd;
    this.lat = lat;
    this.accelVis += ((fwd - prevFwd) / Math.max(dt, 1e-4) - this.accelVis) * Math.min(1, 6 * dt);
    this.sync(dt);
  }

  sync(dt) {
    this.root.position.set(this.x, 0, this.z);
    this.root.rotation.y = this.h;
    // Body lean and squat sell the motion even on a rigid imported model.
    const roll = clamp(-this.lat * 0.03 - this.steer * this.fwd * 0.004, -0.14, 0.14);
    const pitch = clamp(-this.accelVis * 0.004, -0.07, 0.07);
    this.body.rotation.z += (roll - this.body.rotation.z) * Math.min(1, 10 * dt);
    this.body.rotation.x += (pitch - this.body.rotation.x) * Math.min(1, 10 * dt);
    this.body.position.y = this.offroad ? Math.abs(Math.sin(performance.now() * 0.03)) * 0.06 * Math.min(1, this.speed / 10) : 0;
    for (const w of this.wheels) w.rotation.x += this.fwd * dt / 0.42;
  }

  // Simple racing-line follower for the opponents.
  aiInput(track, lane, skill) {
    const look = 6 + Math.floor(this.speed * 0.35);
    const target = track.pointAt(this.idx + look, lane);
    const desired = Math.atan2(target.x - this.x, target.z - this.z);
    const diff = wrapAngle(desired - this.h);
    const t0 = track.tangents[this.idx], t1 = track.tangents[track.wrap(this.idx + look * 2)];
    const bend = Math.acos(clamp(t0.x * t1.x + t0.z * t1.z, -1, 1));
    const safe = (1.25 - bend) * this.p.top * skill;
    const tooFast = this.fwd > Math.max(18, safe);
    return {
      throttle: tooFast ? 0 : 1, brake: tooFast && this.fwd > safe + 6 ? 0.6 : 0, steer: clamp(diff * 2.2, -1, 1), drift: false,
      boost: (this.boosting || this.boost > 0.6) && bend < 0.3 && !tooFast,
    };
  }
}

// Push overlapping cars apart and trade a little momentum.
export function collideCars(cars) {
  const R = 2.5;
  for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
    const A = cars[a], B = cars[b];
    const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz);
    if (d >= R || d < 1e-4) continue;
    const nx = dx / d, nz = dz / d, push = (R - d) / 2;
    A.x -= nx * push; A.z -= nz * push;
    B.x += nx * push; B.z += nz * push;
    const rel = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;
    if (rel < 0) {
      const j = rel * 0.8;
      A.vx += nx * j / 2; A.vz += nz * j / 2;
      B.vx -= nx * j / 2; B.vz -= nz * j / 2;
    }
  }
}
