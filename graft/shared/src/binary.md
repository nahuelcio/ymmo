# shared/src/binary.ts

Defines the compact little-endian binary frame (header + 13-byte per-entity updates + despawn id list) used for the 10 Hz snapshot/despawn hot path, with matching quantization helpers shared by server encode and client decode.

- qPos · function · L16-L16 — Quantizes positions onto the wire's 1/50-unit grid so server-side diffing sees exactly what clients will render.
- qRot · function · L18-L18 — Quantizes headings to the wire's 1/10000-rad precision after normalizing the angle into −π..π so wrap-around can't corrupt the value.
- wireTime · function · L21-L21 — Wraps the server clock into the wire's u32 millisecond format (mod 2^32) so every thread reads the same epoch-free time value.
- encodeSnap · function · L23-L45 — Serializes entity updates and despawned ids into a fixed-layout little-endian snapshot frame for the high-frequency broadcast path.
- decodeSnap · function · L47-L59 — Validates a snapshot frame's magic/type and unpacks it back into entity updates (de-quantized), despawned ids, and server time, returning null for malformed buffers.
- encodeC2S · function · L66-L88 — function encodeC2S(m: C2S): ArrayBuffer | null
- f64s · function · L67-L72 — f64s = (k: number, ...v: number[])
- decodeEvent · function · L98-L118 — function decodeEvent(buf: ArrayBuffer): Extract<S2C, { t: 'atk' | 'dmg' | 'fx' }> | null
