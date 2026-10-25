import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GEO } from '../js/obregon/geodata.js';
import { BLOCKS, ROADS, TELEPORT_LOCATIONS, PLAYER_SPAWN, ISLAND_BOUNDS, blockAt, getLocationLabel, pointInPoly, WATER } from '../js/obregon/city-config.js';
import { planLots, corners } from '../js/obregon/lots.js';
import { SIGNAL_SITES } from '../js/obregon/signals.js';

const root = fileURLToPath(new URL('../', import.meta.url));

// Static module graph of a page: the import map's remapping applied to every relative import from its entry
function moduleGraph(htmlFile) {
  const html = fs.readFileSync(path.join(root, htmlFile), 'utf8');
  const { imports } = JSON.parse(html.match(/<script type="importmap">([^]*?)<\/script>/)[1]);
  const base = 'https://example.test/app/';
  const remap = new Map(Object.entries(imports).filter(([k]) => k.startsWith('./')).map(([k, v]) => [new URL(k, base).href, new URL(v, base).href]));
  const entry = new URL(html.match(/<script type="module" src="([^"]+)"><\/script>/)[1], base).href;
  const modules = new Map(); // url -> { source, imports: [{ url, names }] }
  const queue = [entry];
  while (queue.length) {
    const url = queue.pop();
    if (modules.has(url)) continue;
    const source = fs.readFileSync(path.join(root, url.slice(base.length)), 'utf8');
    const deps = [];
    for (const [, names, spec] of source.matchAll(/^import\s*(\{[^}]*\}|\*\s+as\s+\w+)\s*from\s*['"](\.[^'"]+)['"]/gm)) {
      const resolved = new URL(spec, url).href;
      const target = remap.get(resolved) || resolved;
      const list = names.startsWith('{') ? names.slice(1, -1).split(',').map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean) : [];
      deps.push({ url: target, names: list, spec });
      queue.push(target);
    }
    modules.set(url, { source, deps });
  }
  return { modules, base };
}
function exportsOf(source) {
  const out = new Set();
  for (const [, list] of source.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const n of list.split(',')) {
      const m = n.trim().match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
      if (m) out.add(m[2] || m[1]);
    }
  }
  for (const [, name] of source.matchAll(/^export\s+(?:const|let|var|function|class)\s+([\w$]+)/gm)) out.add(name);
  return out;
}

test('obregon.html: every name the shared engine imports from a swapped-in Obregón module is exported by it', () => {
  const { modules, base } = moduleGraph('obregon.html');
  const missing = [];
  for (const [url, mod] of modules) {
    for (const dep of mod.deps) {
      const target = modules.get(dep.url);
      const names = exportsOf(target.source);
      for (const n of dep.names) if (!names.has(n)) missing.push(`${url.slice(base.length)} imports ${n} from ${dep.url.slice(base.length)}`);
    }
  }
  assert.deepEqual(missing, []);
  const urls = [...modules.keys()].map((u) => u.slice(base.length));
  assert.ok(urls.includes('js/obregon/city-config.js'));
  for (const nyc of ['js/city-config.js', 'js/nyc-geodata.js', 'js/city-grid.js', 'js/boroughs.js', 'js/buildings.js', 'js/landmarks.js', 'js/street-details.js', 'js/nyc-map.js', 'js/camera-shots.js']) {
    assert.ok(!urls.includes(nyc), `${nyc} is not loaded by obregon.html`);
  }
});

test('obregon.html preloads exactly the modules its graph loads', () => {
  const { modules, base } = moduleGraph('obregon.html');
  const html = fs.readFileSync(path.join(root, 'obregon.html'), 'utf8');
  const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"\s*\/>/g)].map((m) => new URL(m[1], base).href);
  assert.deepEqual([...new Set(preloads)].sort(), [...modules.keys()].sort());
});

