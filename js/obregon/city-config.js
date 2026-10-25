import { GEO } from './geodata.js';

// js/obregon/city-config.js
// Ciudad Obregón's spatial configuration, in place of js/city-config.js (obregon.html maps one onto the other), from
// the OpenStreetMap geography in js/obregon/geodata.js (tools/build-obregon.mjs).
//
// World frame: 1 unit = 1 m, x = grid east, z = grid south (north = -z), origin at Plaza Álvaro Obregón. The street
// grid runs within a tenth of a degree of true north. Only the detailed area (GEO.frame) is built.
//
// The shared modules (traffic, controllers, materials, road network) read the same names as from New York's
// configuration; the ones describing Manhattan's grid & shores are empty or stand for the detailed area here.

const CITY_ID = 'obregon';
const F = GEO.frame;
const toPts = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], z: flat[i + 1] });
  return out;
};

// The detailed area stands in for the island: the players, the road network & the water material keep inside it
const ISLAND_BOUNDS = { minX: F.minX, maxX: F.maxX, minZ: F.minZ, maxZ: F.maxZ, sidewalkHeight: 0.18, waterLevel: -1.2 };
function getIslandBoundsAtZ() {
  return { westX: F.minX, eastX: F.maxX };
}
// No Central Park, Manhattan grid, New Jersey or Long Island here (tsl-materials.js, controllers.js, road-network.js)
const CENTRAL_PARK_BOUNDS = { minX: 1e7, maxX: 1e7 + 1, minZ: 1e7, maxZ: 1e7 + 1 };
const NJ_SHORELINE_POLYGON = [];
const LONG_ISLAND_POLYGONS = [];
const ALL_AVENUES = [];
const ALL_STREETS = [];
// (New York's numbered streets: 80 m apart, far out of the city, so the materials' Central Park terms stay empty)
const streetZ = (n) => 1e7 + n * 80;
// Low-rise and wide open: street level sees most of the sky (tsl-materials.js canyonSkyAONode)
const STREET_CANYON = 0.25;

// ---------------------------------------------------------------------------------------------------------------------
// Blocks: the curb islands between the streets (curb outline `poly`, building line `lot`), with a lookup grid
// ---------------------------------------------------------------------------------------------------------------------
// (`water`, `parkArea`: see below)
const BLOCKS = GEO.blocks.map((b, id) => {
  const poly = toPts(b.c);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  return { id, poly, lot: b.l ? toPts(b.l) : null, minX, maxX, minZ, maxZ, park: 0 };
});

// Blocks under water (the lagoon is a face of the street graph too) are lagoon; the parks whose middle lies in a block
// are laid on its curb island, and one filling most of it makes the block a park (no houses, lots.js)
const PARKS = GEO.parks.map((p) => ({ name: p.name, kind: p.kind, poly: toPts(p.ring) }));
const WATER = GEO.water.map((w) => ({ name: w.name, poly: toPts(w.ring) }));
const centroid = (pts) => {
  let x = 0, z = 0;
  for (const p of pts) { x += p.x; z += p.z; }
  return { x: x / pts.length, z: z / pts.length };
};
const ringArea = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  return Math.abs(a / 2);
};
const BLOCK_CELL = 64;
const blockCells = new Map();
const cellKey = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
for (const b of BLOCKS) {
  for (let ix = Math.floor(b.minX / BLOCK_CELL); ix <= Math.floor(b.maxX / BLOCK_CELL); ix++) {
    for (let iz = Math.floor(b.minZ / BLOCK_CELL); iz <= Math.floor(b.maxZ / BLOCK_CELL); iz++) {
      const k = cellKey(ix, iz);
      if (!blockCells.has(k)) blockCells.set(k, []);
      blockCells.get(k).push(b);
    }
  }
}
function pointInPoly(P, x, z) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i];
    const c = P[j];
    if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
// The block whose curb island holds (x, z), or null on the roadway
function blockAt(x, z) {
  for (const b of blockCells.get(cellKey(Math.floor(x / BLOCK_CELL), Math.floor(z / BLOCK_CELL))) || []) {
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && pointInPoly(b.poly, x, z)) return b;
  }
  return null;
}

// (the share of a block under water, sampled on a grid of up to ~400 points)
function waterShare(b) {
  const near = WATER.filter((w) => w.poly.some((p) => p.x > b.minX - 50 && p.x < b.maxX + 50 && p.z > b.minZ - 50 && p.z < b.maxZ + 50) ||
    pointInPoly(w.poly, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2));
  if (!near.length) return 0;
  const step = Math.max(2, Math.sqrt(((b.maxX - b.minX) * (b.maxZ - b.minZ)) / 400));
  let inBlock = 0, wet = 0;
  for (let x = b.minX + step / 2; x < b.maxX; x += step) {
    for (let z = b.minZ + step / 2; z < b.maxZ; z += step) {
      if (!pointInPoly(b.poly, x, z)) continue;
      inBlock++;
      if (near.some((w) => pointInPoly(w.poly, x, z))) wet++;
    }
  }
  return inBlock ? wet / inBlock : 0;
}
for (const b of BLOCKS) {
  b.water = waterShare(b) > 0.25;
  b.parkArea = 0;
}
// ...and no curb island to stand on: blockAt never returns them (the shared modules treat any block as sidewalk)
for (const [k, list] of blockCells) blockCells.set(k, list.filter((b) => !b.water));
for (const p of PARKS) {
  const c = centroid(p.poly);
  p.block = blockAt(c.x, c.z);
  if (p.block) p.block.parkArea += ringArea(p.poly);
}

