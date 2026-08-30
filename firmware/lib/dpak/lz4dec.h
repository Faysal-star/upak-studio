// Minimal safe raw-LZ4-block decompressor (no frame header, no size prefix).
// Public domain. Compatible with LZ4_decompress_safe output format.
#ifndef LZ4DEC_H
#define LZ4DEC_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Returns decompressed size (<= dstCap), or -1 on malformed/overflowing input.
int32_t lz4_decompress_block(const uint8_t *src, size_t srcLen, uint8_t *dst, size_t dstCap);

#ifdef __cplusplus
}
#endif
#endif // LZ4DEC_H