test('the street graph is well formed', () => {
  const RG = GEO.roadGraph;
  const n = RG.nodes.length / 2;
  assert.ok(RG.links.length > 1000);
  for (const [a, b, ni, w, lanes, dir, inner, k] of RG.links) {
    assert.ok(a >= 0 && a < n && b >= 0 && b < n && a !== b);
    assert.ok(ni >= 0 && ni < RG.names.length);
    assert.ok(w > 4 && w < 40, `width ${w}`);
    assert.ok(lanes >= 1);
    assert.ok([-1, 0, 1].includes(dir));
    assert.equal(inner.length % 2, 0);
    assert.ok(k >= 0 && k < RG.kinds.length);
  }
  assert.ok(ROADS.some((r) => r.name === 'Avenida Miguel Alemán'));
});

test('blocks: the building line lies inside the curb outline', () => {
  assert.ok(BLOCKS.length > 1000);
  for (const b of BLOCKS) {
    if (!b.lot) continue;
    for (const p of b.lot) assert.ok(pointInPoly(b.poly, p.x, p.z) || b.poly.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.5), `block ${b.id}`);
  }
});

test('lots are deterministic, stay inside their block\'s building line and never overlap', () => {
  const a = planLots();
  const b = planLots();
  assert.equal(a.lots.length, b.lots.length);
  assert.deepEqual(a.lots.slice(0, 50), b.lots.slice(0, 50));
  assert.ok(a.lots.length > 20000);
  const byBlock = new Map();
  for (const lot of a.lots) {
    const Q = corners(lot.cx, lot.cz, lot.ux, lot.uz, lot.hu, lot.hv);
    const blk = BLOCKS[lot.block];
    for (const c of Q) assert.ok(pointInPoly(blk.lot, c.x, c.z));
    assert.ok(!WATER.some((w) => pointInPoly(w.poly, lot.cx, lot.cz)));
    if (!byBlock.has(lot.block)) byBlock.set(lot.block, []);
    byBlock.get(lot.block).push(Q);
  }
  // no two lots of a block share ground (shrunk a hair, so lots touching along a side don't count)
  const shrink = (Q) => {
    const cx = Q.reduce((s, p) => s + p.x, 0) / 4, cz = Q.reduce((s, p) => s + p.z, 0) / 4;
    return Q.map((p) => ({ x: cx + (p.x - cx) * 0.98, z: cz + (p.z - cz) * 0.98 }));
  };
  for (const list of [...byBlock.values()].slice(0, 300)) {
    const S = list.map(shrink);
    for (let i = 0; i < S.length; i++) {
      for (let j = i + 1; j < S.length; j++) assert.ok(!S[i].some((p) => pointInPoly(S[j], p.x, p.z)));
    }
  }
});

test('the lagoon is no sidewalk, and its teleport arrives on the shore road', () => {
  const lagoon = WATER.find((w) => /N.inari/.test(w.name));
  const c = lagoon.poly.reduce((s, p) => ({ x: s.x + p.x / lagoon.poly.length, z: s.z + p.z / lagoon.poly.length }), { x: 0, z: 0 });
  assert.equal(blockAt(c.x, c.z), null);
  const t = TELEPORT_LOCATIONS.nainari;
  assert.ok(!WATER.some((w) => pointInPoly(w.poly, t.x, t.z)));
});

test('the player starts on a street, and every teleport lies in the city', () => {
  assert.equal(blockAt(PLAYER_SPAWN.x, PLAYER_SPAWN.z), null, 'spawn on the roadway');
  assert.match(getLocationLabel(PLAYER_SPAWN.x, PLAYER_SPAWN.z), /Jalisco/);
  for (const [key, t] of Object.entries(TELEPORT_LOCATIONS)) {
    assert.ok(t.x > ISLAND_BOUNDS.minX && t.x < ISLAND_BOUNDS.maxX && t.z > ISLAND_BOUNDS.minZ && t.z < ISLAND_BOUNDS.maxZ, key);
    assert.ok(!(t.x === 0 && t.z === 0) || key === 'plaza', `${key} found its landmark`);
  }
});

test('signals stand where main streets cross, mostly on the compass-aligned grid', () => {
  assert.ok(SIGNAL_SITES.length > 100);
  const cardinal = SIGNAL_SITES.filter((s) => s.cardinal);
  assert.ok(cardinal.length > SIGNAL_SITES.length * 0.6);
  for (const s of cardinal) assert.ok(s.hx > 0 && s.hz > 0, 'a grid junction has a north-south and an east-west road');
});
