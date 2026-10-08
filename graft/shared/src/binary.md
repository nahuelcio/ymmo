# shared/src/binary.ts

- qPos · function · L16-L16 — qPos = (v: number)
- qRot · function · L18-L18 — qRot = (v: number)
- wireTime · function · L21-L21 — wireTime = (ms: number)
- encodeSnap · function · L23-L45 — function encodeSnap(upd: EntUpd[], gone: number[], time: number): Uint8Array
- decodeSnap · function · L47-L59 — function decodeSnap(buf: ArrayBuffer): { upd: EntUpd[]; gone: number[]; st: number } | null
