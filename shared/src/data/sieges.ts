// Fort sieges, after L2's fortress sieges. Every Saturday at 21:00 (Argentina) the five forts past the village are
// fought over for an hour. A Fort Guardian stands by each fort's brazier, and it never fights the owning clan or its
// alliance. When it falls, the clan that dealt it the most damage takes the fort; if it stands the hour, the owner
// keeps it. While it lasts, the fort and its surroundings are a PvP zone instead of a peace zone. The owner earns a
// tax on the adena spent at the fort's merchants.
// The server reads these from server-rs/data/game.json (tools/scripts/export-data.ts).
import { ROAD_LINES } from '../terrain';
import { FORTS } from '../village';

export const SIEGE = {
  /** when it starts: the weekday (0 = Monday) and hour in Argentina (UTC-3), and how long it lasts (minutes) */
  weekday: 5,
  hour: 21,
  minutes: 60,
  /** everyone is warned this many minutes before */
  warn: [30, 10, 1],
  /** the siege zone reaches the fort's radius plus this (m); the attackers' camps stand this far out, on the roads */
  zone: 40,
  camp: 45,
  /** the clan level that may take a fort (each clan holds one at most) */
  level: 3,
  /** the owner's cut of the adena spent at the fort's merchants (buying, crafting, teleports), on top of the price */
  tax: 0.1,
  /** the mob that defends each fort (mobs.ts) */
  guardian: 'fort_guardian',
};

/** A fort that is sieged: its town's centre and radius, and the camps where the attackers come back. */
export interface SiegeFort { id: string; name: string; x: number; z: number; r: number; camps: [number, number][] }

/** Where each road out of the town first gets `d` m from its centre (one camp a gate, as the gates face the roads). */
function roadsOut(t: { x: number; z: number }, d: number): [number, number][] {
  const out: [number, number][] = [];
  const at = (p: [number, number]) => Math.hypot(p[0] - t.x, p[1] - t.z) < 1;
  for (const l of ROAD_LINES) {
    const line = at(l[0]) ? l : at(l[l.length - 1]) ? [...l].reverse() : null;
    if (!line) continue;
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1], [bx, bz] = line[i];
      if (Math.hypot(bx - t.x, bz - t.z) < d) continue;
      // the first leg that leaves the circle: step along it to where it crosses
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s <= len; s += 0.5) {
        const x = ax + ((bx - ax) * s) / len, z = az + ((bz - az) * s) / len;
        if (Math.hypot(x - t.x, z - t.z) >= d) { out.push([+x.toFixed(2), +z.toFixed(2)]); break; }
      }
      break;
    }
  }
  return out;
}

export const SIEGE_FORTS: SiegeFort[] = FORTS.map((f) => ({
  id: f.id, name: f.town.name, x: f.town.x, z: f.town.z, r: f.town.r, camps: roadsOut(f.town, f.town.r + SIEGE.camp),
}));

/** The fort under siege whose zone holds (x, z), given the forts being fought over now. */
export function siegeZoneAt(x: number, z: number, active: readonly string[]): SiegeFort | undefined {
  if (!active.length) return undefined;
  return SIEGE_FORTS.find((f) => active.includes(f.id) && Math.hypot(x - f.x, z - f.z) < f.r + SIEGE.zone);
}

/** An adena price at a fort's merchant, with its owner's tax (server-rs siege.rs with_tax: the same rounding). */
export const withTax = (price: number, tax: number) => price + Math.round(price * tax);
