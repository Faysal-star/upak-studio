# DPAK v1 — DeskPet Asset Pack Format

**Status: NORMATIVE.** Three implementations must stay byte-compatible:
`firmware/components/dpak/dpak.c` (C decoder), `tools/dpak-cli/dpak-cli.mjs` (Node encoder), `tools/animator/src/lib/dpak.ts` (TS encoder). Golden fixtures in `tools/dpak-cli/fixtures/` are the arbiter. Any change bumps `version` and regenerates fixtures.

## Conventions

- All multi-byte integers **little-endian**. No implicit struct padding — offsets are exactly as listed.
- Pixels are **RGB565**, stored little-endian (low byte first). The firmware blitter handles any byte-swap the panel needs; files never store swapped data.
- Coordinates: origin top-left, x→right, y→down. Anchors are signed offsets from sprite top-left.
- Strings do not appear in the file; assets are addressed by `id` or by `nameHash` = **FNV-1a 32-bit** of the UTF-8 asset name (offset basis `0x811C9DC5`, prime `0x01000193`).

## File layout

```
[Header 32B] [TOC: tocCount × 32B] [blob region ...]
```

### Header (32 bytes)

| Off | Size | Field | Notes |
|---|---|---|---|
| 0 | 4 | magic | ASCII `DPAK` (0x44 0x50 0x41 0x4B) |
| 4 | 2 | version | `1` |
| 6 | 2 | flags | reserved, 0 |
| 8 | 2 | tocCount | number of TOC entries |
| 10 | 2 | reserved0 | 0 |
| 12 | 4 | tocOffset | byte offset of first TOC entry (= 32) |
| 16 | 4 | crc32 | CRC-32 (IEEE, poly 0xEDB88320) of everything AFTER the header (offset 32 → EOF) |
| 20 | 8 | packId | random u64 chosen at export; identifies the pack |
| 28 | 4 | reserved1 | 0 |

### TOC entry (32 bytes each)

| Off | Size | Field | Notes |
|---|---|---|---|
| 0 | 4 | assetId | unique within pack, assigned by encoder (1-based) |
| 4 | 1 | type | 1=SPRITE 2=ANIM 3=EXPR 4=FONT 5=SOUND 6=PALETTE |
| 5 | 1 | reserved | 0 |
| 6 | 2 | reserved2 | 0 |
| 8 | 4 | nameHash | FNV-1a of asset name |
| 12 | 4 | offset | absolute byte offset of the blob |
| 16 | 4 | length | blob length in bytes |
| 20 | 12 | reserved3 | 0 |

## Blob formats

### SPRITE (type 1)

Header (16 bytes), then payload.

| Off | Size | Field | Notes |
|---|---|---|---|
| 0 | 2 | width | px |
| 2 | 2 | height | px |
| 4 | 1 | format | 0=RGB565, 1=RGB565_A1, 2=RGB565_A8, 3=PAL8, 4=PAL4 |
| 5 | 1 | compression | 0=NONE, 1=LZ4_BLOCK, 2=RLE (RLE valid only for the A1 mask plane; see below) |
| 6 | 2 | paletteRef | assetId of a PALETTE blob (0 = none; required for PAL8/PAL4) |
| 8 | 2 | anchorX | signed |
| 10 | 2 | anchorY | signed |
| 12 | 4 | rawSize | size of the DECOMPRESSED payload in bytes (equals payload length when compression=NONE) |

Payload = the pixel planes, concatenated **then** compressed as one unit when `compression != NONE`:

- **RGB565**: `w*h*2` bytes, row-major.
- **RGB565_A1**: `w*h*2` bytes color plane, then A1 mask plane: each row padded to a whole byte (`ceil(w/8)` bytes/row), MSB = leftmost pixel, bit 1 = opaque.
- **RGB565_A8**: `w*h*2` color plane, then `w*h` alpha bytes (255 = opaque).
- **PAL8**: `w*h` bytes of palette indices.
- **PAL4**: `ceil(w/2)` bytes per row; high nibble = leftmost pixel of the pair.

