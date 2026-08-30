#include "dpak.h"
#include "lz4dec.h"
#include <string.h>

// --- little-endian readers (packs may be unaligned in memory)
static uint16_t rd16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }
static uint32_t rd32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static uint64_t rd64(const uint8_t *p) { return (uint64_t)rd32(p) | ((uint64_t)rd32(p + 4) << 32); }

uint32_t dpak_fnv1a(const void *data, size_t len) {
  const uint8_t *p = (const uint8_t *)data;
  uint32_t h = 0x811c9dc5u;
  for (size_t i = 0; i < len; i++) {
    h ^= p[i];
    h *= 0x01000193u;
  }
  return h;
}

uint32_t dpak_fnv1a_str(const char *s) { return dpak_fnv1a(s, strlen(s)); }

uint32_t dpak_crc32(const void *data, size_t len) {
  // nibble-table CRC-32 IEEE: small, fast enough for pack validation
  static const uint32_t t[16] = {
      0x00000000, 0x1db71064, 0x3b6e20c8, 0x26d930ac, 0x76dc4190, 0x6b6b51f4, 0x4db26158, 0x5005713c,
      0xedb88320, 0xf00f9344, 0xd6d6a3e8, 0xcb61b38c, 0x9b64c2b0, 0x86d3d2d4, 0xa00ae278, 0xbdbdf21c};
  const uint8_t *p = (const uint8_t *)data;
  uint32_t c = 0xffffffffu;
  for (size_t i = 0; i < len; i++) {
    c ^= p[i];
    c = t[c & 15] ^ (c >> 4);
    c = t[c & 15] ^ (c >> 4);
  }
  return c ^ 0xffffffffu;
}

int dpak_open(const uint8_t *data, size_t len, uint32_t flags, dpak_t *out) {
  if (!data || !out || len < 32) return DPAK_ERR_BOUNDS;
  if (memcmp(data, "DPAK", 4) != 0) return DPAK_ERR_MAGIC;
  if (rd16(data + 4) != 1) return DPAK_ERR_VERSION;
  uint16_t tocCount = rd16(data + 8);
  uint32_t tocOffset = rd32(data + 12);
  uint32_t crc = rd32(data + 16);
  if ((uint64_t)tocOffset + (uint64_t)tocCount * 32u > (uint64_t)len) return DPAK_ERR_BOUNDS;
  if (!(flags & DPAK_OPEN_SKIP_CRC)) {
    if (dpak_crc32(data + 32, len - 32) != crc) return DPAK_ERR_CRC;
  }
  out->data = data;
  out->len = len;
  out->tocCount = tocCount;
  out->tocOffset = tocOffset;
  out->packId = rd64(data + 20);
  return DPAK_OK;
}

static int entry_at(const dpak_t *pak, uint16_t i, dpak_entry_t *out) {
  const uint8_t *p = pak->data + pak->tocOffset + (size_t)i * 32u;
  out->assetId = rd32(p);
  out->type = p[4];
  out->nameHash = rd32(p + 8);
  out->offset = rd32(p + 12);
  out->length = rd32(p + 16);
  if ((uint64_t)out->offset + (uint64_t)out->length > (uint64_t)pak->len) return DPAK_ERR_BOUNDS;
  out->blob = pak->data + out->offset;
  return DPAK_OK;
}

int dpak_find(const dpak_t *pak, uint32_t nameHash, dpak_entry_t *out) {
  for (uint16_t i = 0; i < pak->tocCount; i++) {
    int rc = entry_at(pak, i, out);
    if (rc != DPAK_OK) return rc;
    if (out->nameHash == nameHash) return DPAK_OK;
  }
  return DPAK_ERR_NOTFOUND;
}

int dpak_get(const dpak_t *pak, uint32_t assetId, dpak_entry_t *out) {
  for (uint16_t i = 0; i < pak->tocCount; i++) {
    int rc = entry_at(pak, i, out);
    if (rc != DPAK_OK) return rc;
    if (out->assetId == assetId) return DPAK_OK;
  }
  return DPAK_ERR_NOTFOUND;
}

// expected decompressed payload size for a format, 0 if unknown format
static uint32_t expected_raw(uint16_t w, uint16_t h, uint8_t fmt) {
  uint32_t px = (uint32_t)w * h;
  switch (fmt) {
    case DPAK_FMT_RGB565: return px * 2u;
    case DPAK_FMT_RGB565_A1: return px * 2u + (uint32_t)((w + 7u) / 8u) * h;
    case DPAK_FMT_RGB565_A8: return px * 3u;
    case DPAK_FMT_PAL8: return px;
    case DPAK_FMT_PAL4: return (uint32_t)((w + 1u) / 2u) * h;
    default: return 0;
  }
}

