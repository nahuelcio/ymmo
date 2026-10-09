# server-rs/src/binary.rs

Rust implementation of the compact snapshot-frame serializer shared with shared/src/binary.ts: quantization helpers plus the encoder that packs per-entity world updates into little-endian bytes for clients.

- q_pos · function · L3-L3 — Snaps a world coordinate onto the 1/50-unit fixed-point grid so position values round-trip exactly through the i16 wire fields.
- q_rot · function · L4-L4 — Wraps an angle into [0, 2π) via atan2(sin, cos) and snaps it to the 1/10000 grid used by the frame's rotation field.
- wire_time · function · L5-L5 — Folds the server's millisecond clock into the u32 range the snapshot frame's time field can hold.
- encode_snap · function · L7-L23 — Serializes one snapshot tick — header with counts and timestamp, then each updated entity's id/x/z/rotation/hp/flags, then gone ids — into the compact binary frame the client decodes.
- decode_c2s · function · L27-L38 — pub fn decode_c2s(b: &[u8]) -> Option<serde_json::Value>
- encode_event · function · L45-L71 — pub fn encode_event(v: &serde_json::Value) -> Option<Vec<u8>>
