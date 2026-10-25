import { GEO } from './geodata.js';

// js/obregon/signals.js
// Where Ciudad Obregón's traffic signals stand: every intersection of two main streets (tertiary and up, by name),
// plus the ones OpenStreetMap maps. Junctions within 14 m of each other count as one, as js/road-network.js collapses
// them (dual carriageways, offset corners), so the network finds each site's node. Pure: street-details.js mounts the
// heads, city-grid.js gives the corners the curb rectangles the crosswalks land on.
//
// SIGNAL_SITES: [{ x, z, arms: [{ ux, uz (unit, away from the junction), half, kind, name }], roads (arms within
// 35° joined, widest first: [{ ux, uz, half }]), main (the widest road), cardinal (every arm within 15° of the compass
// axes), hx, hz (half widths of the widest north-south & east-west roads) }]

const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const MERGE = 14;

const SIGNAL_SITES = (() => {
  const RG = GEO.roadGraph;
  const N = RG.nodes;
  const P = (i) => ({ x: N[i * 2], z: N[i * 2 + 1] });
  const links = RG.links.map(([a, b, ni, w, , , inner, k]) => {
    const pts = [P(a)];
    for (let i = 0; i < inner.length; i += 2) pts.push({ x: inner[i], z: inner[i + 1] });
    pts.push(P(b));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    return { a, b, name: RG.names[ni], half: w / 2, kind: RG.kinds[k], pts, len };
  });

  const parent = Array.from({ length: N.length / 2 }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const l of links) if (l.len < MERGE) parent[find(l.a)] = find(l.b);
  const clusters = new Map();
  for (const l of links) {
    for (const end of [l.a, l.b]) {
      const r = find(end);
      if (!clusters.has(r)) clusters.set(r, { nodes: new Set(), arms: [] });
      clusters.get(r).nodes.add(end);
    }
  }
  for (const c of clusters.values()) {
    let x = 0, z = 0;
    for (const i of c.nodes) { x += N[i * 2]; z += N[i * 2 + 1]; }
    c.x = x / c.nodes.size;
    c.z = z / c.nodes.size;
  }
  // arms: the links leaving each junction, pointing from it to their point ~15 m out
  for (const l of links) {
    const ra = find(l.a), rb = find(l.b);
    if (ra === rb) continue;
    for (const [r, pts] of [[ra, l.pts], [rb, [...l.pts].reverse()]]) {
      let q = pts[pts.length - 1];
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
        if (acc >= 15) { q = pts[i]; break; }
      }
      const c = clusters.get(r);
      const ux = q.x - c.x, uz = q.z - c.z;
      const L = Math.hypot(ux, uz) || 1;
      c.arms.push({ ux: ux / L, uz: uz / L, half: l.half, kind: l.kind, name: l.name });
    }
  }
  const mapped = [];
  for (let i = 0; i < GEO.signals.length; i += 2) mapped.push({ x: GEO.signals[i], z: GEO.signals[i + 1] });

  const sites = [];
  for (const c of clusters.values()) {
    if (c.arms.length < 3) continue;
    const majorNames = new Set(c.arms.filter((a) => MAJOR.has(a.kind)).map((a) => a.name || a.kind));
    if (majorNames.size < 2 && !mapped.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < 30)) continue;
    const roads = [];
    for (const a of c.arms) {
      const r = roads.find((o) => Math.abs(o.ux * a.ux + o.uz * a.uz) > 0.82);
      if (r) r.half = Math.max(r.half, a.half);
      else roads.push({ ux: a.ux, uz: a.uz, half: a.half });
    }
    if (roads.length < 2) continue;
    roads.sort((p, q) => q.half - p.half);
    const cardinal = c.arms.every((a) => Math.max(Math.abs(a.ux), Math.abs(a.uz)) > 0.966);
    const hx = Math.max(0, ...c.arms.filter((a) => Math.abs(a.uz) > 0.966).map((a) => a.half));
    const hz = Math.max(0, ...c.arms.filter((a) => Math.abs(a.ux) > 0.966).map((a) => a.half));
    sites.push({ x: c.x, z: c.z, arms: c.arms, roads, main: roads[0], cardinal, hx, hz });
  }
  return sites;
})();

export { SIGNAL_SITES };
