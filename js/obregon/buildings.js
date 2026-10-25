import * as THREE from 'three/webgpu';
import { ISLAND_BOUNDS } from './city-config.js';
import { planLots, corners, rng } from './lots.js';
import { createPreWarBuildingMaterial, createFacadeBoxes, WALL_KINDS } from '../tsl-materials.js';

// js/obregon/buildings.js
// Ciudad Obregón's ordinary buildings, in place of js/buildings.js, on the lots lots.js plans along every block's
// building line: flat-roofed one- and two-storey houses in stucco colours with their door on the street, shops on the
// ground floor downtown and along the avenues, two- and three-storey commercial buildings near the plaza, and the
// black water tanks (tinacos) on many roofs. One instanced facade mesh per colour.

// Stucco & paint colours of Sonoran houses, with the trim drawn around their openings
const PALETTE = [
  [0xeee6d6, 0xb9ab92], // cal white
  [0xe3cfa8, 0xa98f63], // sand
  [0xd8b48c, 0x9b7650], // adobe tan
  [0xc98d6c, 0x8c5a40], // terracotta
  [0xe6d38f, 0xa8924f], // mustard
  [0xb8c8a8, 0x7e8f6e], // sage
  [0xa9bfcc, 0x6e8594], // sky blue
  [0xd9a7a0, 0x9e6e68] // rose
];

function buildCityBlocks(scene) {
  const group = new THREE.Group();
  group.name = 'ManhattanCityBlocks'; // (the name main.js culls the city's buildings by)
  const SW = ISLAND_BOUNDS.sidewalkHeight;
  const colliders = [];
  const boxesByStyle = PALETTE.map(() => []);
  const tanks = [];
  const { lots } = planLots();

  for (const lot of lots) {
    const rand = rng(Math.floor(lot.seed * 4294967296));
    const { cx, cz, ux, uz, nx, nz, hu, hv, floors, commercial } = lot;
    const floorH = commercial ? 3.9 : 3.15;
    const h = floors * floorH + (floors === 1 && commercial ? 1.2 : 0.45); // sign band / parapet
    // Box-local frame: x along the street front; local +z points along (-uz, ux), the street side is -n
    const ry = Math.atan2(-uz, ux);
    const frontPlusZ = -uz * -nx + ux * -nz > 0;
    const front = commercial && (floors > 1 || rand() < 0.85) ? WALL_KINDS.shop : WALL_KINDS.entry;
    const faces = [WALL_KINDS.lotLine, WALL_KINDS.lotLine, frontPlusZ ? WALL_KINDS.rear : front, frontPlusZ ? front : WALL_KINDS.rear];
    const style = Math.floor(rand() * PALETTE.length);
    boxesByStyle[style].push({ x: cx, y: SW + h / 2, z: cz, w: hu * 2, h, d: hv * 2, ry, faces, tone: rand() });
    // a tinaco on the roof, toward the back
    if (rand() < 0.6) {
      const t = 0.35 + rand() * 0.4;
      tanks.push({ x: cx + nx * hv * t + ux * (rand() - 0.5) * hu, y: SW + h, z: cz + nz * hv * t + uz * (rand() - 0.5) * hu, s: 0.8 + rand() * 0.35 });
    }
    const Q = corners(cx, cz, ux, uz, hu, hv);
    colliders.push({
      minX: Math.min(...Q.map((p) => p.x)), maxX: Math.max(...Q.map((p) => p.x)),
      minZ: Math.min(...Q.map((p) => p.z)), maxZ: Math.max(...Q.map((p) => p.z)),
      minY: 0, maxY: SW + h, obb: { cx, cz, hx: hu, hz: hv, cs: Math.cos(ry), sn: Math.sin(ry) }
    });
  }

  // One instanced facade mesh per colour (box-local walls: whole window bays per wall, doors & shopfronts on the
  // street side, plain walls on the lot lines & at the back)
  PALETTE.forEach(([stone, trim], i) => {
    if (!boxesByStyle[i].length) return;
    const mat = createPreWarBuildingMaterial({
      stoneColor: stone, trimColor: trim, windowGlassColor: 0x1d2a33, windowWidth: 3.3, floorHeight: 3.15,
      windowRatioX: 0.42, windowRatioY: 0.5, litProbability: 0.4, warmth: 0.9, seed: 11 + i * 7, boxLocal: true,
      cornerPier: 0.5, stucco: true
    });
    const mesh = createFacadeBoxes(mat, boxesByStyle[i]);
    mesh.name = `ObregonHouses_${i}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  // Tinacos: black polyethylene water tanks on a short stand
  if (tanks.length) {
    const geo = new THREE.CylinderGeometry(0.62, 0.55, 1.3, 12);
    geo.translate(0, 0.65 + 0.25, 0);
    const mat = new THREE.MeshStandardNodeMaterial({ color: 0x1b1c1e, roughness: 0.55, metalness: 0.0 });
    const mesh = new THREE.InstancedMesh(geo, mat, tanks.length);
    const m = new THREE.Matrix4();
    tanks.forEach((t, i) => mesh.setMatrixAt(i, m.makeScale(t.s, t.s, t.s).setPosition(t.x, t.y, t.z)));
    mesh.name = 'ObregonTinacos';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  console.info(`[obregon] ${lots.length} houses & shops, ${tanks.length} tinacos`);

  scene.add(group);
  return { group, colliders, allBlocks: [], update() {} };
}

export { buildCityBlocks };