Compression:
- `LZ4_BLOCK`: a single raw LZ4 block (no frame header, no size prefix — `rawSize` in the sprite header is the decompressed size). Must decode with standard LZ4 block decoders (`LZ4_decompress_safe`, `lz4js.decompressBlock`).
- `RLE`: only meaningful when the whole payload is an A1-style bitplane (reserved for future mask-only assets). v1 encoders SHOULD just use LZ4 for RGB565_A1 payloads (LZ4 compresses the mask plane fine). Decoders MAY reject RLE with `DPAK_ERR_UNSUPPORTED`.

Transparency for PAL8/PAL4: **palette index 0 is always transparent** in v1; encoders reserve slot 0 (a per-sprite opacity flag would be a v2 change). RGB565_A8 raw size for header validation = `w*h*2 + w*h`.

### ANIM (type 2)

| Off | Size | Field |
|---|---|---|
| 0 | 2 | frameCount |
| 2 | 1 | loopMode: 0=ONCE 1=LOOP 2=PINGPONG |
| 3 | 1 | reserved |
| 4 | 2 | defaultFpsX10 (e.g., 125 = 12.5 fps). Nonzero: overrides per-frame durations. 0: per-frame `durationMs` is authoritative |
| 6 | 2 | reserved2 |

Then `frameCount` × 12-byte frame records:

| Off | Size | Field |
|---|---|---|
| 0 | 4 | spriteId (assetId of a SPRITE in this pack) |
| 4 | 2 | durationMs |
| 6 | 2 | dx (signed, offset added to draw position) |
| 8 | 2 | dy (signed) |
| 10 | 2 | reserved |

### EXPR (type 3) — parametric face expression track

| Off | Size | Field |
|---|---|---|
| 0 | 1 | trackCount |
| 1 | 3 | reserved |

Then per track: `{ paramId u8, keyCount u8, reserved u16 }` followed by `keyCount` × 6-byte keys `{ tMs u16, value i16, easing u8, reserved u8 }`.

`paramId` registry (extend append-only): 0=eyeLX 1=eyeLY 2=eyeRX 3=eyeRY 4=eyeW 5=eyeH 6=eyeRadius 7=lidTopL 8=lidTopR 9=lidBotL 10=lidBotR 11=browL 12=browR 13=mouthOpen 14=mouthCurve 15=squash. Values are in 1/256 device-pixel fixed point where dimensional, or 0–256 normalized where fractional (lids: 0=open 256=closed). `easing`: 0=linear 1=easeInQuad 2=easeOutQuad 3=easeInOutQuad 4=easeOutBack.

### PALETTE (type 6)

`{ count u16, reserved u16 }` then `count` × u16 RGB565 entries (little-endian). Max 256.

### FONT (type 4) / SOUND (type 5)

Reserved for M3+ (glyph atlas sprite + metrics; ADPCM/WAV clips). Not emitted by v1 encoders; decoders skip unknown-typed TOC entries silently.

## Decoder contract (`dpak.c`)

- `dpak_open(const uint8_t* data, size_t len, dpak_t* out)` — validates magic/version/CRC (CRC check skippable via flag for large memory-mapped packs), builds TOC view. Zero-copy: blobs are pointers into `data`.
- `dpak_find(dpak_t*, uint32_t nameHash)` / `dpak_get(dpak_t*, uint32_t assetId)` → TOC entry.
- `dpak_sprite_decode(dpak_t*, entry, uint8_t* dst, size_t dstCap)` — decompresses payload into caller buffer (PSRAM sprite cache). Returns rawSize or negative `DPAK_ERR_*`.
- Errors: `DPAK_ERR_MAGIC, _VERSION, _CRC, _BOUNDS, _NOTFOUND, _UNSUPPORTED, _OVERFLOW`. Every offset/length is bounds-checked against pack length before use (packs arrive over serial/WiFi — treat as untrusted input).

## Size expectations (why this format)

| Asset | Raw | DPAK typical |
|---|---|---|
| 240×240 full frame RGB565 | 112.5 KB | 15–40 KB (LZ4, cartoon art) |
| 240×240 user drawing PAL8 | 57.6 KB | 5–15 KB |
| 64×64 sticker RGB565_A1 | 8.7 KB | 2–4 KB |
| Expression (EXPR) | — | 50–300 B |

A 3.5 MB assets partition (Mid tier) holds hundreds of stickers + all expressions + several game sprite sets.
