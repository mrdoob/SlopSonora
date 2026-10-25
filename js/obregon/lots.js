import { GEO } from './geodata.js';
import { BLOCKS, ROAD_SEGMENTS, PARKS, WATER, pointInPoly, segDist } from './city-config.js';

// js/obregon/lots.js
// Where Ciudad Obregón's ordinary buildings stand (buildings.js builds them). OpenStreetMap maps only a few hundred
// buildings, so every block is filled in along its building line (geodata `l`): lots 8-15 m wide on each street
// front (6-13 m where there are shops: downtown, within ~900 m of the plaza, and along the main avenues), as deep as
// half the block allows, mostly one storey, some with a porch or a front garden and gaps between them. No lot goes
// where a mapped building, a park, the lagoon or a street (dead ends reach into the blocks) is. Pure & deterministic:
// the same city on every load (and testable without a renderer).

// Seeded PRNG (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Spatial lookup of rectangles
class RectGrid {
  constructor(cell = 32) {
    this.cell = cell;
    this.map = new Map();
  }
  key(ix, iz) {
    return (ix + 4096) * 8192 + (iz + 4096);
  }
  add(r) {
    const c = this.cell;
    for (let ix = Math.floor(r.minX / c); ix <= Math.floor(r.maxX / c); ix++) {
      for (let iz = Math.floor(r.minZ / c); iz <= Math.floor(r.maxZ / c); iz++) {
        const k = this.key(ix, iz);
        if (!this.map.has(k)) this.map.set(k, []);
        this.map.get(k).push(r);
      }
    }
  }
  some(minX, maxX, minZ, maxZ, fn) {
    const c = this.cell;
    const seen = new Set();
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        for (const r of this.map.get(this.key(ix, iz)) || []) {
          if (seen.has(r)) continue;
          seen.add(r);
          if (r.minX < maxX && r.maxX > minX && r.minZ < maxZ && r.maxZ > minZ && fn(r)) return true;
        }
      }
    }
    return false;
  }
}

