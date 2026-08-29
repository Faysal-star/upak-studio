// FNV-1a 32-bit (offset basis 0x811C9DC5, prime 0x01000193) — per DPAK v1 spec.
export function fnv1a(input) {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    // h *= 0x01000193 (mod 2^32) without float loss
    h = (h + ((h << 1) >>> 0) + ((h << 4) >>> 0) + ((h << 7) >>> 0) + ((h << 8) >>> 0) + ((h << 24) >>> 0)) >>> 0;
  }
  return h >>> 0;
}
