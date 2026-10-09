// Compact binary frame for the hot path of the protocol: per-entity snapshot
// updates (sent 10×/s for everything in view) and despawns. Everything else is JSON.
//
// Layout (little endian):
//   u8  type (= SNAP_UPD)
//   u16 update count, u16 gone count, u32 server time (ms, wraps every ~49 days)
//   update × n: u32 id, i16 x·50, i16 z·50, i16 ry·10000, u8 hp%, u16 flags   (13 bytes)
//   gone   × m: u32 id
import type { EntUpd, S2C } from './protocol';

export const SNAP_UPD = 1;
const UPD_BYTES = 13;
const HEADER = 9;

/** Quantize a position the way the wire does (1/50 unit), so diffs match what clients see. */
export const qPos = (v: number) => Math.round(v * 50) / 50;
/** Quantize a heading (radians, −π..π) to the wire's 1/10000 rad. */
export const qRot = (v: number) => Math.round(Math.atan2(Math.sin(v), Math.cos(v)) * 10000) / 10000;

/** Server clock as sent on the wire: ms, mod 2^32 (same epoch in every thread). */
export const wireTime = (ms: number) => ms % 0x100000000;

export function encodeSnap(upd: EntUpd[], gone: number[], time: number): Uint8Array {
  const buf = new ArrayBuffer(HEADER + upd.length * UPD_BYTES + gone.length * 4);
  const v = new DataView(buf);
  v.setUint8(0, SNAP_UPD);
  v.setUint16(1, upd.length, true);
  v.setUint16(3, gone.length, true);
  v.setUint32(5, wireTime(time), true);
  let o = HEADER;
  for (const [id, x, z, ry, hp, f] of upd) {
    v.setUint32(o, id, true);
    v.setInt16(o + 4, Math.round(x * 50), true);
    v.setInt16(o + 6, Math.round(z * 50), true);
    v.setInt16(o + 8, Math.round(ry * 10000), true);
    v.setUint8(o + 10, Math.max(0, Math.min(255, hp)));
    v.setUint16(o + 11, f & 0xffff, true);
    o += UPD_BYTES;
  }
  for (const id of gone) {
    v.setUint32(o, id, true);
    o += 4;
  }
  return new Uint8Array(buf);
}

export function decodeSnap(buf: ArrayBuffer): { upd: EntUpd[]; gone: number[]; st: number } | null {
  const v = new DataView(buf);
  if (v.byteLength < HEADER || v.getUint8(0) !== SNAP_UPD) return null;
  const n = v.getUint16(1, true), m = v.getUint16(3, true);
  const st = v.getUint32(5, true);
  const upd: EntUpd[] = [];
  const gone: number[] = [];
  let o = HEADER;
  for (let i = 0; i < n; i++, o += UPD_BYTES)
    upd.push([v.getUint32(o, true), v.getInt16(o + 4, true) / 50, v.getInt16(o + 6, true) / 50, v.getInt16(o + 8, true) / 10000, v.getUint8(o + 10), v.getUint16(o + 11, true)]);
  for (let i = 0; i < m; i++, o += 4) gone.push(v.getUint32(o, true));
  return { upd, gone, st };
}

// Combat events, the other hot path (server-rs/src/binary.rs encode_event), decoded back into the JSON
// message they stand for:
//   atk: u8 2, u32 s, u32 tg
//   dmg: u8 3, u32 s, u32 tg, f64 v, u8 flags (1 crit, 2 miss, 4 heal, 8 dot)
//   fx:  u8 4, u32 s, u32 tg, u8 len, skill (utf-8)
export const EV_ATK = 2, EV_DMG = 3, EV_FX = 4;
const utf8 = new TextDecoder();

export function decodeEvent(buf: ArrayBuffer): Extract<S2C, { t: 'atk' | 'dmg' | 'fx' }> | null {
  const v = new DataView(buf);
  if (v.byteLength < 9) return null;
  const k = v.getUint8(0), s = v.getUint32(1, true), tg = v.getUint32(5, true);
  if (k === EV_ATK) return { t: 'atk', s, tg };
  if (k === EV_DMG && v.byteLength >= 18) {
    const f = v.getUint8(17);
    const m: Extract<S2C, { t: 'dmg' }> = { t: 'dmg', s, tg, v: v.getFloat64(9, true) };
    if (f & 1) m.crit = true;
    if (f & 2) m.miss = true;
    if (f & 4) m.heal = true;
    if (f & 8) m.dot = true;
    return m;
  }
  if (k === EV_FX && v.byteLength >= 10) {
    const n = v.getUint8(9);
    if (v.byteLength < 10 + n) return null;
    return { t: 'fx', s, tg, skill: utf8.decode(new Uint8Array(buf, 10, n)) };
  }
  return null;
}
