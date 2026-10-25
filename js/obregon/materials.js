import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, color, positionWorld, mix, smoothstep, fract, sin, dot, floor, abs, length, cameraPosition } from 'three/tsl';

// js/obregon/materials.js
// The few surfaces New York's materials (js/tsl-materials.js) have no counterpart for: the bare desert soil of yards,
// vacant lots & road shoulders, the irrigated fields of the Valle del Yaqui around the city, and the concrete lining
// of the irrigation canals. All world-space, so any geometry takes them.

const hash2D = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
const noise2D = Fn(([p]) => {
  const pv = vec2(p).toVar();
  const i = floor(pv).toVar();
  const f = fract(pv).toVar();
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
  const a = hash2D(i);
  const b = hash2D(i.add(vec2(1.0, 0.0)));
  const c = hash2D(i.add(vec2(0.0, 1.0)));
  const d = hash2D(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

// Sun-baked Sonoran soil: pale tan with darker compacted patches, scattered gravel & dry grass tufts
function createDirtMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.96 });
  const cLight = color(0xc8b08a);
  const cDark = color(0x9c8462);
  const cGrass = color(0x8f8a55);
  mat.colorNode = Fn(() => {
    const p = positionWorld.xz;
    const macro = noise2D(p.mul(0.045));
    const mid = noise2D(p.mul(0.31));
    const fine = noise2D(p.mul(2.7));
    const detail = smoothstep(220.0, 20.0, length(positionWorld.sub(cameraPosition)));
    const base = mix(cDark, cLight, macro.mul(0.65).add(mid.mul(0.35)));
    const tufts = smoothstep(0.72, 0.86, noise2D(p.mul(0.9).add(vec2(13.1, 7.7)))).mul(0.55);
    return mix(base, cGrass, tufts).mul(float(0.92).add(fine.sub(0.5).mul(0.16).mul(detail)));
  })();
  return mat;
}

// The valley's fields seen from the city's edge & the air: ~200 m plots in the grid's directions, each its own crop
// (wheat gold, green, fallow, ploughed), rows running along the plot
function createFarmlandMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.95 });
  const crops = [color(0x6f8a3c), color(0x8fa84a), color(0xc9ae6a), color(0xa88e64), color(0x7a6a52), color(0x5d7a33)];
  mat.colorNode = Fn(() => {
    const p = positionWorld.xz;
    const plot = floor(p.div(vec2(210.0, 380.0)));
    const h = hash2D(plot);
    let c = crops[0];
    for (let i = 1; i < crops.length; i++) c = mix(c, crops[i], smoothstep(i / crops.length - 0.001, i / crops.length, h));
    const rowsAlongX = smoothstep(0.5, 0.51, hash2D(plot.add(vec2(5.2, 1.3))));
    const rowCoord = mix(p.x, p.y, rowsAlongX);
    const rows = abs(fract(rowCoord.div(1.6)).sub(0.5)).mul(2.0);
    const detail = smoothstep(500.0, 60.0, length(positionWorld.sub(cameraPosition)));
    const tone = noise2D(p.mul(0.02)).mul(0.25).add(0.88);
    // dirt roads between the plots
    const edge = vec2(fract(p.x.div(210.0)), fract(p.y.div(380.0)));
    const track = float(1.0).sub(smoothstep(0.0, 0.012, edge.x).mul(smoothstep(0.0, 0.007, edge.y)));
    const field = c.mul(tone).mul(float(1.0).sub(rows.mul(0.12).mul(detail)));
    return mix(field, vec3(0.62, 0.53, 0.4), track);
  })();
  return mat;
}

// Cast-in-place canal lining: weathered light concrete with slab joints and a dark algae line
function createCanalLiningMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.9 });
  mat.colorNode = Fn(() => {
    const p = positionWorld;
    const tone = noise2D(p.xz.mul(0.4)).mul(0.12).add(0.82);
    const algae = smoothstep(-0.25, -0.55, p.y);
    return mix(vec3(0.66, 0.64, 0.6).mul(tone), vec3(0.25, 0.3, 0.2), algae);
  })();
  return mat;
}

export { createDirtMaterial, createFarmlandMaterial, createCanalLiningMaterial };
