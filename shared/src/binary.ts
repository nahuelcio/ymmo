// Compact binary frame for the hot path of the protocol: per-entity snapshot
// updates (sent 10×/s for everything in view) and despawns. Everything else is JSON.
//
// Layout (little endian):
//   u8  type (= SNAP_UPD)
//   u16 update count, u16 gone count
//   update × n: u32 id, i16 x·50, i16 z·50, i16 ry·10000, u8 hp%, u8 flags   (12 bytes)
//   gone   × m: u32 id
import type { EntUpd } from './protocol';

export const SNAP_UPD = 1;
const UPD_BYTES = 12;

/** Quantize a position the way the wire does (1/50 unit), so diffs match what clients see. */
export const qPos = (v: number) => Math.round(v * 50) / 50;
/** Quantize a heading (radians, −π..π) to the wire's 1/10000 rad. */
export const qRot = (v: number) => Math.round(Math.atan2(Math.sin(v), Math.cos(v)) * 10000) / 10000;

export function encodeSnap(upd: EntUpd[], gone: number[]): Uint8Array {
  const buf = new ArrayBuffer(5 + upd.length * UPD_BYTES + gone.length * 4);
  const v = new DataView(buf);
  v.setUint8(0, SNAP_UPD);
  v.setUint16(1, upd.length, true);
  v.setUint16(3, gone.length, true);
  let o = 5;
  for (const [id, x, z, ry, hp, f] of upd) {
    v.setUint32(o, id, true);
    v.setInt16(o + 4, Math.round(x * 50), true);
    v.setInt16(o + 6, Math.round(z * 50), true);
    v.setInt16(o + 8, Math.round(ry * 10000), true);
    v.setUint8(o + 10, Math.max(0, Math.min(255, hp)));
    v.setUint8(o + 11, f & 0xff);
    o += UPD_BYTES;
  }
  for (const id of gone) {
    v.setUint32(o, id, true);
    o += 4;
  }
  return new Uint8Array(buf);
}

export function decodeSnap(buf: ArrayBuffer): { upd: EntUpd[]; gone: number[] } | null {
  const v = new DataView(buf);
  if (v.byteLength < 5 || v.getUint8(0) !== SNAP_UPD) return null;
  const n = v.getUint16(1, true), m = v.getUint16(3, true);
  const upd: EntUpd[] = [];
  const gone: number[] = [];
  let o = 5;
  for (let i = 0; i < n; i++, o += UPD_BYTES)
    upd.push([v.getUint32(o, true), v.getInt16(o + 4, true) / 50, v.getInt16(o + 6, true) / 50, v.getInt16(o + 8, true) / 10000, v.getUint8(o + 10), v.getUint8(o + 11)]);
  for (let i = 0; i < m; i++, o += 4) gone.push(v.getUint32(o, true));
  return { upd, gone };
}
