import { GEO } from './geodata.js';
import { BLOCKS, PARKS, WATER, ROADS, ROAD_SEGMENTS, NYC_LANDMARKS, ISLAND_BOUNDS, getLocationLabel, isTypingInField, signName, toPts } from './city-config.js';

// js/obregon/map.js
// Radar minimap & full-screen interactive map of Ciudad Obregón, in place of js/nyc-map.js (same page elements, same
// interface for main.js). Both draw from one pre-rendered base map of the detailed area (blocks, parks, the lagoon &
// canals, the mapped buildings, every street at its width), north up, with the player, the traffic, the landmarks
// and the street names on top. Click the full map to teleport; drag to pan, scroll or +/- to zoom; search streets &
// landmarks.

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const BASE_SCALE = 0.45; // base map pixels per metre (~3060 x 2250 px over the detailed area)
const RADAR_SCALE = 0.55; // radar CSS pixels per metre
const MIN_ZOOM = 0.04;
const MAX_ZOOM = 3.5;
const C = {
  ground: '#d9cdb4', block: '#efe6d2', park: '#a9cf8e', water: '#7fb3d6', building: '#cdbba0', landmark: '#c98762',
  street: '#ffffff', major: '#f6c869', casing: '#b9ab92', label: '#3b3326'
};

const MAJOR = new Set(['trunk', 'primary', 'secondary']);

// Street labels: the straight runs of each named street, its pieces between junctions joined end to end where they
// carry on in line (the grid's streets run north-south or east-west, 2 m apart at most), longest first
const LABELS = (() => {
  const groups = new Map(); // name | axis | line -> [{ a, b, major }] intervals along the axis
  const loose = [];
  for (const s of ROAD_SEGMENTS) {
    if (!s.name) continue;
    const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
    const L = Math.hypot(dx, dz);
    if (L < 1) continue;
    const major = MAJOR.has(s.kind);
    let key, a, b;
    if (Math.abs(dx) < L * 0.02) {
      key = `${s.name}|ns|${Math.round((s.x0 + s.x1) / 4)}`;
      a = Math.min(s.z0, s.z1); b = Math.max(s.z0, s.z1);
    } else if (Math.abs(dz) < L * 0.02) {
      key = `${s.name}|ew|${Math.round((s.z0 + s.z1) / 4)}`;
      a = Math.min(s.x0, s.x1); b = Math.max(s.x0, s.x1);
    } else {
      loose.push({ name: s.name, text: signName(s.name), s, len: L, major });
      continue;
    }
    if (!groups.has(key)) groups.set(key, { name: s.name, at: (key.includes('|ns|') ? (s.x0 + s.x1) : (s.z0 + s.z1)) / 2, ns: key.includes('|ns|'), spans: [] });
    groups.get(key).spans.push({ a, b, major });
  }
  const out = [...loose];
  for (const g of groups.values()) {
    g.spans.sort((p, q) => p.a - q.a);
    let run = null;
    const flush = () => {
      if (!run) return;
      const s = g.ns ? { x0: g.at, z0: run.a, x1: g.at, z1: run.b } : { x0: run.a, z0: g.at, x1: run.b, z1: g.at };
      out.push({ name: g.name, text: signName(g.name), s, len: run.b - run.a, major: run.major });
    };
    for (const sp of g.spans) {
      if (run && sp.a <= run.b + 30) {
        run.b = Math.max(run.b, sp.b);
        run.major = run.major || sp.major;
      } else {
        flush();
        run = { ...sp };
      }
    }
    flush();
  }
  return out.sort((p, q) => q.len - p.len);
})();

