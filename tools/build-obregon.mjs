// tools/build-obregon.mjs — writes js/obregon/geodata.js: Ciudad Obregón (Sonora) in the simulation's world frame,
// from OpenStreetMap (tools/data/obregon/osm_*.json, fetched with tools/overpass.sh and the q_*.overpassql queries).
// Frame: 1 unit = 1 m, x = grid east, z = grid south (north = -z), origin at Plaza Álvaro Obregón (in front of the
// Catedral del Sagrado Corazón and the Palacio Municipal), axes turned by the measured bearing of the street grid.
//
// usage: node tools/build-obregon.mjs [outFile]
//
// Output (flat [x0, z0, x1, z1, ...] arrays, 0.1 m):
//   frame      origin, bearing, the detailed area's bounds
//   roadGraph  the drivable street centrelines as a graph in the format of tools/geo-roadgraph.mjs, which
//              js/road-network.js turns into lanes and intersections: { nodes, links: [a, b, name, width, lanes, dir,
//              inner points], names } (+ link classes in `kinds`)
//   blocks     the city blocks between the streets: curb outline `c`, the building line `l` (a sidewalk further in)
//   parks, water, canals, buildings (mapped footprints & heights), pois
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = process.env.GEO_DATA || fileURLToPath(new URL('data/obregon/', import.meta.url));
const OUT = process.argv[2] || fileURLToPath(new URL('../js/obregon/geodata.js', import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')).elements;
const log = (...a) => console.log('[obregon]', ...a);

// ---------------------------------------------------------------------------------------------------------------------
// 1. Frame: a local tangent plane at Plaza Álvaro Obregón, turned to the street grid
// ---------------------------------------------------------------------------------------------------------------------
const LAT0 = 27.49652;
const LON0 = -109.93323;
const A = 6378137.0;
const E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180;
const SIN0 = Math.sin(PHI0);
const KX = (Math.PI / 180) * (A / Math.sqrt(1 - E2 * SIN0 * SIN0)) * Math.cos(PHI0);
const KY = (Math.PI / 180) * ((A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5));
let THETA = 0;
const rawXZ = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KY];
function toWorld(lon, lat) {
  const [x, z] = rawXZ(lon, lat);
  const c = Math.cos(THETA);
  const s = Math.sin(THETA);
  return [x * c + z * s, -x * s + z * c];
}
// The detailed area: downtown, the Laguna del Náinari and ITSON to the west, out to Calle 300 in the south
const BOX = { minX: -4300, maxX: 2500, minZ: -2300, maxZ: 2700 };
const inBox = ([x, z], m = 0) => x > BOX.minX - m && x < BOX.maxX + m && z > BOX.minZ - m && z < BOX.maxZ + m;
const q = (v) => Math.round(v * 10) / 10;
const flat = (pts) => pts.flatMap(([x, z]) => [q(x), q(z)]);

const roadsRaw = load('osm_roads.json');
const areasRaw = load('osm_areas.json');
const buildingsRaw = load('osm_buildings.json');
const poisRaw = load('osm_pois.json');

const DRIVE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)(_link)?$/;
const drivable = roadsRaw.filter((w) => w.type === 'way' && DRIVE.test(w.tags.highway) && w.tags.area !== 'yes' &&
  !['private', 'no'].includes(w.tags.access) && w.geometry && w.nodes);

