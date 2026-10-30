// Shared "hand-drawn" look: cel-shaded materials plus inverted-hull ink outlines.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const gradient = (() => {
  const data = new Uint8Array([90, 170, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();

const toonCache = new Map();
export function toon(color) {
  if (!toonCache.has(color)) toonCache.set(color, new THREE.MeshToonMaterial({ color, gradientMap: gradient }));
  return toonCache.get(color);
}

const outlineCache = new Map();
function outlineMaterial(thickness) {
  const key = thickness.toFixed(4);
  if (outlineCache.has(key)) return outlineCache.get(key);
  const mat = new THREE.MeshBasicMaterial({ color: 0x1d1b1a, side: THREE.BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.outlineT = { value: thickness };
    shader.vertexShader = 'uniform float outlineT;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed += normalize(normal) * outlineT;'
    );
  };
  mat.customProgramCacheKey = () => 'outline' + key;
  outlineCache.set(key, mat);
  return mat;
}

// Imported meshes are split at UV seams, so pushing their vertices out along normals
// tears the hull open. Weld by position alone and use smooth normals for the outline.
function hullGeometry(geometry) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geometry.attributes.position);
  if (geometry.index) g.setIndex(geometry.index);
  const welded = mergeVertices(g, 1e-4);
  welded.computeVertexNormals();
  return welded;
}

// Adds an ink outline to every mesh under `root`. `worldThickness` is in metres;
// it is divided by each mesh's world scale so imported models of any size look the same.
export function addOutlines(root, worldThickness = 0.05) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) meshes.push(o); });
  const s = new THREE.Vector3();
  for (const m of meshes) {
    if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();
    m.getWorldScale(s);
    const scale = Math.max(1e-6, (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3);
    const hull = new THREE.Mesh(hullGeometry(m.geometry), outlineMaterial(worldThickness / scale));
    hull.userData.isOutline = true;
    hull.raycast = () => {};
    m.add(hull);
  }
}

export function inked(geometry, color, thickness = 0.05) {
  const mesh = new THREE.Mesh(geometry, toon(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const hull = new THREE.Mesh(geometry, outlineMaterial(thickness));
  hull.userData.isOutline = true;
  mesh.add(hull);
  return mesh;
}

// Small canvas helper for textures that should look drawn with markers.
export function canvasTexture(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
