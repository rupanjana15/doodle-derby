// Doodled smoke/dust puffs for drifts, off-road and wall hits.
import * as THREE from 'three';
import { canvasTexture } from './toon.js';

const puffTex = canvasTexture(64, 64, (c) => {
  c.fillStyle = '#ffffff';
  c.strokeStyle = '#1d1b1a';
  c.lineWidth = 4;
  c.beginPath(); c.arc(32, 32, 26, 0, Math.PI * 2); c.fill(); c.stroke();
}, false);

export class Puffs {
  constructor(scene, max = 120) {
    this.items = [];
    for (let i = 0; i < max; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false }));
      s.visible = false;
      scene.add(s);
      this.items.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1 });
    }
    this.next = 0;
  }

  spawn(x, y, z, color = 0xffffff, size = 1) {
    const p = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    p.s.visible = true;
    p.s.position.set(x, y, z);
    p.s.material.color.setHex(color);
    p.life = p.max = 0.6 + Math.random() * 0.4;
    p.vx = (Math.random() - 0.5) * 2; p.vz = (Math.random() - 0.5) * 2; p.vy = 1 + Math.random();
    p.size = size;
  }

  update(dt) {
    for (const p of this.items) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const k = 1 - p.life / p.max;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      p.s.scale.setScalar(p.size * (0.6 + k * 1.6));
      p.s.material.opacity = 1 - k;
    }
  }
}
