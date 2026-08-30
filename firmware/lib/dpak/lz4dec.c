#include "lz4dec.h"
#include <string.h>

int32_t lz4_decompress_block(const uint8_t *src, size_t srcLen, uint8_t *dst, size_t dstCap) {
  const uint8_t *s = src;
  const uint8_t *sEnd = src + srcLen;
  uint8_t *d = dst;
  uint8_t *dEnd = dst + dstCap;

  if (srcLen == 0) return 0;

  for (;;) {
    if (s >= sEnd) return -1;
    uint8_t token = *s++;

    // literals
    size_t litLen = token >> 4;
    if (litLen == 15) {
      uint8_t b;
      do {
        if (s >= sEnd) return -1;
        b = *s++;
        litLen += b;
      } while (b == 255);
    }
    if (litLen > (size_t)(sEnd - s) || litLen > (size_t)(dEnd - d)) return -1;
    memcpy(d, s, litLen);
    s += litLen;
    d += litLen;

    if (s == sEnd) break; // block ends after the last literal run

    // match
    if ((size_t)(sEnd - s) < 2) return -1;
    uint16_t offset = (uint16_t)(s[0] | (s[1] << 8));
    s += 2;
    if (offset == 0 || (size_t)offset > (size_t)(d - dst)) return -1;

    size_t mLen = token & 15;
    if (mLen == 15) {
      uint8_t b;
      do {
        if (s >= sEnd) return -1;
        b = *s++;
        mLen += b;
      } while (b == 255);
    }
    mLen += 4;
    if (mLen > (size_t)(dEnd - d)) return -1;

    // Match copy. LZ4 semantics: d[i] = d[i - offset], evaluated sequentially,
    // i.e. the last `offset` bytes repeat with period `offset`. The naive byte
    // loop made compressible input the SLOWEST case on ESP32-S3 (measured
    // 2026-09-01: dense short matches -> ~13 cyc/byte). Three cases instead:
    const uint8_t *m = d - offset;
    if ((size_t)offset >= mLen) {
      // No overlap at all — plain memcpy.
      memcpy(d, m, mLen);
    } else if (offset >= 8) {
      // Overlapping but with >=8B distance: 8-byte stepped copies never read
      // bytes written by the same chunk. Exact-bounded (no wildcopy overrun).
      size_t i = 0;
      for (; i + 8 <= mLen; i += 8) memcpy(d + i, m + i, 8);
      for (; i < mLen; i++) d[i] = m[i];
    } else {
      // Short period (1..7): write one period, then double the copied span.
      // Every chunk source lies fully before its destination, and spans stay
      // period-aligned until the final partial chunk, so content is exact.
      memcpy(d, m, offset);
      size_t w = offset;
      while (w < mLen) {
        size_t n = w;
        if (n > mLen - w) n = mLen - w;
        memcpy(d + w, d, n);
        w += n;
      }
    }
    d += mLen;
  }
  return (int32_t)(d - dst);
}