// ---------------------------------------------------------------------------------------------------------------------
// Streets: the named road centrelines, for location labels & the map
// ---------------------------------------------------------------------------------------------------------------------
const RG = GEO.roadGraph;
const ROAD_SEGMENTS = []; // { x0, z0, x1, z1, name, w, kind }
for (const [a, b, ni, w, , , inner, k] of RG.links) {
  const pts = [{ x: RG.nodes[a * 2], z: RG.nodes[a * 2 + 1] }, ...toPts(inner), { x: RG.nodes[b * 2], z: RG.nodes[b * 2 + 1] }];
  for (let i = 1; i < pts.length; i++) {
    ROAD_SEGMENTS.push({ x0: pts[i - 1].x, z0: pts[i - 1].z, x1: pts[i].x, z1: pts[i].z, name: RG.names[ni], w, kind: RG.kinds[k] });
  }
}
const ROADS = [...new Set(ROAD_SEGMENTS.map((s) => s.name).filter(Boolean))].map((name) => ({ name }));
const SEG_CELL = 100;
const segCells = new Map();
for (const s of ROAD_SEGMENTS) {
  for (let ix = Math.floor(Math.min(s.x0, s.x1) / SEG_CELL); ix <= Math.floor(Math.max(s.x0, s.x1) / SEG_CELL); ix++) {
    for (let iz = Math.floor(Math.min(s.z0, s.z1) / SEG_CELL); iz <= Math.floor(Math.max(s.z0, s.z1) / SEG_CELL); iz++) {
      const k = cellKey(ix, iz);
      if (!segCells.has(k)) segCells.set(k, []);
      segCells.get(k).push(s);
    }
  }
}
function segDist(s, x, z) {
  const ex = s.x1 - s.x0;
  const ez = s.z1 - s.z0;
  const t = Math.max(0, Math.min(1, ((x - s.x0) * ex + (z - s.z0) * ez) / (ex * ex + ez * ez || 1)));
  return Math.hypot(s.x0 + ex * t - x, s.z0 + ez * t - z);
}
// The named streets nearest (x, z), each once, nearest first: [{ name, d }]
function nearestRoads(x, z, radius = 120) {
  const best = new Map();
  const r = Math.ceil(radius / SEG_CELL);
  const ix0 = Math.floor(x / SEG_CELL);
  const iz0 = Math.floor(z / SEG_CELL);
  for (let ix = ix0 - r; ix <= ix0 + r; ix++) {
    for (let iz = iz0 - r; iz <= iz0 + r; iz++) {
      for (const s of segCells.get(cellKey(ix, iz)) || []) {
        if (!s.name) continue;
        const d = segDist(s, x, z);
        if (d <= radius && d < (best.get(s.name) ?? Infinity)) best.set(s.name, d);
      }
    }
  }
  return [...best.entries()].map(([name, d]) => ({ name, d })).sort((a, b) => a.d - b.d);
}
// Street-sign style: "Calle Sonora" reads "Sonora", "Avenida Miguel Alemán" reads "Av. Miguel Alemán"
function signName(name) {
  return name.replace(/^Calle\s+/i, '').replace(/^Avenida\s+/i, 'Av. ').replace(/^Boulevard\s+/i, 'Blvd. ');
}

// ---------------------------------------------------------------------------------------------------------------------
// Places: the landmarks (named mapped buildings & places), parks & plazas, and the teleport destinations
// ---------------------------------------------------------------------------------------------------------------------
const LANDMARK_KINDS = /place_of_worship|church|cathedral|chapel|townhall|university|hospital|library|stadium|marketplace|monument|memorial|courthouse/;
const NYC_LANDMARKS = []; // (the name main.js & the map know the city's landmarks by)
{
  const seen = new Set();
  const add = (name, x, z, kind) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    NYC_LANDMARKS.push({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, short: name, x, z, kind });
  };
  for (const b of GEO.buildings) if (b.name && LANDMARK_KINDS.test(b.kind)) add(b.name, ...Object.values(centroid(toPts(b.ring))), b.kind);
  for (const p of GEO.pois) if (LANDMARK_KINDS.test(p.kind) || /hotel|mall/.test(p.kind)) add(p.name, p.x, p.z, p.kind);
  for (const p of PARKS) if (p.name && p.name !== 'Parque' && /park|stadium|sports_centre/.test(p.kind)) add(p.name, ...Object.values(centroid(p.poly)), p.kind);
  for (const w of WATER) if (w.name) add(w.name, ...Object.values(centroid(w.poly)), 'water');
}

