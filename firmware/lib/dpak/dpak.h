// DPAK v1 decoder — docs/architecture/asset-format-dpak.md is normative.
// Pure C99, zero dependencies except the bundled lz4dec. Zero-copy: entries
// point into the caller's pack buffer, which must outlive the dpak_t.
// All input is treated as untrusted; every offset/length is bounds-checked.
#ifndef DPAK_H
#define DPAK_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define DPAK_OK 0
#define DPAK_ERR_MAGIC (-1)
#define DPAK_ERR_VERSION (-2)
#define DPAK_ERR_CRC (-3)
#define DPAK_ERR_BOUNDS (-4)
#define DPAK_ERR_NOTFOUND (-5)
#define DPAK_ERR_UNSUPPORTED (-6)
#define DPAK_ERR_OVERFLOW (-7)

#define DPAK_OPEN_SKIP_CRC 0x1u

#define DPAK_TYPE_SPRITE 1
#define DPAK_TYPE_ANIM 2
#define DPAK_TYPE_EXPR 3
#define DPAK_TYPE_FONT 4
#define DPAK_TYPE_SOUND 5
#define DPAK_TYPE_PALETTE 6

#define DPAK_FMT_RGB565 0
#define DPAK_FMT_RGB565_A1 1
#define DPAK_FMT_RGB565_A8 2
#define DPAK_FMT_PAL8 3
#define DPAK_FMT_PAL4 4

#define DPAK_COMP_NONE 0
#define DPAK_COMP_LZ4 1
#define DPAK_COMP_RLE 2

typedef struct {
  const uint8_t *data; // whole pack (not owned)
  size_t len;
  uint16_t tocCount;
  uint32_t tocOffset;
  uint64_t packId;
} dpak_t;

typedef struct {
  uint32_t assetId;
  uint8_t type;
  uint32_t nameHash;
  uint32_t offset; // absolute byte offset of the blob
  uint32_t length; // blob length
  const uint8_t *blob; // = pack->data + offset
} dpak_entry_t;

typedef struct {
  uint16_t width, height;
  uint8_t format, compression;
  uint16_t paletteRef;
  int16_t anchorX, anchorY;
  uint32_t rawSize; // decompressed payload size
  const uint8_t *payload; // compressed (or raw) payload in the pack
  uint32_t payloadLen;
} dpak_sprite_t;

// Validate magic/version/CRC and TOC bounds. flags: DPAK_OPEN_SKIP_CRC.
int dpak_open(const uint8_t *data, size_t len, uint32_t flags, dpak_t *out);

// Linear TOC lookup. Return DPAK_OK or DPAK_ERR_NOTFOUND.
int dpak_find(const dpak_t *pak, uint32_t nameHash, dpak_entry_t *out);
int dpak_get(const dpak_t *pak, uint32_t assetId, dpak_entry_t *out);

// Parse + validate a SPRITE blob header (incl. rawSize vs format consistency).
int dpak_sprite_header(const dpak_t *pak, const dpak_entry_t *e, dpak_sprite_t *out);

// Decompress the sprite payload (concatenated pixel planes) into dst.
// Supports NONE and LZ4_BLOCK for formats RGB565/RGB565_A1/PAL8/PAL4;
// RLE and RGB565_A8 return DPAK_ERR_UNSUPPORTED (v1 firmware).
// Returns rawSize (>=0) or a negative DPAK_ERR_*.
int32_t dpak_sprite_decode(const dpak_t *pak, const dpak_entry_t *e, uint8_t *dst, size_t dstCap);

// PALETTE accessor: *entries points at `count` little-endian RGB565 u16 values.
int dpak_palette_get(const dpak_t *pak, uint32_t assetId, const uint8_t **entries, uint16_t *count);

// Expand a decoded payload into an RGB565 buffer (native u16, dst[y*dstStridePx+x]).
// Transparency model (documented, simple): transparent pixels are SKIPPED —
// dst keeps whatever was there, so the caller pre-fills dst with the background
// (its own "transparent color key"). What counts as transparent:
//   RGB565      — nothing (fully opaque copy)
//   RGB565_A1   — mask bit 0
//   PAL8/PAL4   — palette index 0 (spec: slot 0 always transparent)
// palette: LE u16 entries from dpak_palette_get (may be NULL for RGB565/_A1).
// Returns DPAK_OK or DPAK_ERR_UNSUPPORTED / DPAK_ERR_BOUNDS (bad palette index).
int dpak_blit_to_rgb565(const dpak_sprite_t *spr, const uint8_t *payload,
                        const uint8_t *palette, uint16_t paletteCount,
                        uint16_t *dst, int dstStridePx);

// FNV-1a 32-bit (offset 0x811C9DC5, prime 0x01000193) — asset name hashing.
uint32_t dpak_fnv1a(const void *data, size_t len);
uint32_t dpak_fnv1a_str(const char *s);

// CRC-32 IEEE (poly 0xEDB88320), exposed for upload/verify paths.
uint32_t dpak_crc32(const void *data, size_t len);

#ifdef __cplusplus
}
#endif
#endif // DPAK_H
