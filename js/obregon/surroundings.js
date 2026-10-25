import * as THREE from 'three/webgpu';
import { ISLAND_BOUNDS } from './city-config.js';
import { createFarmlandMaterial } from './materials.js';

// js/obregon/surroundings.js
// What lies around the detailed city, in place of js/boroughs.js: the irrigated plain of the Valle del Yaqui, field
// after field out to where the haze closes in (the time-of-day fog, lighting.js, hides the horizon ~10 km out).

const FIELD_Y = -0.06;
const REACH = 16000;

function buildBoroughs(scene) {
  const group = new THREE.Group();
  group.name = 'Boroughs'; // (the name main.js culls the surroundings by)
  const cx = (ISLAND_BOUNDS.minX + ISLAND_BOUNDS.maxX) / 2;
  const cz = (ISLAND_BOUNDS.minZ + ISLAND_BOUNDS.maxZ) / 2;
  // a square around the city with the detailed area cut out (its own ground & lagoons lie there, city-grid.js), drawn
  // in x / -z so that turning it face up lays it on x / z
  const b = ISLAND_BOUNDS;
  const v = (x, z) => new THREE.Vector2(x, -z);
  const outer = new THREE.Shape([v(cx - REACH, cz - REACH), v(cx + REACH, cz - REACH), v(cx + REACH, cz + REACH), v(cx - REACH, cz + REACH)]);
  outer.holes.push(new THREE.Path([v(b.minX, b.minZ), v(b.minX, b.maxZ), v(b.maxX, b.maxZ), v(b.maxX, b.minZ)]));
  const geo = new THREE.ShapeGeometry(outer);
  geo.rotateX(-Math.PI / 2);
  geo.deleteAttribute('uv');
  const fields = new THREE.Mesh(geo, createFarmlandMaterial());
  fields.position.set(0, FIELD_Y, 0);
  fields.name = 'ValleDelYaqui';
  fields.receiveShadow = true;
  fields.matrixAutoUpdate = false;
  fields.updateMatrix();
  group.add(fields);
  scene.add(group);
  return { group, colliders: [] };
}

export { buildBoroughs };