// Grid bearing: length-weighted mean of the street directions folded onto 90° (the grid's two axes as one)
{
  let sx = 0;
  let sy = 0;
  for (const w of drivable) {
    if (!/residential|tertiary|secondary/.test(w.tags.highway)) continue;
    const g = w.geometry.map((p) => rawXZ(p.lon, p.lat));
    if (!inBox(g[0])) continue;
    for (let i = 1; i < g.length; i++) {
      const dx = g[i][0] - g[i - 1][0];
      const dz = g[i][1] - g[i - 1][1];
      const l = Math.hypot(dx, dz);
      const a = Math.atan2(dx, -dz) * 4;
      sx += l * Math.cos(a);
      sy += l * Math.sin(a);
    }
  }
  THETA = Math.atan2(sy, sx) / 4;
  log(`grid bearing ${((THETA * 180) / Math.PI).toFixed(2)}° east of true north`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Road graph: OSM ways split at the nodes they share, clipped to the detailed area
// ---------------------------------------------------------------------------------------------------------------------
// Curb-to-curb width by the travel lanes (js/road-network.js lanesOf / laneOffsets: one-way streets get two lanes from
// 8.8 m and three from 13.6 m, two-way ones two each way from 17 m); two-way streets carry a parking lane each side
const LANES_DEFAULT = {
  trunk: [4, 3], primary: [4, 3], secondary: [4, 2], tertiary: [2, 2],
  unclassified: [2, 1], residential: [2, 2], living_street: [2, 1], motorway: [4, 2]
};
function roadSpec(t) {
  const kind = t.highway.replace('_link', '');
  const link = t.highway.endsWith('_link');
  let dir = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' || t.junction === 'circular' ? 1
    : t.oneway === '-1' ? -1 : 0;
  if (link && !t.oneway) dir = 1;
  const def = LANES_DEFAULT[kind] || [2, 1];
  let lanes = parseInt(t.lanes, 10);
  if (!(lanes > 0)) lanes = link ? 1 : def[dir ? 1 : 0];
  let w;
  if (dir) w = lanes <= 1 ? 6.5 : lanes === 2 ? 9.8 : lanes === 3 ? 14 : 17.6;
  else w = lanes <= 2 ? (kind === 'residential' || kind === 'living_street' ? 10 : 11) : lanes <= 3 ? 14.5 : 18.5;
  const tw = parseFloat(t.width);
  if (tw > 4 && tw < 40) w = tw;
  return { kind, dir, lanes, w };
}

const nodeUse = new Map();
for (const w of drivable) for (const id of w.nodes) nodeUse.set(id, (nodeUse.get(id) || 0) + 1);
const nodePos = new Map();
for (const w of drivable) w.nodes.forEach((id, i) => nodePos.set(id, toWorld(w.geometry[i].lon, w.geometry[i].lat)));

const names = [];
const nameIds = new Map();
const nameId = (n) => {
  if (!nameIds.has(n)) {
    nameIds.set(n, names.length);
    names.push(n);
  }
  return nameIds.get(n);
};
const rawLinks = []; // { a, b (OSM node ids), pts, name, kind, w, lanes, dir }
for (const w of drivable) {
  const spec = roadSpec(w.tags);
  const name = w.tags.name || '';
  // runs of consecutive nodes inside the area
  let run = [];
  const flush = () => {
    // split the run at shared nodes
    let start = 0;
    for (let i = 1; i < run.length; i++) {
      if (i === run.length - 1 || nodeUse.get(run[i]) > 1) {
        const ids = run.slice(start, i + 1);
        if (ids.length >= 2 && ids[0] !== ids[ids.length - 1]) {
          rawLinks.push({ a: ids[0], b: ids[ids.length - 1], pts: ids.map((id) => nodePos.get(id)), name, ...spec });
        }
        start = i;
      }
    }
    run = [];
  };
  for (const id of w.nodes) {
    if (inBox(nodePos.get(id))) run.push(id);
    else flush();
  }
  flush();
}

// Ramer–Douglas–Peucker
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const [ax, az] = pts[0];
  const [bx, bz] = pts[pts.length - 1];
  const dx = bx - ax;
  const dz = bz - az;
  const L = Math.hypot(dx, dz) || 1;
  let best = -1;
  let bi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L;
    if (d > best) {
      best = d;
      bi = i;
    }
  }
  if (best <= eps) return [pts[0], pts[pts.length - 1]];
  const l = rdp(pts.slice(0, bi + 1), eps);
  return [...l.slice(0, -1), ...rdp(pts.slice(bi), eps)];
}
// RDP for a closed ring (given without its repeated first point): split at the point farthest from the first
function rdpRing(ring, eps) {
  let far = 0;
  let fd = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const a = rdp(ring.slice(0, far + 1), eps);
  const b = rdp([...ring.slice(far), ring[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
const lineLen = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

// The largest connected network only (stray fragments clipped off by the area's edge can't be driven)
{
  const parent = new Map();
  const find = (i) => {
    while (parent.get(i) !== i) {
      parent.set(i, parent.get(parent.get(i)));
      i = parent.get(i);
    }
    return i;
  };
  for (const l of rawLinks) {
    for (const i of [l.a, l.b]) if (!parent.has(i)) parent.set(i, i);
    parent.set(find(l.a), find(l.b));
  }
  const size = new Map();
  for (const l of rawLinks) size.set(find(l.a), (size.get(find(l.a)) || 0) + lineLen(l.pts));
  const best = [...size.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const before = rawLinks.length;
  for (let i = rawLinks.length - 1; i >= 0; i--) if (find(rawLinks[i].a) !== best) rawLinks.splice(i, 1);
  log(`road links: ${rawLinks.length} (${before - rawLinks.length} in disconnected fragments dropped)`);
}

const graphNodes = [];
const graphIndex = new Map();
const gnode = (id) => {
  if (!graphIndex.has(id)) {
    graphIndex.set(id, graphNodes.length / 2);
    const [x, z] = nodePos.get(id);
    graphNodes.push(q(x), q(z));
  }
  return graphIndex.get(id);
};
const KINDS = [];
const kindId = (k) => (KINDS.includes(k) ? KINDS.indexOf(k) : KINDS.push(k) - 1);
const links = rawLinks.map((l) => {
  const line = rdp(l.pts, 0.5);
  return [gnode(l.a), gnode(l.b), nameId(l.name), l.w, l.lanes, l.dir, flat(line.slice(1, -1)), kindId(l.kind)];
});
let km = 0;
for (const l of rawLinks) km += lineLen(l.pts) / 1000;
log(`road graph: ${graphNodes.length / 2} nodes, ${links.length} links, ${km.toFixed(0)} km`);

// ---------------------------------------------------------------------------------------------------------------------
// 3. Blocks: the faces of the planar street graph, set in from the centrelines by half the street's width (curb) and
//    then by the sidewalk (building line)
// ---------------------------------------------------------------------------------------------------------------------
const SIDEWALK = 3.4;
const blocks = [];
{
  // vertices: every point of every link, merged within 0.5 m; segments carry the street's half width
  const verts = [];
  const vcell = new Map();
  const vkey = (x, z) => Math.floor(x / 2) * 100003 + Math.floor(z / 2);
  const vat = (x, z) => {
    const ix = Math.floor(x / 2);
    const iz = Math.floor(z / 2);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const v of vcell.get((ix + dx) * 100003 + iz + dz) || []) if (Math.hypot(verts[v].x - x, verts[v].z - z) < 0.5) return v;
      }
    }
    const v = verts.length;
    verts.push({ x, z, out: [] });
    const k = vkey(x, z);
    if (!vcell.has(k)) vcell.set(k, []);
    vcell.get(k).push(v);
    return v;
  };
  const segSet = new Map();
  for (const l of rawLinks) {
    const line = rdp(l.pts, 0.5);
    for (let i = 1; i < line.length; i++) {
      const a = vat(...line[i - 1]);
      const b = vat(...line[i]);
      if (a === b) continue;
      const k = Math.min(a, b) * 1e7 + Math.max(a, b);
      const half = l.w / 2;
      if (!segSet.has(k) || segSet.get(k).half < half) segSet.set(k, { a, b, half });
    }
  }
  // drop dead ends (repeatedly), so blocks are bounded by through streets only
  const adj = verts.map(() => new Set());
  for (const s of segSet.values()) {
    adj[s.a].add(s.b);
    adj[s.b].add(s.a);
  }
  const halfOf = new Map();
  for (const s of segSet.values()) {
    halfOf.set(s.a * 1e7 + s.b, s.half);
    halfOf.set(s.b * 1e7 + s.a, s.half);
  }
  const stack = [];
  adj.forEach((s, v) => s.size === 1 && stack.push(v));
  while (stack.length) {
    const v = stack.pop();
    for (const u of adj[v]) {
      adj[u].delete(v);
      if (adj[u].size === 1) stack.push(u);
    }
    adj[v].clear();
  }
  // half-edges sorted by angle around each vertex; next(u->v) = the edge leaving v just clockwise of v->u
  const ang = (a, b) => Math.atan2(verts[b].z - verts[a].z, verts[b].x - verts[a].x);
  const sorted = adj.map((s, v) => [...s].sort((p, r) => ang(v, p) - ang(v, r)));
  const used = new Set();
  const faces = [];
  for (let u = 0; u < verts.length; u++) {
    for (const v of sorted[u]) {
      if (used.has(u * 1e7 + v)) continue;
      const ring = [];
      let a = u;
      let b = v;
      let guard = 0;
      while (!used.has(a * 1e7 + b) && guard++ < 5000) {
        used.add(a * 1e7 + b);
        ring.push([a, b]);
        const list = sorted[b];
        const i = list.indexOf(a);
        const c = list[(i - 1 + list.length) % list.length];
        a = b;
        b = c;
      }
      faces.push(ring);
    }
  }
  const area = (P) => {
    let s = 0;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) s += (P[j][0] - P[i][0]) * (P[j][1] + P[i][1]);
    return s / 2;
  };
  // Offset every edge of a ring inwards by its own distance and join consecutive offset lines
  function inset(P, D) {
    const n = P.length;
    // shoelace sign: with a positive one the interior lies left of every edge, (-ez, ex)
    let shoe = 0;
    for (let i = 0; i < n; i++) shoe += P[i][0] * P[(i + 1) % n][1] - P[(i + 1) % n][0] * P[i][1];
    const sgn = Math.sign(shoe);
    const out = [];
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n];
      const p1 = P[i];
      const p2 = P[(i + 1) % n];
      const d0 = D[(i - 1 + n) % n];
      const d1 = D[i];
      const e0 = [p1[0] - p0[0], p1[1] - p0[1]];
      const e1 = [p2[0] - p1[0], p2[1] - p1[1]];
      const l0 = Math.hypot(...e0) || 1;
      const l1 = Math.hypot(...e1) || 1;
      const n0 = [(-e0[1] / l0) * sgn, (e0[0] / l0) * sgn];
      const n1 = [(-e1[1] / l1) * sgn, (e1[0] / l1) * sgn];
      const a0 = [p0[0] + n0[0] * d0, p0[1] + n0[1] * d0];
      const a1 = [p1[0] + n1[0] * d1, p1[1] + n1[1] * d1];
      const cross = e0[0] * e1[1] - e0[1] * e1[0];
      if (Math.abs(cross) / (l0 * l1) < 0.08) {
        out.push([p1[0] + n1[0] * Math.max(d0, d1), p1[1] + n1[1] * Math.max(d0, d1)]);
        continue;
      }
      const t = ((a1[0] - a0[0]) * e1[1] - (a1[1] - a0[1]) * e1[0]) / cross;
      let x = a0[0] + e0[0] * t;
      let z = a0[1] + e0[1] * t;
      const m = Math.hypot(x - p1[0], z - p1[1]);
      const lim = 2.5 * Math.max(d0, d1);
      if (m > lim) {
        x = p1[0] + ((x - p1[0]) * lim) / m;
        z = p1[1] + ((z - p1[1]) * lim) / m;
      }
      out.push([x, z]);
    }
    return out;
  }
  const segsCross = (a, b, c, d) => {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  function simple(P) {
    const n = P.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (segsCross(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) return false;
      }
    }
    return true;
  }
  // (whichever way the ring winds: setting in must shrink it)
  function insideRing(R, x, z) {
    let inside = false;
    for (let i = 0, j = R.length - 1; i < R.length; j = i++) {
      if ((R[i][1] > z) !== (R[j][1] > z) && x < ((R[j][0] - R[i][0]) * (z - R[i][1])) / (R[j][1] - R[i][1]) + R[i][0]) inside = !inside;
    }
    return inside;
  }
  function validInset(P, D) {
    const a0 = area(P);
    const R = inset(P, D);
    const a1 = area(R);
    if (Math.sign(a0) !== Math.sign(a1) || Math.abs(a1) > Math.abs(a0) || Math.abs(a1) < 0.15 * Math.abs(a0) || !simple(R)) return null;
    return R;
  }
  // interior faces all wind the same way; the unbounded outer face of each connected piece winds the other
  let pos = 0;
  for (const ring of faces) if (ring.length >= 3 && area(ring.map(([a]) => [verts[a].x, verts[a].z])) > 0) pos++;
  const SIGN = pos > faces.length / 2 ? 1 : -1;
  let dropped = 0;
  for (const ring of faces) {
    if (ring.length < 3) continue;
    let P = ring.map(([a]) => [verts[a].x, verts[a].z]);
    let D = ring.map(([a, b]) => halfOf.get(a * 1e7 + b));
    const A0 = area(P);
    // the outer face, slivers and the big open faces (fields, the area's edge) aren't blocks
    if (Math.sign(A0) !== SIGN || Math.abs(A0) < 150 || Math.abs(A0) > 400000) continue;
    // merge collinear points (keeping the larger offset)
    const keep = [];
    for (let i = 0; i < P.length; i++) {
      const p0 = P[(i - 1 + P.length) % P.length];
      const p1 = P[i];
      const p2 = P[(i + 1) % P.length];
      const c = (p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0]);
      const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (Math.abs(c) / (l || 1) > 0.02) keep.push(i);
      else D[i] = Math.max(D[i], D[(i - 1 + P.length) % P.length]);
    }
    if (keep.length < 3) continue;
    D = keep.map((i) => D[i]);
    P = keep.map((i) => P[i]);
    let curb = validInset(P, D);
    // ...or the face itself: each simplified edge keeps the width of the street nearest its middle
    for (const tol of [1.5, 3, 6]) {
      if (curb) break;
      const S = rdpRing(P, tol);
      if (S.length < 3) break;
      const DS = S.map((a, i) => {
        const b = S[(i + 1) % S.length];
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        let best = D[0], bd = Infinity;
        P.forEach((p, k) => {
          const q = P[(k + 1) % P.length];
          const d = Math.hypot((p[0] + q[0]) / 2 - mx, (p[1] + q[1]) / 2 - mz);
          if (d < bd) { bd = d; best = D[k]; }
        });
        return best;
      });
      curb = validInset(S, DS);
    }
    let lot = curb && validInset(P, D.map((d) => d + SIDEWALK));
    // (a face wrapping round a loop nearly touches itself: its building line may cross the curb there)
    if (lot && !lot.every(([x, z]) => insideRing(curb, x, z))) lot = null;
    // an irregular face (short kinks, spikes) sets in cleanly once simplified: the building line from the curb itself
    for (const tol of [1.5, 3, 6]) {
      if (lot || !curb) break;
      const C = rdpRing(curb, tol);
      const L = C.length >= 3 && validInset(C, C.map(() => SIDEWALK));
      // (simplifying may have pushed it past the curb somewhere: then it's no building line)
      if (L && L.every(([x, z]) => insideRing(curb, x, z))) lot = L;
    }
    if (!curb) {
      dropped++;
      continue;
    }
    blocks.push({ c: curb, l: lot, area: Math.abs(area(curb)) });
  }
  log(`blocks: ${blocks.length} (${dropped} faces too irregular to set in)`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Parks, water, canals, mapped buildings, places
// ---------------------------------------------------------------------------------------------------------------------
const ringOf = (geom) => geom.map((p) => toWorld(p.lon, p.lat));
const anyIn = (pts) => pts.some((p) => inBox(p, 200));
const outerRings = (e) => {
  if (e.type === 'way' && e.geometry) return [ringOf(e.geometry)];
  if (e.type === 'relation') {
    // join the outer member ways into closed rings
    const parts = (e.members || []).filter((m) => m.role !== 'inner' && m.geometry).map((m) => ringOf(m.geometry));
    const rings = [];
    while (parts.length) {
      let r = parts.shift();
      let grew = true;
      while (grew && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) > 0.5) {
        grew = false;
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          const end = r[r.length - 1];
          if (Math.hypot(p[0][0] - end[0], p[0][1] - end[1]) < 0.5) r = r.concat(p.slice(1));
          else if (Math.hypot(p[p.length - 1][0] - end[0], p[p.length - 1][1] - end[1]) < 0.5) r = r.concat(p.slice(0, -1).reverse());
          else continue;
          parts.splice(i, 1);
          grew = true;
          break;
        }
      }
      rings.push(r);
    }
    return rings;
  }
  return [];
};
const closed = (r) => r.length >= 4 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 0.5;

