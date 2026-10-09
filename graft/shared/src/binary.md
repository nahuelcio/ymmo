# shared/src/binary.ts

- qPos · function · L16-L16 — qPos = (v: number)
- qRot · function · L18-L18 — qRot = (v: number)
- wireTime · function · L21-L21 — wireTime = (ms: number)
- encodeSnap · function · L23-L45 — function encodeSnap(upd: EntUpd[], gone: number[], time: number): Uint8Array
- decodeSnap · function · L47-L59 — function decodeSnap(buf: ArrayBuffer): { upd: EntUpd[]; gone: number[]; st: number } | null
- encodeC2S · function · L66-L88 — function encodeC2S(m: C2S): ArrayBuffer | null
- f64s · function · L67-L72 — f64s = (k: number, ...v: number[])
- decodeEvent · function · L98-L118 — function decodeEvent(buf: ArrayBuffer): Extract<S2C, { t: 'atk' | 'dmg' | 'fx' }> | null
