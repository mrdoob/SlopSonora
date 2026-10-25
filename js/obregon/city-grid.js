import * as THREE from 'three/webgpu';
import { GEO } from './geodata.js';
import { BLOCKS, PARKS, WATER, ISLAND_BOUNDS } from './city-config.js';
import { createRoadSurfaceMaterial, createSidewalkMaterial, createCurbMaterial, createParkLawnMaterial, createWaterMaterial } from '../tsl-materials.js';
import { createDirtMaterial, createCanalLiningMaterial } from './materials.js';

// js/obregon/city-grid.js
// Ciudad Obregón's ground, in place of js/city-grid.js: the street pavement along every road centreline at its
// curb-to-curb width (js/obregon/geodata.js), the blocks as raised curb islands (sidewalk ring, then the yards behind
// the building line), the parks & plazas, the Laguna del Náinari and the ponds sunk into the ground, and the irrigation
// canals. Everything is merged into one mesh per material.

const ROAD_Y = 0.0;
const GROUND_Y = -0.03;
const CANAL_Y = -0.015;
const PARK_GROUND_Y = -0.008;
const WATER_Y = -0.7;

// Accumulates triangles for one material
class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
  }
  tri(a, b, c, n) {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.nrm.push(...n);
  }
  // A horizontal polygon (x/z points, with optional holes) at height y, facing up
  flat(pts, y, holes = []) {
    if (pts.length < 3) return;
    const contour = pts.map((p) => new THREE.Vector2(p.x, p.z));
    const holeV = holes.map((h) => h.map((p) => new THREE.Vector2(p.x, p.z)));
    const all = [...contour, ...holeV.flat()];
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holeV)) {
      const a = all[i], b = all[j], c = all[k];
      // counter-clockwise seen from above (+y): (b - a) x (c - a) points up
      const up = (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y);
      if (up >= 0) this.tri([a.x, y, a.y], [b.x, y, b.y], [c.x, y, c.y], [0, 1, 0]);
      else this.tri([a.x, y, a.y], [c.x, y, c.y], [b.x, y, b.y], [0, 1, 0]);
    }
  }
  // A vertical wall along a closed ring from y0 to y1, facing away from the ring's inside (or into it: inward)
  walls(pts, y0, y1, inward = false) {
    let area = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const ex = q.x - p.x;
      const ez = q.z - p.z;
      const L = Math.hypot(ex, ez);
      if (L < 1e-4) continue;
      // outward normal of a ring with positive area (x/z shoelace) is (ez, -ex) / L
      let nx = (ez / L) * Math.sign(area);
      let nz = (-ex / L) * Math.sign(area);
      if (inward) {
        nx = -nx;
        nz = -nz;
      }
      const a = [p.x, y0, p.z], b = [q.x, y0, q.z], c = [q.x, y1, q.z], d = [p.x, y1, p.z];
      // (b - a) x (c - a) points along (-ez, ex): keep that winding when it faces (nx, nz), else turn it round
      if (-ez * nx + ex * nz > 0) {
        this.tri(a, b, c, [nx, 0, nz]);
        this.tri(a, c, d, [nx, 0, nz]);
      } else {
        this.tri(a, c, b, [nx, 0, nz]);
        this.tri(a, d, c, [nx, 0, nz]);
      }
    }
  }
  // A horizontal strip quad from (x0, z0) to (x1, z1), `half` wide each side, at height y
  strip(x0, z0, x1, z1, half, y) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 1e-4) return;
    const nx = (-(z1 - z0) / L) * half;
    const nz = ((x1 - x0) / L) * half;
    this.flat([
      { x: x0 + nx, z: z0 + nz }, { x: x1 + nx, z: z1 + nz }, { x: x1 - nx, z: z1 - nz }, { x: x0 - nx, z: z0 - nz }
    ], y);
  }
  // A horizontal disc (n-gon) of radius r at height y
  disc(x, z, r, y, n = 14) {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push({ x: x + Math.cos((i / n) * Math.PI * 2) * r, z: z + Math.sin((i / n) * Math.PI * 2) * r });
    this.flat(pts, y);
  }
  mesh(material, name, { castShadow = false, receiveShadow = true } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const m = new THREE.Mesh(g, material);
    m.name = name;
    m.castShadow = castShadow;
    m.receiveShadow = receiveShadow;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}