// Corners of an oriented box: centre (cx, cz), half sizes along u (hu) and across it (hv)
function corners(cx, cz, ux, uz, hu, hv) {
  const vx = -uz, vz = ux;
  return [
    { x: cx - ux * hu - vx * hv, z: cz - uz * hu - vz * hv },
    { x: cx + ux * hu - vx * hv, z: cz + uz * hu - vz * hv },
    { x: cx + ux * hu + vx * hv, z: cz + uz * hu + vz * hv },
    { x: cx - ux * hu + vx * hv, z: cz - uz * hu + vz * hv }
  ];
}
// Separating-axis overlap of two convex polygons
function convexOverlap(A, B) {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length];
      const nx = -(q.z - p.z), nz = q.x - p.x;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const c of A) { const d = c.x * nx + c.z * nz; amin = Math.min(amin, d); amax = Math.max(amax, d); }
      for (const c of B) { const d = c.x * nx + c.z * nz; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
      if (amax <= bmin + 1e-6 || bmax <= amin + 1e-6) return false;
    }
  }
  return true;
}
const bounds = (Q) => ({
  minX: Math.min(...Q.map((p) => p.x)), maxX: Math.max(...Q.map((p) => p.x)),
  minZ: Math.min(...Q.map((p) => p.z)), maxZ: Math.max(...Q.map((p) => p.z))
});
// Does the polygon P (any shape) overlap the convex quad Q? (an edge crossing, or one inside the other)
function polyOverlapsQuad(P, Q) {
  for (const c of Q) if (pointInPoly(P, c.x, c.z)) return true;
  for (const c of P) if (pointInPoly(Q, c.x, c.z)) return true;
  const cross = (a, b, c, d) => {
    const o = (p, q, r) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (let i = 0; i < P.length; i++) {
    for (let j = 0; j < 4; j++) if (cross(P[i], P[(i + 1) % P.length], Q[j], Q[(j + 1) % 4])) return true;
  }
  return false;
}

const MAJOR = new Set(['trunk', 'primary', 'secondary']);
const DOWNTOWN = 900;

/**
 * Plans every lot: [{ cx, cz, ux, uz (unit, along the street front), nx, nz (unit, from the street into the block),
 * hu, hv (half width along the front & half depth), floors, commercial, downtown, block, seed }], plus counts of why
 * candidate lots were turned down (`rejected`).
 */
function planLots() {
  const lots = [];
  const rejected = { outside: 0, overlap: 0, mapped: 0, park: 0, street: 0 };

  const mapped = new RectGrid(32);
  for (const b of GEO.buildings) {
    const pts = [];
    for (let i = 0; i < b.ring.length; i += 2) pts.push({ x: b.ring[i], z: b.ring[i + 1] });
    mapped.add({ ...bounds(pts), poly: pts });
  }
  const parks = new RectGrid(64); // (and the water: no lot stands in it either)
  for (const p of PARKS) parks.add({ ...bounds(p.poly), poly: p.poly });
  for (const w of WATER) parks.add({ ...bounds(w.poly), poly: w.poly });
  const roads = new RectGrid(32);
  for (const s of ROAD_SEGMENTS) {
    const h = s.w / 2 + 1.0; // the roadway and a metre of sidewalk stay clear
    roads.add({ minX: Math.min(s.x0, s.x1) - h, maxX: Math.max(s.x0, s.x1) + h, minZ: Math.min(s.z0, s.z1) - h, maxZ: Math.max(s.z0, s.z1) + h, s, h });
  }
  const nearestStreet = (x, z) => {
    let best = null;
    let bd = 30;
    roads.some(x - 30, x + 30, z - 30, z + 30, (r) => {
      const d = segDist(r.s, x, z);
      if (d < bd) {
        bd = d;
        best = r.s;
      }
      return false;
    });
    return best;
  };

  for (const b of BLOCKS) {
    if (b.water || !b.lot || b.lot.length < 3) continue;
    const L = b.lot;
    let shoe = 0;
    for (let i = 0; i < L.length; i++) {
      const q = L[(i + 1) % L.length];
      shoe += L[i].x * q.z - q.x * L[i].z;
    }
    const area = Math.abs(shoe / 2);
    if (area < 120 || (b.parkArea || 0) > area * 0.5) continue;
    const sgn = Math.sign(shoe);
    const rand = rng(1000003 * (b.id + 1));
    const placed = [];
    // depth room: half the block's narrow side, so the lots from both fronts meet at the back
    const narrow = Math.min(b.maxX - b.minX, b.maxZ - b.minZ);
    const maxDepth = Math.max(8, Math.min(narrow / 2 - 3.6, 42));
    // the longest fronts first: they're the streets the block faces (the short ends' lots fit in after)
    const order = L.map((_, i) => i).sort((i, j) => {
      const li = Math.hypot(L[(i + 1) % L.length].x - L[i].x, L[(i + 1) % L.length].z - L[i].z);
      const lj = Math.hypot(L[(j + 1) % L.length].x - L[j].x, L[(j + 1) % L.length].z - L[j].z);
      return lj - li;
    });
    for (const i of order) {
      const p = L[i];
      const q = L[(i + 1) % L.length];
      const ex = q.x - p.x, ez = q.z - p.z;
      const len = Math.hypot(ex, ez);
      if (len < 7) continue;
      const ux = ex / len, uz = ez / len;
      const nx = -uz * sgn, nz = ux * sgn; // into the block
      const street = nearestStreet((p.x + q.x) / 2 - nx * 6, (p.z + q.z) / 2 - nz * 6);
      const downtown = Math.hypot((p.x + q.x) / 2, (p.z + q.z) / 2) < DOWNTOWN;
      const commercial = downtown || !!(street && MAJOR.has(street.kind));
      let s = 0.2;
      while (s < len - 4) {
        const lotW = commercial ? 6 + rand() * 7 : 8 + rand() * 7;
        const wid = Math.min(lotW, len - s - 0.2);
        if (wid < 4.5) break;
        // houses fill most of their lot, leaving a back patio; shops & downtown buildings run deeper still
        const depth = Math.min(maxDepth, commercial ? 18 + rand() * 18 : 15 + rand() * 13);
        const setback = commercial ? 0 : rand() < 0.55 ? 0 : 1.5 + rand() * 3; // a porch or front garden, or none
        const gap = commercial ? 0 : rand() < 0.5 ? 0 : 0.6 + rand() * 1.5; // a side yard
        const seed = rand();
        const hu = (wid - gap) / 2;
        const hv = depth / 2;
        const cx = p.x + ux * (s + wid / 2) + nx * (setback + hv);
        const cz = p.z + uz * (s + wid / 2) + nz * (setback + hv);
        s += wid;
        if (hu < 2) continue;
        let Q = corners(cx, cz, ux, uz, hu, hv);
        // a lot reaching past the block's middle (or an angled back line) gets shallower before it's dropped
        let lot = { cx, cz, hv };
        for (let tries = 0; tries < 3 && !Q.every((c) => pointInPoly(L, c.x, c.z)); tries++) {
          const hv2 = lot.hv * 0.7;
          if (hv2 < 3.5) break;
          lot = { cx: cx - nx * (lot.hv - hv2), cz: cz - nz * (lot.hv - hv2), hv: hv2 };
          Q = corners(lot.cx, lot.cz, ux, uz, hu, lot.hv);
        }
        if (!Q.every((c) => pointInPoly(L, c.x, c.z))) { rejected.outside++; continue; }
        if (placed.some((o) => convexOverlap(o, Q))) { rejected.overlap++; continue; }
        const bb = bounds(Q);
        if (mapped.some(bb.minX, bb.maxX, bb.minZ, bb.maxZ, (r) => polyOverlapsQuad(r.poly, Q))) { rejected.mapped++; continue; }
        if (parks.some(bb.minX, bb.maxX, bb.minZ, bb.maxZ, (r) => pointInPoly(r.poly, lot.cx, lot.cz))) { rejected.park++; continue; }
        if (roads.some(bb.minX, bb.maxX, bb.minZ, bb.maxZ, (r) => Q.some((c) => segDist(r.s, c.x, c.z) < r.h) || segDist(r.s, lot.cx, lot.cz) < r.h)) { rejected.street++; continue; }
        placed.push(Q);
        // storeys: downtown commercial rises to 2-3, houses are mostly single-storey
        const f = rand();
        const floors = downtown && commercial ? (f < 0.35 ? 1 : f < 0.8 ? 2 : 3) : commercial ? (f < 0.6 ? 1 : 2) : f < 0.82 ? 1 : 2;
        lots.push({ cx: lot.cx, cz: lot.cz, ux, uz, nx, nz, hu, hv: lot.hv, floors, commercial, downtown, block: b.id, seed });
      }
    }
  }
  return { lots, rejected };
}

export { planLots, corners, rng };