class NYCMapSystem {
  constructor({ controllerManager, cameraSystem, trafficSystem, onTeleport, onToggle }) {
    this.controllerManager = controllerManager;
    this.cameraSystem = cameraSystem;
    this.trafficSystem = trafficSystem;
    this.onTeleport = onTeleport;
    this.onToggle = onToggle;

    this.miniCanvas = document.getElementById('minimap-canvas');
    this.miniCtx = this.miniCanvas ? this.miniCanvas.getContext('2d') : null;
    this.modal = document.getElementById('fullmap-modal');
    this.fullCanvas = document.getElementById('fullmap-canvas');
    this.fullCanvasWrap = document.getElementById('fullmap-canvas-wrap');
    this.fullCtx = this.fullCanvas ? this.fullCanvas.getContext('2d') : null;
    this.fullDpr = 1;
    this.elHoverInfo = document.getElementById('fullmap-hover-info');
    this.elPlayerInfo = document.getElementById('fullmap-player-info');
    this.elSearchInput = document.getElementById('fullmap-search');
    const elCounts = document.getElementById('fullmap-counts');
    if (elCounts) elCounts.textContent = `${ROADS.length} calles · ${BLOCKS.length.toLocaleString('es-MX')} manzanas`;

    this.isFullMapOpen = false;
    this.viewCenterX = 0;
    this.viewCenterZ = 0;
    this.viewZoom = 0.3;
    this.panPointerId = null;
    this.panStart = { x: 0, y: 0, cx: 0, cz: 0 };
    this.dragMoved = false;
    this.searchSegments = null;
    this.textWidths = new Map();
    this.waypoint = { x: 0, z: 40, name: 'Plaza Álvaro Obregón' }; // (the plaza's teleport, city-config.js)

    this.base = this.renderBase();
    this.initEvents();
  }

