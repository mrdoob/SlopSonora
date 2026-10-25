import * as THREE from 'three/webgpu';
import { GEO } from './geodata.js';
import { ISLAND_BOUNDS } from './city-config.js';
import { createPreWarBuildingMaterial, createCurtainWallMaterial } from '../tsl-materials.js';

// js/obregon/landmarks.js
// The buildings OpenStreetMap maps in Ciudad Obregón, in place of js/landmarks.js: their real footprints extruded to
// their mapped storeys, or to a height typical of their kind (the Catedral del Sagrado Corazón de Jesús, the Palacio
// Municipal, ITSON's campus, the hospitals, the malls & supermarkets...). One merged mesh per facade style.

// Height (m) by kind, when OSM gives neither height nor storeys
const KIND_HEIGHT = {
  place_of_worship: 15, church: 15, cathedral: 18, chapel: 9, townhall: 11, courthouse: 9, hospital: 13,
  university: 9, school: 7, college: 9, library: 8, commercial: 8, retail: 8, warehouse: 8, cinema: 10,
  marketplace: 7, bank: 7, civic: 9, roof: 4.5, yes: 6.5
};

// Facade styles: whitewashed civic & religious stucco, warm institutional stucco, glazed commercial
const STYLES = {
  civic: { stoneColor: 0xf1ebdc, trimColor: 0xb59f78, seed: 3 },
  institution: { stoneColor: 0xe0c8a0, trimColor: 0x9c7b52, seed: 5 },
  shed: { stoneColor: 0xc9c5bc, trimColor: 0x8b877f, seed: 9 }
};
function styleOf(kind) {
  if (/place_of_worship|church|cathedral|chapel|townhall|courthouse|civic|library/.test(kind)) return 'civic';
  if (/warehouse|roof|commercial|retail|yes/.test(kind)) return 'shed';
  return 'institution';
}

// Bryant Park's lawn has no counterpart in Obregón (cameras.js & controllers.js read it)
const bryantParkLawn = null;

function buildLandmarks(scene) {
  const group = new THREE.Group();
  group.name = 'ManhattanLandmarks'; // (the name main.js culls the landmarks by)
  const SW = ISLAND_BOUNDS.sidewalkHeight;
  const colliders = [];
  const geos = { civic: [], institution: [], shed: [], glass: [] };

  for (const b of GEO.buildings) {
    const pts = [];
    for (let i = 0; i < b.ring.length; i += 2) pts.push(new THREE.Vector2(b.ring[i], -b.ring[i + 1]));
    if (pts.length < 3) continue;
    let h = b.h || (b.levels ? b.levels * 3.6 + 0.8 : KIND_HEIGHT[b.kind] ?? 6.5);
    if (/Catedral/.test(b.name)) h = Math.max(h, 22);
    // the shape lies in x / -z so that, extruded along +z and turned to stand up, it lands on the right spot
    const shape = new THREE.Shape(pts);
    let geo;
    try {
      geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    } catch {
      continue;
    }
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, SW, 0);
    geo.deleteAttribute('uv');
    const style = /mall|Plaza|Soriana|Walmart|Sam's|Liverpool|Cin/.test(b.name) ? 'glass' : styleOf(b.kind);
    geos[style].push(geo.index ? geo.toNonIndexed() : geo);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, -p.y); maxZ = Math.max(maxZ, -p.y);
    }
    colliders.push({ minX, maxX, minZ, maxZ, minY: 0, maxY: SW + h });
  }

  const materials = {
    civic: createPreWarBuildingMaterial({ ...STYLES.civic, windowWidth: 3.6, floorHeight: 4.2, windowRatioX: 0.36, windowRatioY: 0.55, litProbability: 0.3 }),
    institution: createPreWarBuildingMaterial({ ...STYLES.institution, windowWidth: 3.2, floorHeight: 3.6, litProbability: 0.45 }),
    shed: createPreWarBuildingMaterial({ ...STYLES.shed, windowWidth: 4.5, floorHeight: 4.5, windowRatioX: 0.3, windowRatioY: 0.3, litProbability: 0.2 }),
    glass: createCurtainWallMaterial({ glassTint: 0x274a5c, frameTint: 0x8c9196, floorHeight: 4.2, seed: 17 })
  };
  for (const [style, list] of Object.entries(geos)) {
    if (!list.length) continue;
    const merged = mergeNonIndexed(list);
    const mesh = new THREE.Mesh(merged, materials[style]);
    mesh.name = `ObregonLandmarks_${style}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }
  scene.add(group);
  return { group, colliders };
}

// Concatenates non-indexed geometries' positions & normals
function mergeNonIndexed(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.computeBoundingSphere();
  return out;
}

export { buildLandmarks, bryantParkLawn };
