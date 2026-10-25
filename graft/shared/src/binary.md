# shared/src/binary.ts

- qPos · function · L22-L22 — qPos = (v: number)
- qRot · function · L24-L24 — qRot = (v: number)
- wireTime · function · L27-L27 — wireTime = (ms: number)
- encodeSnap · function · L29-L51 — function encodeSnap(upd: EntUpd[], gone: number[], time: number): Uint8Array
- decodeSnap · function · L53-L65 — function decodeSnap(buf: ArrayBuffer): { upd: EntUpd[]; gone: number[]; st: number } | null
- encodeC2S · function · L73-L105 — function encodeC2S(m: C2S): ArrayBuffer | null
- f64s · function · L74-L79 — f64s = (k: number, ...v: number[])
- decodeEvent · function · L115-L136 — function decodeEvent(buf: ArrayBuffer): Extract<S2C, { t: 'atk' | 'dmg' | 'fx' }> | null
