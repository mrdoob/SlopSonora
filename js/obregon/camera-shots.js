import { NYC_LANDMARKS } from './city-config.js';

// js/obregon/camera-shots.js
// Ciudad Obregón's scenic cameras, in place of js/camera-shots.js (cameras.js eases towards each shot's position &
// look-at point). `key`: the keyboard shortcut (main.js).

const at = (re, fallback) => NYC_LANDMARKS.find((l) => re.test(l.name)) || fallback;
const catedral = at(/Catedral/, { x: -14, z: -109 });
const palacio = at(/Palacio Municipal/, { x: 106, z: 7 });
const laguna = at(/Laguna del N/, { x: -3612, z: -42 });
const itson = at(/Rector/, { x: -81, z: 1421 });

const SCENIC_SHOTS = [
  {
    id: 'plaza', name: 'Plaza Álvaro Obregón & Catedral', short: 'Plaza', fov: 52, key: 'Digit8',
    // From the plaza's south side, looking north across it to the cathedral's front
    shot(elapsed, pos, look) {
      const sway = Math.sin(elapsed * 0.22) * 4.0;
      pos.set(catedral.x + 12 + sway, 6.5, catedral.z + 150);
      look.set(catedral.x, 9.0, catedral.z);
    }
  },
  {
    id: 'palacio', name: 'Palacio Municipal', short: 'Palacio', fov: 50, key: 'Digit9',
    shot(elapsed, pos, look) {
      const sway = Math.sin(elapsed * 0.25) * 2.0;
      pos.set(palacio.x - 70 + sway, 4.5, palacio.z + 60);
      look.set(palacio.x, 6.0, palacio.z);
    }
  },
  {
    id: 'alleman', name: 'Avenida Miguel Alemán', short: 'Miguel Alemán', fov: 55, key: 'Digit0',
    // Low over the boulevard looking north up it
    shot(elapsed, pos, look) {
      const drift = Math.sin(elapsed * 0.12) * 30.0;
      pos.set(268, 9.0, 900 + drift);
      look.set(275, 4.0, -400);
    }
  },
  {
    id: 'nainari', name: 'Laguna del Náinari', short: 'Náinari', fov: 50,
    // Over the lagoon's eastern shore at golden hour's sun, looking west across the water
    shot(elapsed, pos, look) {
      const pan = Math.sin(elapsed * 0.1) * 120.0;
      pos.set(laguna.x + 420, 28.0, laguna.z + 260);
      look.set(laguna.x - 200, 0.0, laguna.z - 60 + pan);
    }
  },
  {
    id: 'itson', name: 'ITSON · Campus Centro', short: 'ITSON', fov: 52,
    shot(elapsed, pos, look) {
      const sway = Math.sin(elapsed * 0.2) * 3.0;
      pos.set(itson.x + 90 + sway, 12.0, itson.z - 110);
      look.set(itson.x, 4.0, itson.z);
    }
  },
  {
    id: 'drone', name: 'Auto-Director Aerial', short: 'Director', fov: 50,
    // Circling high over downtown
    shot(elapsed, pos, look) {
      const angle = elapsed * 0.05 + 0.65;
      const radius = 900.0 + Math.sin(elapsed * 0.23) * 160.0;
      const alt = 260.0 + Math.cos(elapsed * 0.19) * 60.0;
      pos.set(Math.cos(angle) * radius + 100.0, alt, Math.sin(angle) * radius + 200.0);
      look.set(100.0, 0.0, 200.0);
    }
  }
];

export { SCENIC_SHOTS };
