import * as THREE from 'three/webgpu';
import { uniform, color, float, smoothstep } from 'three/tsl';
import { GEO } from './geodata.js';
import { ISLAND_BOUNDS, PARKS, WATER, blockAt, pointInPoly, signalPhase } from './city-config.js';
import { rng } from './lots.js';
import { SIGNAL_SITES } from './signals.js';
import { cityUniforms } from '../tsl-materials.js';
import { createTreeField } from '../trees.js';

// js/obregon/street-details.js
// Ciudad Obregón's street furniture, in place of js/street-details.js:
// - Traffic signals at the sites signals.js picks: a pole on the far right corner of every approach with a three-lamp head facing the oncoming traffic. The north-south street (or, off
//   the grid, the widest road) runs on the "avenue" phase of the shared two-phase clock (city-config.js signalPhase),
//   the others on the "street" phase, as road-network.js groups them for traffic.js.
// - Cobra-head street lights along every street, alternating sides, lit at dusk.
// - Street trees on the sidewalks and trees scattered through the parks (trees.js; honey locusts standing in for the
//   mesquites & palo verdes, plane trees for the laureles de la India).

function buildStreetDetails(scene) {
  const group = new THREE.Group();
  group.name = 'ManhattanStreetDetails'; // (the name main.js culls the street furniture by)
  const SW = ISLAND_BOUNDS.sidewalkHeight;
  const signalClock = uniform(0);
  const footprints = [];
  const RG = GEO.roadGraph;
  const N = RG.nodes;
  const P = (i) => ({ x: N[i * 2], z: N[i * 2 + 1] });

  // Links with their polylines & lengths
  const links = RG.links.map(([a, b, ni, w, , , inner, k]) => {
    const pts = [P(a)];
    for (let i = 0; i < inner.length; i += 2) pts.push({ x: inner[i], z: inner[i + 1] });
    pts.push(P(b));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    return { a, b, name: RG.names[ni], half: w / 2, kind: RG.kinds[k], pts, len };
  });

  // Poles & trunks keep apart (and off each other's spots)
  const spots = new Map();
  const spotKey = (x, z) => Math.floor(x / 6) * 100003 + Math.floor(z / 6);
  const near = (x, z, r) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const s of spots.get(spotKey(x + dx * 6, z + dz * 6)) || []) if (Math.hypot(s.x - x, s.z - z) < r) return true;
      }
    }
    return false;
  };
  // ...and out of the mapped buildings (their footprints may reach the curb)
  const mappedCells = new Map();
  for (const bld of GEO.buildings) {
    const poly = [];
    for (let i = 0; i < bld.ring.length; i += 2) poly.push({ x: bld.ring[i], z: bld.ring[i + 1] });
    const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
    for (let ix = Math.floor(Math.min(...xs) / 32); ix <= Math.floor(Math.max(...xs) / 32); ix++) {
      for (let iz = Math.floor(Math.min(...zs) / 32); iz <= Math.floor(Math.max(...zs) / 32); iz++) {
        const k = ix * 100003 + iz;
        if (!mappedCells.has(k)) mappedCells.set(k, []);
        mappedCells.get(k).push(poly);
      }
    }
  }
  const inBuilding = (x, z) => (mappedCells.get(Math.floor(x / 32) * 100003 + Math.floor(z / 32)) || []).some((p) => pointInPoly(p, x, z));
  const claim = (x, z, size) => {
    const k = spotKey(x, z);
    if (!spots.has(k)) spots.set(k, []);
    spots.get(k).push({ x, z });
    footprints.push({ minX: x - size, maxX: x + size, minZ: z - size, maxZ: z + size });
  };

  // ---------------------------------------------------------------------------------------------------------------
  // 1. Signal heads at the signalized intersections (signals.js)
  // ---------------------------------------------------------------------------------------------------------------
  const signalized = SIGNAL_SITES;

  const poleMatrices = [];
  const headMatrices = [];
  const lampMatrices = { ave: [[], [], []], st: [[], [], []] }; // red, amber, green
  const audioSignals = [];
  const signalIntersections = [];
  const dummy = new THREE.Object3D();
  for (const s of signalized) {
    signalIntersections.push({ x: s.x, z: s.z });
    // one approach per arm: the head stands beyond the intersection on the approaching traffic's right
    const seen = [];
    for (const a of s.arms) {
      if (seen.some((o) => o.ux * a.ux + o.uz * a.uz > 0.94)) continue;
      seen.push(a);
      // the avenue phase: the north-south street where every road runs along the compass axes (as road-network.js
      // groups such junctions, city-config.js CARDINAL_JUNCTIONS), else the widest road
      const isAve = s.cardinal ? Math.abs(a.uz) > 0.966 : Math.abs(a.ux * s.main.ux + a.uz * s.main.uz) > 0.82;
      const cross = s.roads.filter((r) => Math.abs(r.ux * a.ux + r.uz * a.uz) < 0.82).reduce((m, r) => Math.max(m, r.half), 6);
      const own = s.roads.find((r) => Math.abs(r.ux * a.ux + r.uz * a.uz) >= 0.82)?.half ?? a.half;
      // traffic comes in along -u; its right is (uz, -ux)
      const px = s.x - a.ux * (cross + 2.2) + a.uz * (own + 1.1);
      const pz = s.z - a.uz * (cross + 2.2) - a.ux * (own + 1.1);
      if (!blockAt(px, pz) || inBuilding(px, pz)) continue;
      claim(px, pz, 0.3);
      dummy.position.set(px, SW + 2.6, pz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleMatrices.push(dummy.matrix.clone());
      // the head faces up the approach (+u), on the pole's road side
      const yaw = Math.atan2(a.ux, a.uz);
      for (const hy of [4.6, 2.9]) {
        dummy.position.set(px - a.uz * 0.25, SW + hy, pz + a.ux * 0.25);
        dummy.rotation.set(0, yaw, 0);
        dummy.updateMatrix();
        headMatrices.push(dummy.matrix.clone());
        for (let k = 0; k < 3; k++) {
          dummy.position.set(px - a.uz * 0.25 + a.ux * 0.2, SW + hy + 0.36 - k * 0.36, pz + a.ux * 0.25 + a.uz * 0.2);
          dummy.updateMatrix();
          lampMatrices[isAve ? 'ave' : 'st'][k].push(dummy.matrix.clone());
        }
      }
      audioSignals.push({ x: px, y: SW + 3, z: pz, isAvenue: isAve });
    }
  }

  const instanced = (geo, mat, matrices, name, shadow = true) => {
    if (!matrices.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.name = name;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const metal = new THREE.MeshStandardNodeMaterial({ color: 0x5b6067, roughness: 0.5, metalness: 0.6 });
  const housing = new THREE.MeshStandardNodeMaterial({ color: 0x1f2326, roughness: 0.6, metalness: 0.2 });
  instanced(new THREE.CylinderGeometry(0.09, 0.11, 5.2, 8), metal, poleMatrices, 'ObregonSignalPoles');
  instanced(new THREE.BoxGeometry(0.42, 1.18, 0.28), housing, headMatrices, 'ObregonSignalHeads');
  // lamps: dark lenses, lit through emissive strength set every frame from the signal clock
  const lampColors = [0xff2a1a, 0xffb21a, 0x22e07a];
  const lampLevel = { ave: [0, 1, 2].map(() => uniform(0)), st: [0, 1, 2].map(() => uniform(0)) };
  const lensGeo = new THREE.CircleGeometry(0.13, 12);
  for (const phase of ['ave', 'st']) {
    for (let k = 0; k < 3; k++) {
      const mat = new THREE.MeshStandardNodeMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.0 });
      mat.emissiveNode = color(lampColors[k]).mul(lampLevel[phase][k]).mul(6.0);
      instanced(lensGeo, mat, lampMatrices[phase][k], `ObregonSignalLamps_${phase}_${k}`, false);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 2. Street lights along every street, ~36 m apart, alternating sides, on the sidewalk by the curb
  // ---------------------------------------------------------------------------------------------------------------
  const lampPoles = [];
  const lampHeads = [];
  const treeSites = [];
  const rand = rng(424242);
  for (const l of links) {
    if (l.len < 20) continue;
    let side = 1;
    let next = 12 + rand() * 10;
    let walked = 0;
    let nextTree = 4 + rand() * 8;
    for (let i = 1; i < l.pts.length; i++) {
      const p = l.pts[i - 1], q = l.pts[i];
      const segL = Math.hypot(q.x - p.x, q.z - p.z);
      if (segL < 1e-3) continue;
      const ux = (q.x - p.x) / segL, uz = (q.z - p.z) / segL;
      while (next < walked + segL) {
        const t = next - walked;
        const off = (l.half + 0.6) * side;
        const x = p.x + ux * t - uz * off, z = p.z + uz * t + ux * off;
        if (next > 10 && next < l.len - 10 && blockAt(x, z) && !inBuilding(x, z) && !near(x, z, 8)) {
          claim(x, z, 0.25);
          lampPoles.push({ x, z });
          // the arm reaches back over the street
          lampHeads.push({ x: x + uz * side * 1.7, z: z - ux * side * 1.7, yaw: Math.atan2(-uz * side, ux * side) });
        }
        side = -side;
        next += 34 + rand() * 6;
      }
      while (nextTree < walked + segL) {
        const t = nextTree - walked;
        nextTree += 9 + rand() * 9;
        if (rand() < 0.5) continue;
        const s = rand() < 0.5 ? 1 : -1;
        const off = (l.half + 1.5) * s;
        const x = p.x + ux * t - uz * off, z = p.z + uz * t + ux * off;
        if (t + walked < 8 || t + walked > l.len - 8 || !blockAt(x, z) || inBuilding(x, z) || near(x, z, 4.5)) continue;
        claim(x, z, 0.35);
        const r = rand();
        treeSites.push({ x, y: SW, z, scale: 0.55 + rand() * 0.3, species: r < 0.65 ? 1 : r < 0.92 ? 0 : 2, yaw: rand() * Math.PI * 2, tier: 2 });
      }
      walked += segL;
    }
  }
  if (lampPoles.length) {
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.13, 8.5, 8);
    poleGeo.translate(0, 4.25, 0);
    const m = new THREE.Matrix4();
    instanced(poleGeo, metal, lampPoles.map((p) => m.clone().makeTranslation(p.x, SW, p.z)), 'ObregonLampPoles');
    const armGeo = new THREE.BoxGeometry(0.07, 0.07, 1.9);
    const headGeo = new THREE.BoxGeometry(0.34, 0.14, 0.7);
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    instanced(armGeo, metal, lampPoles.map((p, i) => {
      const h = lampHeads[i];
      return new THREE.Matrix4().compose(new THREE.Vector3((p.x + h.x) / 2, SW + 8.4, (p.z + h.z) / 2), q.setFromAxisAngle(up, h.yaw), one);
    }), 'ObregonLampArms');
    const glow = new THREE.MeshStandardNodeMaterial({ color: 0x3a3a3a, roughness: 0.4, metalness: 0.3 });
    // sodium-orange glow from dusk (the interior glow uniform follows the time of day, lighting.js)
    glow.emissiveNode = color(0xffb35c).mul(smoothstep(float(0.55), float(1.2), cityUniforms.uInteriorGlow)).mul(9.0);
    instanced(headGeo, glow, lampHeads.map((h) => new THREE.Matrix4().compose(new THREE.Vector3(h.x, SW + 8.32, h.z), q.setFromAxisAngle(up, h.yaw), one)), 'ObregonLampHeads');
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 3. Park trees, ~1 per 220 m² of lawn, kept off the paths' middle by chance alone
  // ---------------------------------------------------------------------------------------------------------------
  for (const park of PARKS) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, area = 0;
    for (let i = 0, j = park.poly.length - 1; i < park.poly.length; j = i++) {
      const p = park.poly[i];
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      area += park.poly[j].x * p.z - p.x * park.poly[j].z;
    }
    if (/pitch|stadium/.test(park.kind)) continue; // playing fields stay open
    const n = Math.min(400, Math.round(Math.abs(area / 2) / 220));
    for (let k = 0, tries = 0; k < n && tries < n * 4; tries++) {
      const x = minX + rand() * (maxX - minX), z = minZ + rand() * (maxZ - minZ);
      if (!pointInPoly(park.poly, x, z) || inBuilding(x, z) || WATER.some((w) => pointInPoly(w.poly, x, z)) || near(x, z, 5)) continue;
      claim(x, z, 0.4);
      const b = blockAt(x, z);
      const r = rand();
      treeSites.push({ x, y: b ? SW : 0, z, scale: 0.6 + rand() * 0.45, species: r < 0.45 ? 0 : r < 0.9 ? 1 : 2, yaw: rand() * Math.PI * 2, tier: 0 });
      k++;
    }
  }
  const trees = treeSites.length ? createTreeField(scene, treeSites) : null;
  if (trees) group.add(trees.group);
  console.info(`[obregon] ${signalized.length} signalized intersections, ${lampPoles.length} street lights, ${treeSites.length} trees`);

  // The lamps follow the two-phase clock (main.js advances signalClock)
  let lastPhase = '';
  function update() {
    const t = signalClock.value;
    const ave = signalPhase(t, true);
    const st = signalPhase(t, false);
    const key = ave + st;
    if (key === lastPhase) return;
    lastPhase = key;
    const set = (levels, phase) => {
      levels[0].value = phase === 'red' ? 1 : 0;
      levels[1].value = phase === 'amber' ? 1 : 0;
      levels[2].value = phase === 'green' ? 1 : 0;
    };
    set(lampLevel.ave, ave);
    set(lampLevel.st, st);
  }
  update();

  scene.add(group);
  return { group, footprints, signalClock, signalIntersections, audioSignals, update };
}

export { buildStreetDetails };