int dpak_sprite_header(const dpak_t *pak, const dpak_entry_t *e, dpak_sprite_t *out) {
  (void)pak;
  if (e->type != DPAK_TYPE_SPRITE) return DPAK_ERR_UNSUPPORTED;
  if (e->length < 16) return DPAK_ERR_BOUNDS;
  const uint8_t *b = e->blob;
  out->width = rd16(b);
  out->height = rd16(b + 2);
  out->format = b[4];
  out->compression = b[5];
  out->paletteRef = rd16(b + 6);
  out->anchorX = (int16_t)rd16(b + 8);
  out->anchorY = (int16_t)rd16(b + 10);
  out->rawSize = rd32(b + 12);
  out->payload = b + 16;
  out->payloadLen = e->length - 16;
  if (out->format > DPAK_FMT_PAL4) return DPAK_ERR_UNSUPPORTED;
  uint32_t want = expected_raw(out->width, out->height, out->format);
  if (want == 0 || out->rawSize != want) return DPAK_ERR_BOUNDS;
  if (out->compression == DPAK_COMP_NONE && out->payloadLen != out->rawSize) return DPAK_ERR_BOUNDS;
  return DPAK_OK;
}

int32_t dpak_sprite_decode(const dpak_t *pak, const dpak_entry_t *e, uint8_t *dst, size_t dstCap) {
  dpak_sprite_t s;
  int rc = dpak_sprite_header(pak, e, &s);
  if (rc != DPAK_OK) return rc;
  if (s.format == DPAK_FMT_RGB565_A8) return DPAK_ERR_UNSUPPORTED; // v1 firmware
  if (dstCap < s.rawSize) return DPAK_ERR_OVERFLOW;
  switch (s.compression) {
    case DPAK_COMP_NONE:
      memcpy(dst, s.payload, s.rawSize);
      return (int32_t)s.rawSize;
    case DPAK_COMP_LZ4: {
      int32_t n = lz4_decompress_block(s.payload, s.payloadLen, dst, dstCap);
      if (n < 0 || (uint32_t)n != s.rawSize) return DPAK_ERR_BOUNDS;
      return n;
    }
    case DPAK_COMP_RLE:
    default:
      return DPAK_ERR_UNSUPPORTED;
  }
}

int dpak_palette_get(const dpak_t *pak, uint32_t assetId, const uint8_t **entries, uint16_t *count) {
  dpak_entry_t e;
  int rc = dpak_get(pak, assetId, &e);
  if (rc != DPAK_OK) return rc;
  if (e.type != DPAK_TYPE_PALETTE) return DPAK_ERR_UNSUPPORTED;
  if (e.length < 4) return DPAK_ERR_BOUNDS;
  uint16_t n = rd16(e.blob);
  if (n > 256 || 4u + (uint32_t)n * 2u > e.length) return DPAK_ERR_BOUNDS;
  *entries = e.blob + 4;
  *count = n;
  return DPAK_OK;
}

int dpak_blit_to_rgb565(const dpak_sprite_t *spr, const uint8_t *payload,
                        const uint8_t *palette, uint16_t paletteCount,
                        uint16_t *dst, int dstStridePx) {
  const uint16_t w = spr->width, h = spr->height;
  switch (spr->format) {
    case DPAK_FMT_RGB565:
      for (uint16_t y = 0; y < h; y++) {
        const uint8_t *row = payload + (size_t)y * w * 2u;
        uint16_t *drow = dst + (size_t)y * dstStridePx;
        for (uint16_t x = 0; x < w; x++) drow[x] = rd16(row + x * 2u);
      }
      return DPAK_OK;
    case DPAK_FMT_RGB565_A1: {
      const uint32_t maskStride = (w + 7u) / 8u;
      const uint8_t *mask = payload + (size_t)w * h * 2u;
      for (uint16_t y = 0; y < h; y++) {
        const uint8_t *row = payload + (size_t)y * w * 2u;
        const uint8_t *mrow = mask + (size_t)y * maskStride;
        uint16_t *drow = dst + (size_t)y * dstStridePx;
        for (uint16_t x = 0; x < w; x++) {
          if (mrow[x >> 3] & (0x80u >> (x & 7u))) drow[x] = rd16(row + x * 2u);
        }
      }
      return DPAK_OK;
    }
    case DPAK_FMT_PAL8:
      if (!palette) return DPAK_ERR_BOUNDS;
      for (uint16_t y = 0; y < h; y++) {
        const uint8_t *row = payload + (size_t)y * w;
        uint16_t *drow = dst + (size_t)y * dstStridePx;
        for (uint16_t x = 0; x < w; x++) {
          uint8_t idx = row[x];
          if (idx == 0) continue; // index 0 = transparent (spec)
          if (idx >= paletteCount) return DPAK_ERR_BOUNDS;
          drow[x] = rd16(palette + (size_t)idx * 2u);
        }
      }
      return DPAK_OK;
    case DPAK_FMT_PAL4: {
      const uint32_t rowStride = (w + 1u) / 2u;
      if (!palette) return DPAK_ERR_BOUNDS;
      for (uint16_t y = 0; y < h; y++) {
        const uint8_t *row = payload + (size_t)y * rowStride;
        uint16_t *drow = dst + (size_t)y * dstStridePx;
        for (uint16_t x = 0; x < w; x++) {
          uint8_t idx = (x & 1u) ? (row[x >> 1] & 0x0f) : (row[x >> 1] >> 4); // high nibble = left pixel
          if (idx == 0) continue;
          if (idx >= paletteCount) return DPAK_ERR_BOUNDS;
          drow[x] = rd16(palette + (size_t)idx * 2u);
        }
      }
      return DPAK_OK;
    }
    default:
      return DPAK_ERR_UNSUPPORTED;
  }
}
