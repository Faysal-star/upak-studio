// Raw LZ4 block compressor/decompressor (no frame header, no size prefix).
// Direct TS port of tools/dpak-cli/lz4.mjs (the reference implementation) —
// must round-trip with firmware/lib/dpak/lz4dec.c and standard LZ4 block
// decoders (LZ4_decompress_safe, lz4js.decompressBlock).

const MIN_MATCH = 4;
const MFLIMIT = 12; // no match may start within the last 12 bytes
const LAST_LITERALS = 5; // matches must not cover the last 5 bytes

function hash32(v: number): number {
  return (Math.imul(v, 2654435761) >>> 16) & 0xffff;
}

function readU32(buf: Uint8Array, i: number): number {
  return buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24);
}

// Greedy hash-table matcher, standard block format.
export function compressBlock(src: Uint8Array): Uint8Array {
  const n = src.length;
  const dst = new Uint8Array(n + Math.ceil(n / 255) + 16 + 1);
  let d = 0;
  let anchor = 0;
  let s = 0;
  const table = new Int32Array(65536).fill(-1);
  const mfLimit = n - MFLIMIT;

  const emit = (litLen: number, matchLen: number /* 0 = literals only */, offset: number) => {
    const mToken = matchLen ? Math.min(matchLen - MIN_MATCH, 15) : 0;
    dst[d++] = (Math.min(litLen, 15) << 4) | mToken;
    if (litLen >= 15) {
      let rest = litLen - 15;
      while (rest >= 255) { dst[d++] = 255; rest -= 255; }
      dst[d++] = rest;
    }
    dst.set(src.subarray(anchor, anchor + litLen), d);
    d += litLen;
    if (matchLen) {
      dst[d++] = offset & 0xff;
      dst[d++] = offset >>> 8;
      if (matchLen - MIN_MATCH >= 15) {
        let rest = matchLen - MIN_MATCH - 15;
        while (rest >= 255) { dst[d++] = 255; rest -= 255; }
        dst[d++] = rest;
      }
    }
  };

  while (s < mfLimit) {
    const seq = readU32(src, s);
    const h = hash32(seq);
    const cand = table[h];
    table[h] = s;
    if (cand >= 0 && s - cand <= 0xffff && readU32(src, cand) === seq) {
      let mLen = MIN_MATCH;
      const maxLen = n - LAST_LITERALS - s;
      while (mLen < maxLen && src[cand + mLen] === src[s + mLen]) mLen++;
      emit(s - anchor, mLen, s - cand);
      s += mLen;
      anchor = s;
    } else {
      s++;
    }
  }
  emit(n - anchor, 0, 0); // trailing literals (block always ends with literals)
  return dst.slice(0, d);
}

// Safe decompressor mirroring lz4dec.c. Throws on malformed input.
export function decompressBlock(src: Uint8Array, rawSize: number): Uint8Array {
  const dst = new Uint8Array(rawSize);
  let s = 0;
  let d = 0;
  const sEnd = src.length;
  for (;;) {
    if (s >= sEnd) throw new Error("lz4: truncated token");
    const token = src[s++];
    let litLen = token >> 4;
    if (litLen === 15) {
      let b: number;
      do {
        if (s >= sEnd) throw new Error("lz4: truncated litlen");
        b = src[s++];
        litLen += b;
      } while (b === 255);
    }
    if (litLen > sEnd - s || litLen > rawSize - d) throw new Error("lz4: literal overrun");
    dst.set(src.subarray(s, s + litLen), d);
    s += litLen;
    d += litLen;
    if (s === sEnd) break; // block ends after literals
    if (sEnd - s < 2) throw new Error("lz4: truncated offset");
    const offset = src[s] | (src[s + 1] << 8);
    s += 2;
    if (offset === 0 || offset > d) throw new Error("lz4: bad offset");
    let mLen = token & 15;
    if (mLen === 15) {
      let b: number;
      do {
        if (s >= sEnd) throw new Error("lz4: truncated matchlen");
        b = src[s++];
        mLen += b;
      } while (b === 255);
    }
    mLen += MIN_MATCH;
    if (mLen > rawSize - d) throw new Error("lz4: match overrun");
    for (let i = 0; i < mLen; i++) dst[d + i] = dst[d - offset + i]; // overlap-safe
    d += mLen;
  }
  if (d !== rawSize) throw new Error(`lz4: size mismatch (got ${d}, want ${rawSize})`);
  return dst;
}