  // The static base map, BASE_SCALE pixels per metre over the detailed area
  renderBase() {
    const b = ISLAND_BOUNDS;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((b.maxX - b.minX) * BASE_SCALE);
    canvas.height = Math.ceil((b.maxZ - b.minZ) * BASE_SCALE);
    const ctx = canvas.getContext('2d');
    const X = (x) => (x - b.minX) * BASE_SCALE;
    const Z = (z) => (z - b.minZ) * BASE_SCALE;
    const poly = (pts) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Z(p.z)) : ctx.moveTo(X(p.x), Z(p.z))));
      ctx.closePath();
    };
    ctx.fillStyle = C.ground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // streets first (casing, then fill), so the blocks' sidewalks overlap their edges cleanly
    const RG = GEO.roadGraph;
    const strokeRoads = (extra, colorOf) => {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const [a, bb, , w, , , inner, k] of RG.links) {
        ctx.beginPath();
        ctx.moveTo(X(RG.nodes[a * 2]), Z(RG.nodes[a * 2 + 1]));
        for (let i = 0; i < inner.length; i += 2) ctx.lineTo(X(inner[i]), Z(inner[i + 1]));
        ctx.lineTo(X(RG.nodes[bb * 2]), Z(RG.nodes[bb * 2 + 1]));
        ctx.lineWidth = (w + extra) * BASE_SCALE;
        ctx.strokeStyle = colorOf(RG.kinds[k]);
        ctx.stroke();
      }
    };
    strokeRoads(3, () => C.casing);
    for (const blk of BLOCKS) {
      if (blk.water) continue;
      ctx.fillStyle = C.block;
      poly(blk.poly);
      ctx.fill();
    }
    ctx.fillStyle = C.park;
    for (const p of PARKS) {
      poly(p.poly);
      ctx.fill();
    }
    ctx.strokeStyle = C.water;
    ctx.lineCap = 'round';
    for (const c of GEO.canals) {
      const pts = toPts(c.pts);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Z(p.z)) : ctx.moveTo(X(p.x), Z(p.z))));
      ctx.lineWidth = c.w * BASE_SCALE;
      ctx.stroke();
    }
    ctx.fillStyle = C.water;
    for (const w of WATER) {
      poly(w.poly);
      ctx.fill();
    }
    strokeRoads(0, (k) => (MAJOR.has(k) ? C.major : C.street));
    for (const bld of GEO.buildings) {
      ctx.fillStyle = bld.name ? C.landmark : C.building;
      poly(toPts(bld.ring));
      ctx.fill();
    }
    return canvas;
  }

  initEvents() {
    const on = (id, type, fn) => document.getElementById(id)?.addEventListener(type, fn);
    on('minimap-card', 'click', () => this.toggleFullMap(true));
    on('close-fullmap-btn', 'click', () => this.toggleFullMap(false));
    on('map-zoom-in', 'click', () => { this.viewZoom = Math.min(MAX_ZOOM, this.viewZoom * 1.45); this.renderFullMap(); });
    on('map-zoom-out', 'click', () => { this.viewZoom = Math.max(MIN_ZOOM, this.viewZoom / 1.45); this.renderFullMap(); });
    on('map-center-player', 'click', () => {
      const p = this.controllerManager.getActiveEntity().position;
      this.viewCenterX = p.x;
      this.viewCenterZ = p.z;
      this.viewZoom = 1.0;
      this.renderFullMap();
    });
    on('map-view-all', 'click', () => {
      const b = ISLAND_BOUNDS;
      const { w, h } = this.fullSize();
      this.viewCenterX = (b.minX + b.maxX) / 2;
      this.viewCenterZ = (b.minZ + b.maxZ) / 2;
      this.viewZoom = Math.min(w / ((b.maxX - b.minX) * 1.05), h / ((b.maxZ - b.minZ) * 1.05));
      this.renderFullMap();
    });
    this.elSearchInput?.addEventListener('input', () => this.search(this.elSearchInput.value));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isFullMapOpen) this.toggleFullMap(false);
      else if (e.code === 'KeyM' && !isTypingInField(e)) this.toggleFullMap(!this.isFullMapOpen);
    });

    const cv = this.fullCanvas;
    if (!cv) return;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.isFullMapOpen || this.panPointerId !== null) return;
      e.preventDefault();
      this.panPointerId = e.pointerId;
      cv.setPointerCapture(e.pointerId);
      this.dragMoved = false;
      Object.assign(this.panStart, { x: e.clientX, y: e.clientY, cx: this.viewCenterX, cz: this.viewCenterZ });
      this.fullCanvasWrap?.classList.add('is-panning');
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.isFullMapOpen) return;
      const rect = cv.getBoundingClientRect();
      if (this.panPointerId === e.pointerId) {
        const dx = e.clientX - this.panStart.x, dy = e.clientY - this.panStart.y;
        if (Math.hypot(dx, dy) > 5) this.dragMoved = true;
        this.viewCenterX = this.panStart.cx - dx / this.viewZoom;
        this.viewCenterZ = this.panStart.cz - dy / this.viewZoom;
        this.renderFullMap();
      } else if (e.pointerType === 'mouse' && this.elHoverInfo) {
        const p = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
        this.elHoverInfo.textContent = `${getLocationLabel(p.x, p.z)} · Click to teleport here`;
      }
    });
    cv.addEventListener('pointerup', (e) => {
      if (e.pointerId !== this.panPointerId) return;
      const clicked = !this.dragMoved;
      this.cancelPan();
      if (!clicked || !this.isFullMapOpen) return;
      const rect = cv.getBoundingClientRect();
      const p = this.clampToCity(this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height));
      this.waypoint = { x: p.x, z: p.z, name: getLocationLabel(p.x, p.z) };
      if (this.onTeleport) this.onTeleport(p.x, p.z);
      this.renderFullMap();
    });
    for (const type of ['pointercancel', 'lostpointercapture']) cv.addEventListener(type, (e) => e.pointerId === this.panPointerId && this.cancelPan());
    window.addEventListener('blur', () => this.cancelPan());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const before = this.screenToWorld(mx, my, rect.width, rect.height);
      this.viewZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.viewZoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
      this.viewCenterX = before.x - (mx - rect.width / 2) / this.viewZoom;
      this.viewCenterZ = before.z - (my - rect.height / 2) / this.viewZoom;
      this.renderFullMap();
    }, { passive: false });
  }

  search(text) {
    const q = String(text || '').trim().toLowerCase();
    this.searchSegments = null;
    if (q) {
      const lm = NYC_LANDMARKS.find((l) => l.name.toLowerCase().includes(q));
      const segs = ROAD_SEGMENTS.filter((s) => s.name && s.name.toLowerCase().includes(q));
      if (segs.length) this.searchSegments = segs;
      if (lm) {
        this.viewCenterX = lm.x;
        this.viewCenterZ = lm.z;
        this.viewZoom = Math.max(this.viewZoom, 1.0);
      } else if (segs.length) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const s of segs) {
          minX = Math.min(minX, s.x0, s.x1); maxX = Math.max(maxX, s.x0, s.x1);
          minZ = Math.min(minZ, s.z0, s.z1); maxZ = Math.max(maxZ, s.z0, s.z1);
        }
        const { w, h } = this.fullSize();
        this.viewCenterX = (minX + maxX) / 2;
        this.viewCenterZ = (minZ + maxZ) / 2;
        this.viewZoom = Math.max(MIN_ZOOM, Math.min(1.2, w / ((maxX - minX) * 1.3 + 1), h / ((maxZ - minZ) * 1.3 + 1)));
      }
    }
    this.renderFullMap();
  }

  cancelPan() {
    const id = this.panPointerId;
    this.panPointerId = null;
    this.fullCanvasWrap?.classList.remove('is-panning');
    if (id !== null && this.fullCanvas?.hasPointerCapture(id)) this.fullCanvas.releasePointerCapture(id);
  }

  toggleFullMap(open) {
    this.isFullMapOpen = Boolean(open);
    if (!this.isFullMapOpen) this.cancelPan();
    if (this.onToggle) this.onToggle(this.isFullMapOpen);
    if (!this.modal) return;
    this.modal.classList.toggle('hidden', !this.isFullMapOpen);
    if (this.isFullMapOpen) {
      for (const pop of document.querySelectorAll('.popover[popover]')) {
        if (typeof pop.hidePopover === 'function' && pop.matches(':popover-open')) pop.hidePopover();
      }
      const p = this.controllerManager.getActiveEntity().position;
      this.viewCenterX = p.x;
      this.viewCenterZ = p.z;
      this.resizeFullCanvas();
      this.renderFullMap();
    }
  }

  resizeFullCanvas() {
    if (!this.fullCanvas) return;
    const w = this.fullCanvas.clientWidth || window.innerWidth;
    const h = this.fullCanvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6e6 / Math.max(1, w * h)));
    this.fullDpr = dpr;
    this.fullCanvas.width = Math.max(1, Math.floor(w * dpr));
    this.fullCanvas.height = Math.max(1, Math.floor(h * dpr));
  }

  fullSize() {
    if (!this.fullCanvas) return { w: 1200, h: 800 };
    return { w: this.fullCanvas.width / this.fullDpr, h: this.fullCanvas.height / this.fullDpr };
  }

  screenToWorld(sx, sy, width, height) {
    return { x: this.viewCenterX + (sx - width / 2) / this.viewZoom, z: this.viewCenterZ + (sy - height / 2) / this.viewZoom };
  }

  clampToCity(p) {
    const b = ISLAND_BOUNDS;
    return { x: Math.max(b.minX + 20, Math.min(b.maxX - 20, p.x)), z: Math.max(b.minZ + 20, Math.min(b.maxZ - 20, p.z)) };
  }

  // Draws the area around (cx, cz) at `zoom` px/m into ctx (w x h CSS px), with the dynamic layers on top
  drawView(ctx, w, h, cx, cz, zoom, { labels = true, cars = true, landmarks = true } = {}) {
    const b = ISLAND_BOUNDS;
    const S = (x, z) => [w / 2 + (x - cx) * zoom, h / 2 + (z - cz) * zoom];
    ctx.fillStyle = '#c9bea4';
    ctx.fillRect(0, 0, w, h);
    // only the part of the base map in view (source pixels -> screen)
    const x0 = Math.max(b.minX, cx - w / 2 / zoom), x1 = Math.min(b.maxX, cx + w / 2 / zoom);
    const z0 = Math.max(b.minZ, cz - h / 2 / zoom), z1 = Math.min(b.maxZ, cz + h / 2 / zoom);
    if (x1 > x0 && z1 > z0) {
      const [dx, dy] = S(x0, z0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.base, (x0 - b.minX) * BASE_SCALE, (z0 - b.minZ) * BASE_SCALE, (x1 - x0) * BASE_SCALE, (z1 - z0) * BASE_SCALE,
        dx, dy, (x1 - x0) * zoom, (z1 - z0) * zoom);
    }

    if (this.searchSegments) {
      ctx.strokeStyle = '#e8442f';
      ctx.lineWidth = Math.max(3, 6 * zoom);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const s of this.searchSegments) {
        ctx.moveTo(...S(s.x0, s.z0));
        ctx.lineTo(...S(s.x1, s.z1));
      }
      ctx.stroke();
    }

    if (labels && zoom > 0.25) {
      ctx.font = `600 ${Math.round(Math.min(13, 8 + zoom * 4))}px ${FONT}`;
      ctx.fillStyle = C.label;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const drawn = []; // screen boxes of the labels so far: no label over another
      for (const l of LABELS) {
        if (!l.major && zoom < 0.7) continue;
        const [x0, y0] = S(l.s.x0, l.s.z0);
        const [x1, y1] = S(l.s.x1, l.s.z1);
        if (Math.max(x0, x1) < -50 || Math.min(x0, x1) > w + 50 || Math.max(y0, y1) < -50 || Math.min(y0, y1) > h + 50) continue;
        const len = Math.hypot(x1 - x0, y1 - y0);
        const tw = this.textWidth(ctx, l.text);
        if (len < tw + 12) continue;
        // on the run, as near the middle of the view as its ends allow
        const t = Math.max(0, Math.min(1, ((w / 2 - x0) * (x1 - x0) + (h / 2 - y0) * (y1 - y0)) / (len * len)));
        const m = (tw / 2 + 6) / len;
        const tt = Math.max(m, Math.min(1 - m, t));
        const mx = x0 + (x1 - x0) * tt, my = y0 + (y1 - y0) * tt;
        if (mx < -50 || mx > w + 50 || my < -50 || my > h + 50) continue;
        const horizontal = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
        const box = horizontal ? [mx - tw / 2 - 4, mx + tw / 2 + 4, my - 8, my + 8] : [mx - 8, mx + 8, my - tw / 2 - 4, my + tw / 2 + 4];
        if (drawn.some((d) => d[0] < box[1] && d[1] > box[0] && d[2] < box[3] && d[3] > box[2])) continue;
        drawn.push(box);
        let a = Math.atan2(y1 - y0, x1 - x0);
        if (a > Math.PI / 2) a -= Math.PI;
        if (a < -Math.PI / 2) a += Math.PI;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(a);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.strokeText(l.text, 0, 0);
        ctx.fillText(l.text, 0, 0);
        ctx.restore();
      }
    }

    if (cars && this.trafficSystem?.cars) {
      ctx.fillStyle = 'rgba(40,40,48,0.8)';
      for (const car of this.trafficSystem.cars) {
        const [x, y] = S(car.x, car.z);
        if (x < 0 || x > w || y < 0 || y > h) continue;
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }

    if (landmarks) {
      for (const l of NYC_LANDMARKS) {
        const [x, y] = S(l.x, l.z);
        if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue;
        ctx.fillStyle = '#c0392b';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        if (zoom > 0.5) {
          ctx.font = `700 11px ${FONT}`;
          ctx.textAlign = 'left';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.strokeText(l.name, x + 7, y);
          ctx.fillStyle = '#5a1f17';
          ctx.fillText(l.name, x + 7, y);
        }
      }
    }

    if (this.waypoint) {
      const [x, y] = S(this.waypoint.x, this.waypoint.z);
      ctx.fillStyle = '#f2b705';
      ctx.strokeStyle = '#3b3326';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // the player: an arrow along its heading (heading 0 = +z, south = down)
    const ent = this.controllerManager.getActiveEntity();
    const [px, py] = S(ent.position.x, ent.position.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-ent.heading);
    ctx.fillStyle = '#1e88e5';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(7, -7);
    ctx.lineTo(0, -3);
    ctx.lineTo(-7, -7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Text widths, measured once per font
  textWidth(ctx, text) {
    const key = `${ctx.font}|${text}`;
    let w = this.textWidths.get(key);
    if (w === undefined) this.textWidths.set(key, (w = ctx.measureText(text).width));
    return w;
  }

  renderFullMap() {
    if (!this.isFullMapOpen || !this.fullCtx) return;
    const { w, h } = this.fullSize();
    this.fullCtx.setTransform(this.fullDpr, 0, 0, this.fullDpr, 0, 0);
    this.drawView(this.fullCtx, w, h, this.viewCenterX, this.viewCenterZ, this.viewZoom);
    if (this.elPlayerInfo) {
      const p = this.controllerManager.getActiveEntity().position;
      this.elPlayerInfo.textContent = `You are at ${getLocationLabel(p.x, p.z)}`;
    }
  }

  update() {
    if (this.isFullMapOpen) {
      this.renderFullMap();
      return;
    }
    const cv = this.miniCanvas;
    if (!cv || !this.miniCtx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 280, h = cv.clientHeight || 180;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const p = this.controllerManager.getActiveEntity().position;
    this.miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawView(this.miniCtx, w, h, p.x, p.z, RADAR_SCALE, { landmarks: false });
  }
}

export { NYCMapSystem };