const toPts = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], z: flat[i + 1] });
  return out;
};
function buildCityGrid(scene) {
  const group = new THREE.Group();
  group.name = 'ManhattanCityGrid'; // (the name main.js culls the city ground by)
  const SW = ISLAND_BOUNDS.sidewalkHeight;

  // 2. Ground: the detailed area's soil, with the lagoon & ponds cut out
  const ground = new MeshBuilder();
  const box = [
    { x: ISLAND_BOUNDS.minX, z: ISLAND_BOUNDS.minZ }, { x: ISLAND_BOUNDS.maxX, z: ISLAND_BOUNDS.minZ },
    { x: ISLAND_BOUNDS.maxX, z: ISLAND_BOUNDS.maxZ }, { x: ISLAND_BOUNDS.minX, z: ISLAND_BOUNDS.maxZ }
  ];
  const lakes = WATER.filter((w) => w.poly.every((p) => p.x > ISLAND_BOUNDS.minX && p.x < ISLAND_BOUNDS.maxX && p.z > ISLAND_BOUNDS.minZ && p.z < ISLAND_BOUNDS.maxZ));
  ground.flat(box, GROUND_Y, lakes.map((w) => w.poly));
  for (const w of lakes) ground.walls(w.poly, WATER_Y - 0.6, GROUND_Y, true);
  const water = new MeshBuilder();
  for (const w of lakes) water.flat(w.poly, WATER_Y);

  // 3. Street pavement: a strip per centreline segment, discs filling the joints & intersections
  const road = new MeshBuilder();
  const RG = GEO.roadGraph;
  const nodeHalf = new Float32Array(RG.nodes.length / 2);
  for (const [a, b, , w, , , inner] of RG.links) {
    const pts = [{ x: RG.nodes[a * 2], z: RG.nodes[a * 2 + 1] }, ...toPts(inner), { x: RG.nodes[b * 2], z: RG.nodes[b * 2 + 1] }];
    const half = w / 2;
    nodeHalf[a] = Math.max(nodeHalf[a], half);
    nodeHalf[b] = Math.max(nodeHalf[b], half);
    for (let i = 1; i < pts.length; i++) {
      road.strip(pts[i - 1].x, pts[i - 1].z, pts[i].x, pts[i].z, half, ROAD_Y);
      if (i < pts.length - 1) road.disc(pts[i].x, pts[i].z, half, ROAD_Y, 10);
    }
  }
  for (let i = 0; i < nodeHalf.length; i++) if (nodeHalf[i] > 0) road.disc(RG.nodes[i * 2], RG.nodes[i * 2 + 1], nodeHalf[i], ROAD_Y);

  // 4. Curb islands: the sidewalk ring on top, the curb face round it, the yards behind the building line
  const sidewalk = new MeshBuilder();
  const curb = new MeshBuilder();
  const yard = new MeshBuilder();
  for (const b of BLOCKS) {
    if (b.water) continue;
    if (b.lot) {
      sidewalk.flat(b.poly, SW, [b.lot]);
      yard.flat(b.lot, SW + 0.002);
    } else {
      sidewalk.flat(b.poly, SW);
    }
    curb.walls(b.poly, ROAD_Y - 0.05, SW);
  }

  // 5. Parks & plazas: lawn on their curb island, or on the ground
  const lawn = new MeshBuilder();
  for (const p of PARKS) lawn.flat(p.poly, p.block && !p.block.water ? SW + 0.006 : PARK_GROUND_Y);

  // 6. Irrigation canals: water between concrete linings, under the street pavement where streets cross them
  const canalWater = new MeshBuilder();
  const lining = new MeshBuilder();
  for (const c of GEO.canals) {
    const pts = toPts(c.pts);
    for (let i = 1; i < pts.length; i++) {
      lining.strip(pts[i - 1].x, pts[i - 1].z, pts[i].x, pts[i].z, c.w / 2 + 1.2, CANAL_Y - 0.004);
      canalWater.strip(pts[i - 1].x, pts[i - 1].z, pts[i].x, pts[i].z, c.w / 2, CANAL_Y);
      if (i < pts.length - 1) canalWater.disc(pts[i].x, pts[i].z, c.w / 2, CANAL_Y, 10);
    }
  }

  const dirt = createDirtMaterial();
  const waterMat = createWaterMaterial();
  group.add(ground.mesh(dirt, 'ObregonGround'));
  group.add(water.mesh(waterMat, 'ObregonLagoons'));
  group.add(road.mesh(createRoadSurfaceMaterial(), 'ObregonStreets'));
  group.add(sidewalk.mesh(createSidewalkMaterial(), 'ObregonSidewalks'));
  group.add(curb.mesh(createCurbMaterial(), 'ObregonCurbs'));
  group.add(yard.mesh(dirt, 'ObregonYards'));
  group.add(lawn.mesh(createParkLawnMaterial(), 'ObregonParks'));
  group.add(lining.mesh(createCanalLiningMaterial(), 'ObregonCanalLining'));
  group.add(canalWater.mesh(waterMat, 'ObregonCanals'));
  scene.add(group);

  // The road network bounds the lanes by the street widths themselves, so no curb rectangles; nothing at grade blocks
  // the streets and there are no expressways
  return { group, sidewalks: [], footprints: [], colliders: [], highwayLanes: [] };
}

export { buildCityGrid, MeshBuilder };