// The named park, plaza or water body at (x, z)
function placeAt(x, z) {
  for (const w of WATER) if (w.name && pointInPoly(w.poly, x, z)) return w.name;
  for (const p of PARKS) if (p.name && p.name !== 'Parque' && pointInPoly(p.poly, x, z)) return p.name;
  return '';
}

// "Place · Street & Street", "Street & Street" or "near Street" (main.js renders them as street signs)
function getLocationLabel(x, z) {
  const place = placeAt(x, z);
  const roads = nearestRoads(x, z, 90);
  let streets = '';
  if (roads.length >= 2 && roads[1].d < 45) streets = `${signName(roads[0].name)} & ${signName(roads[1].name)}`;
  else if (roads.length) streets = roads[0].d < 25 ? signName(roads[0].name) : `near ${signName(roads[0].name)}`;
  if (place) return streets ? `${place} · ${streets}` : place;
  return streets || 'Ciudad Obregón';
}

const landmark = (re) => NYC_LANDMARKS.find((l) => re.test(l.name)) || { x: 0, z: 0 };
// The point on a street nearest a place (for places like the lagoon, whose middle is no place to arrive)
function streetNear(p) {
  let best = { x: p.x, z: p.z }, bd = Infinity;
  for (const s of ROAD_SEGMENTS) {
    const ex = s.x1 - s.x0, ez = s.z1 - s.z0;
    const t = Math.max(0, Math.min(1, ((p.x - s.x0) * ex + (p.z - s.z0) * ez) / (ex * ex + ez * ez || 1)));
    const x = s.x0 + ex * t, z = s.z0 + ez * t;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < bd) { bd = d; best = { x, z }; }
  }
  return best;
}
const TELEPORT_LOCATIONS = {
  plaza: { x: 0, z: 40, heading: Math.PI },
  catedral: { ...landmark(/Catedral/), heading: Math.PI },
  palacio: { ...landmark(/Palacio Municipal/), heading: Math.PI },
  nainari: { ...streetNear(landmark(/Laguna del N/)), heading: Math.PI / 2 },
  itson: { ...landmark(/Instituto Tecnol|Rector/), heading: Math.PI },
  mercajeme: { ...landmark(/MerCajeme/), heading: Math.PI },
  estadio: { ...landmark(/Estadio Tom/), heading: Math.PI }
};

// Where a first visit starts: on Avenida Jalisco (one-way, southbound) a few blocks east of the plaza, facing south
const PLAYER_SPAWN = (() => {
  let best = null;
  for (const s of ROAD_SEGMENTS) {
    if (s.name !== 'Avenida Jalisco' || Math.abs(s.x1 - s.x0) > 2) continue;
    const z = -160;
    if (z < Math.min(s.z0, s.z1) || z > Math.max(s.z0, s.z1)) continue;
    best = { x: s.x0 + ((s.x1 - s.x0) * (z - s.z0)) / (s.z1 - s.z0 || 1), z };
  }
  return best || { x: 395, z: -160 };
})();

// What the HUD calls the player in each mode
const PLAYER_LABELS = { person: 'Pedestrian', car: 'Taxi', cyclist: 'Cyclist', helicopter: 'Helicopter' };

// ---------------------------------------------------------------------------------------------------------------------
// Signals: a two-phase clock shared by every signalized intersection (as in New York's configuration)
// ---------------------------------------------------------------------------------------------------------------------
const SIGNAL_TIMING = { cycle: 60, avenueAmber: 26, avenueRed: 30, streetAmber: 56, walk: 7 };
function signalPhase(time, isAvenue) {
  const { cycle, avenueAmber, avenueRed, streetAmber } = SIGNAL_TIMING;
  const t = ((time % cycle) + cycle) % cycle;
  if (isAvenue) return t < avenueAmber ? 'green' : t < avenueRed ? 'amber' : 'red';
  return t < avenueRed ? 'red' : t < streetAmber ? 'green' : 'amber';
}
function walkSignal(time, isAvenue) {
  const { cycle, avenueRed, walk } = SIGNAL_TIMING;
  const t = (((time - (isAvenue ? 0 : avenueRed)) % cycle) + cycle) % cycle;
  return t < walk;
}

// Keyboard shortcuts are ignored while typing into a form field (e.g. the map's street search box)
function isTypingInField(e) {
  return e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT');
}

export {
  CITY_ID,
  PLAYER_SPAWN,
  PLAYER_LABELS,
  STREET_CANYON,
  ISLAND_BOUNDS,
  getIslandBoundsAtZ,
  CENTRAL_PARK_BOUNDS,
  NJ_SHORELINE_POLYGON,
  LONG_ISLAND_POLYGONS,
  ALL_AVENUES,
  ALL_STREETS,
  BLOCKS,
  PARKS,
  WATER,
  ROADS,
  ROAD_SEGMENTS,
  NYC_LANDMARKS,
  TELEPORT_LOCATIONS,
  SIGNAL_TIMING,
  streetZ,
  blockAt,
  pointInPoly,
  segDist,
  toPts,
  nearestRoads,
  signName,
  getLocationLabel,
  isTypingInField,
  signalPhase,
  walkSignal
};
