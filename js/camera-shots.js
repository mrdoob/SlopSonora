import { bryantParkLawn } from './landmarks.js';

// js/camera-shots.js
// The city's scenic cameras (cameras.js): 7 iconic NYC vantage points and the auto-director drone. Each shot sets the
// camera's desired position & look-at point for the elapsed time; the camera system eases towards them. `key`: the
// keyboard shortcut (main.js).

const SCENIC_SHOTS = [
  {
    id: 'centralPark', name: 'Central Park Oasis', short: 'Central Pk', fov: 52,
    // Inside Central Park South looking across The Pond, Gapstow Bridge, The Mall, Sheep Meadow & UWS/UES Skylines
    shot(elapsed, pos, look) {
      const sway = Math.sin(elapsed * 0.22) * 3.5;
      pos.set(-70.0 + sway, 14.0, -1425.0);
      look.set(-250.0, 6.5, -1690.0);
    }
  },
  {
    id: 'fifthAve', name: '5th Ave & Empire State', short: '5th Ave', fov: 48, key: 'Digit8',
    // 5th Avenue & 42nd St looking South down the 5th Ave canyon toward the Empire State Building
    shot(elapsed, pos, look) {
      const sway = Math.sin(elapsed * 0.25) * 1.8;
      pos.set(0.0 + sway, 6.5, -20.0);
      look.set(-60.0, 150.0, 686.0);
    }
  },
  {
    id: 'timesSquare', name: 'Times Square Crossroads', short: 'Times Sq', fov: 58, key: 'Digit9',
    // Times Square & Broadway looking across Duffy Square red steps and One Times Square billboards
    shot(elapsed, pos, look) {
      const sway = Math.sin(elapsed * 0.3) * 3.0;
      pos.set(-603.0 + sway, 5.5, -290.0);
      look.set(-566.0, 40.0, -40.0);
    }
  },
  {
    id: 'chryslerGCT', name: '42nd St · Chrysler & GCT', short: 'Chrysler', fov: 50, key: 'Digit0',
    // Park Ave & 42nd St intersection looking straight at Grand Central, MetLife, and Chrysler Building Crown
    shot(elapsed, pos, look) {
      const sway = Math.cos(elapsed * 0.22) * 2.5;
      pos.set(300.0 + sway, 9.5, 95.0);
      look.set(470.0, 120.0, -50.0);
    }
  },
  {
    id: 'observatory', name: 'Empire State 86th Deck', short: '86th Deck', fov: 52,
    // Empire State Building 86th Floor Deck looking North-East across Midtown skyline
    shot(elapsed, pos, look) {
      const pan = Math.sin(elapsed * 0.18) * 80.0;
      pos.set(-58.0, 322.0, 660.0);
      look.set(420.0 + pan, 150.0, -200.0);
    }
  },
  {
    id: 'bryantPark', name: 'Bryant Park & NYPL', short: 'Bryant Pk', fov: 52,
    // Inside Bryant Park Great Lawn looking East toward NYPL portico, One Vanderbilt & Chrysler Building
    shot(elapsed, pos, look) {
      const sway = Math.sin(elapsed * 0.25) * 1.5;
      const lawn = bryantParkLawn || { minX: -260, maxX: -150, minZ: 40, maxZ: 120, top: 1.3 };
      const lz = (lawn.minZ + lawn.maxZ) * 0.5;
      pos.set(lawn.minX + 18.0, lawn.top + 1.7, lz + sway);
      look.set(lawn.maxX + 260.0, 70.0, lz - 60.0);
    }
  },
  {
    id: 'waterfront', name: 'East River & Skyline', short: 'Skyline', fov: 46,
    // Over the shimmering East River looking across the FDR Drive, Queensboro Bridge & Midtown Skyline
    shot(elapsed, pos, look) {
      const drift = Math.sin(elapsed * 0.15) * 40.0;
      pos.set(1640.0, 60.0, 60.0 + drift);
      look.set(150.0, 150.0, -150.0);
    }
  },
  {
    id: 'drone', name: 'Auto-Director Aerial', short: 'Director', fov: 50,
    shot(elapsed, pos, look) {
      const angle = elapsed * 0.07 + 0.65;
      const radius = 720.0 + Math.sin(elapsed * 0.23) * 140.0;
      const alt = 330.0 + Math.cos(elapsed * 0.19) * 90.0;
      pos.set(Math.cos(angle) * radius + 60.0, alt, Math.sin(angle) * radius + 250.0);
      look.set(60.0, 160.0, 250.0);
    }
  }
];

export { SCENIC_SHOTS };