const parks = [];
const water = [];
const canals = [];
for (const e of areasRaw) {
  const t = e.tags || {};
  if (t.waterway === 'canal' || t.waterway === 'drain' || t.waterway === 'ditch') {
    if (e.type !== 'way' || !e.geometry) continue;
    const line = rdp(ringOf(e.geometry), 1);
    if (!anyIn(line)) continue;
    const w = parseFloat(t.width) > 0 ? parseFloat(t.width) : t.waterway === 'canal' ? 8 : 3;
    canals.push({ name: t.name || '', w, pts: flat(line) });
    continue;
  }
  const isWater = t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin';
  const isPark = ['park', 'garden', 'pitch', 'stadium', 'sports_centre', 'recreation_ground'].includes(t.leisure) ||
    ['grass', 'recreation_ground', 'cemetery', 'village_green'].includes(t.landuse);
  if (!isWater && !isPark) continue;
  if (isWater && (t.water === 'Alberca' || t.leisure === 'swimming_pool')) continue;
  for (const r of outerRings(e)) {
    if (!closed(r) || !anyIn(r)) continue;
    const ring = rdpRing(r.slice(0, -1), 0.8);
    if (ring.length < 3) continue;
    if (isWater) water.push({ name: t.name || '', ring: flat(ring) });
    else parks.push({ name: t.name || '', kind: t.leisure || t.landuse, ring: flat(ring) });
  }
}
log(`parks ${parks.length}, water ${water.length}, canals ${canals.length}`);

