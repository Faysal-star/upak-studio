// FNV-1a 32-bit over UTF-8 bytes (DPAK nameHash).

export function fnv1a32Bytes(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function fnv1a32(name: string): number {
  return fnv1a32Bytes(new TextEncoder().encode(name));
}
