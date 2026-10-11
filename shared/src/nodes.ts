// Things in the world a character can use: trees to fell, rocks to mine, fruit bushes to pick and seats.
// Built from the shared layouts, so client and server agree on every node's id and place. The server runs
// the gathering and owns which nodes are spent (it reads all of this from server-rs/data/game.json).
import { layoutBushes, layoutRocks, layoutSeats, layoutTrees, zoneOf } from './layout';

export type NodeKind = 'tree' | 'rock' | 'bush' | 'seat';

/** Ids: kind base + index into that kind's layout. Stable as long as the layouts are. */
export const NODE_BASE: Record<NodeKind, number> = { tree: 100000, rock: 200000, bush: 300000, seat: 400000 };

export interface NodeDef {
  id: number;
  kind: NodeKind;
  x: number;
  z: number;
  /** body radius: how close the character can stand */
  r: number;
  /** facing (seats) */
  ry?: number;
  /** seat height above the ground */
  y?: number;
  /** zone id at the node (picks the yield) */
  zone?: string;
}

/** One possible yield of a gather: `chance` to get between `min` and `max`; `zones` limits it to those zones. */
export interface Yield { item: string; min: number; max: number; chance: number; zones?: string[] }

export interface GatherDef {
  /** weapon types that work as the tool (null: bare hands) */
  tools: string[] | null;
  /** time per swing, and swings per gather */
  swingMs: number;
  swings: number;
  /** until the node is back */
  respawnMs: number;
  anim: 'chop' | 'mine' | 'pick';
  yields: Yield[];
}

export const GATHER: Record<Exclude<NodeKind, 'seat'>, GatherDef> = {
  tree: { tools: ['axe'], swingMs: 1000, swings: 4, respawnMs: 180_000, anim: 'chop', yields: [{ item: 'wood_log', min: 1, max: 3, chance: 1 }] },
  rock: {
    tools: ['pickaxe', 'blunt'], swingMs: 1100, swings: 4, respawnMs: 240_000, anim: 'mine',
    yields: [
      { item: 'raw_stone', min: 1, max: 3, chance: 1 },
      // the hills and the orc barracks sit on iron
      { item: 'iron_ore', min: 1, max: 2, chance: 0.6, zones: ['hills', 'barracks'] },
      { item: 'iron_ore', min: 1, max: 1, chance: 0.2 },
    ],
  },
  bush: { tools: null, swingMs: 2200, swings: 1, respawnMs: 90_000, anim: 'pick', yields: [{ item: 'wild_berries', min: 2, max: 4, chance: 1 }] },
};

/** Pebbles are too small to mine (they are also walkable). */
const MIN_ROCK = 0.45;

let nodes: NodeDef[] | null = null;
let byId: Map<number, NodeDef> | null = null;

export function allNodes(): NodeDef[] {
  if (nodes) return nodes;
  nodes = [];
  layoutTrees().forEach((t, i) => nodes!.push({ id: NODE_BASE.tree + i, kind: 'tree', x: t.x, z: t.z, r: 0.35 * t.sc + 0.2, zone: zoneOf(t.x, t.z)?.id }));
  layoutRocks().forEach((r, i) => {
    if (r.sc > MIN_ROCK) nodes!.push({ id: NODE_BASE.rock + i, kind: 'rock', x: r.x, z: r.z, r: Math.min(r.s[0], r.s[2]) * 0.85, zone: zoneOf(r.x, r.z)?.id });
  });
  layoutBushes().forEach((b, i) => {
    if (b.fruit) nodes!.push({ id: NODE_BASE.bush + i, kind: 'bush', x: b.x, z: b.z, r: 0.5 * b.sc, zone: zoneOf(b.x, b.z)?.id });
  });
  layoutSeats().forEach((s, i) => nodes!.push({ id: NODE_BASE.seat + i, kind: 'seat', x: s.x, z: s.z, r: 0, ry: s.ry, y: s.y }));
  return nodes;
}

export function nodeById(id: number): NodeDef | undefined {
  byId ??= new Map(allNodes().map((n) => [n.id, n]));
  return byId.get(id);
}

/** Index into the kind's layout (layoutTrees()[i], layoutRocks()[i]...). */
export const nodeIndex = (n: NodeDef) => n.id - NODE_BASE[n.kind];

// ---------------------------------------------------------------- spatial hash (same scheme as collision.ts)
const CELL = 8;
let hash: Map<number, NodeDef[]> | null = null;
const hkey = (cx: number, cz: number) => (cx + 1000) * 4096 + (cz + 1000);

/** Nodes whose centre is within r of (x, z), nearest first. */
export function nodesNear(x: number, z: number, r: number): NodeDef[] {
  if (!hash) {
    hash = new Map();
    for (const n of allNodes()) {
      const k = hkey(Math.floor(n.x / CELL), Math.floor(n.z / CELL));
      let l = hash.get(k);
      if (!l) hash.set(k, (l = []));
      l.push(n);
    }
  }
  const out: { n: NodeDef; d: number }[] = [];
  for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
    for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++)
      for (const n of hash.get(hkey(cx, cz)) ?? []) {
        const d = Math.hypot(n.x - x, n.z - z);
        if (d <= r) out.push({ n, d });
      }
  return out.sort((a, b) => a.d - b.d).map((o) => o.n);
}

/** How far from a node's centre a character can use it. */
export const reachOf = (n: NodeDef) => (n.kind === 'seat' ? 0.3 : n.r + 0.9);