const buildings = [];
for (const e of buildingsRaw) {
  const t = e.tags || {};
  for (const r of outerRings(e)) {
    if (!closed(r) || !r.every((p) => inBox(p))) continue;
    const ring = rdpRing(r.slice(0, -1), 0.3);
    if (ring.length < 3) continue;
    const levels = parseFloat(t['building:levels']);
    const h = parseFloat(t.height);
    buildings.push({
      name: t.name || '', kind: t.amenity || t.building || 'yes',
      levels: levels > 0 ? levels : 0, h: h > 0 ? h : 0, ring: flat(ring)
    });
  }
}
log(`mapped buildings in the area: ${buildings.length}`);

const pois = [];
for (const e of poisRaw) {
  const t = e.tags || {};
  if (!t.name || t.highway) continue;
  const c = e.center || (e.lat ? { lat: e.lat, lon: e.lon } : null);
  if (!c) continue;
  const p = toWorld(c.lon, c.lat);
  if (!inBox(p)) continue;
  const kind = t.amenity || t.tourism || t.historic || t.leisure || t.shop || t.place || '';
  pois.push({ name: t.name, kind, x: q(p[0]), z: q(p[1]) });
}
// traffic signals mapped in OSM
const signals = [];
for (const e of poisRaw) {
  if (e.tags?.highway !== 'traffic_signals' || !e.lat) continue;
  const p = toWorld(e.lon, e.lat);
  if (inBox(p)) signals.push(q(p[0]), q(p[1]));
}
log(`places ${pois.length}, mapped signals ${signals.length / 2}`);

// ---------------------------------------------------------------------------------------------------------------------
// 5. Write
// ---------------------------------------------------------------------------------------------------------------------
const GEO = {
  frame: { lat0: LAT0, lon0: LON0, bearingDeg: Math.round(((THETA * 180) / Math.PI) * 1000) / 1000, ...BOX },
  roadGraph: { nodes: graphNodes, links, names, kinds: KINDS },
  blocks: blocks.map((b) => ({ c: flat(b.c), l: b.l ? flat(b.l) : null })),
  parks, water, canals, buildings, pois, signals
};
const header = `// js/obregon/geodata.js — GENERATED by tools/build-obregon.mjs, do not edit by hand.
// Ciudad Obregón (Sonora) in the simulation's world frame: 1 unit = 1 m, x = grid east, z = grid south, origin at
// Plaza Álvaro Obregón, axes turned ${GEO.frame.bearingDeg}° from true north. Polygons & polylines are flat [x0, z0, x1, z1, ...].
// Data © OpenStreetMap contributors (ODbL).
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${header}export const GEO = ${JSON.stringify(GEO)};\n`);
log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB)`);
