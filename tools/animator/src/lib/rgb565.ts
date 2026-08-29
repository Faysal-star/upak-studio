// RGB565 conversion + quantization. Pure TS, no React.

export function to565(r: number, g: number, b: number): number {
  return (((r >> 3) & 0x1f) << 11) | (((g >> 2) & 0x3f) << 5) | ((b >> 3) & 0x1f);
}

export function from565(v: number): [number, number, number] {
  const r5 = (v >> 11) & 0x1f;
  const g6 = (v >> 5) & 0x3f;
  const b5 = v & 0x1f;
  // bit-replication expansion
  return [(r5 << 3) | (r5 >> 2), (g6 << 2) | (g6 >> 4), (b5 << 3) | (b5 >> 2)];
}

export const ALPHA_THRESHOLD = 128; // alpha >= threshold -> opaque

export interface Quantized {
  color: Uint16Array; // RGB565 per pixel (transparent pixels are 0)
  alpha: Uint8Array; // 0/1 per pixel
  hasTransparency: boolean;
}

// RGBA8888 row-major -> RGB565 (+A1). Optional Floyd-Steinberg dithering.
export function quantize(
  rgba: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  dither = false
): Quantized {
  const n = w * h;
  const color = new Uint16Array(n);
  const alpha = new Uint8Array(n);
  let hasTransparency = false;

  if (!dither) {
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (rgba[o + 3] >= ALPHA_THRESHOLD) {
        alpha[i] = 1;
        color[i] = to565(rgba[o], rgba[o + 1], rgba[o + 2]);
      } else {
        hasTransparency = true;
      }
    }
    return { color, alpha, hasTransparency };
  }

  // Floyd-Steinberg error diffusion (per channel, skipping transparent pixels)
  const buf = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    buf[i * 3] = rgba[i * 4];
    buf[i * 3 + 1] = rgba[i * 4 + 1];
    buf[i * 3 + 2] = rgba[i * 4 + 2];
  }
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (rgba[i * 4 + 3] < ALPHA_THRESHOLD) {
        hasTransparency = true;
        continue;
      }
      alpha[i] = 1;
      const r = clamp(buf[i * 3]);
      const g = clamp(buf[i * 3 + 1]);
      const b = clamp(buf[i * 3 + 2]);
      const q = to565(r, g, b);
      color[i] = q;
      const [qr, qg, qb] = from565(q);
      const er = r - qr;
      const eg = g - qg;
      const eb = b - qb;
      const spread = (xx: number, yy: number, f: number) => {
        if (xx < 0 || xx >= w || yy >= h) return;
        const j = yy * w + xx;
        if (rgba[j * 4 + 3] < ALPHA_THRESHOLD) return;
        buf[j * 3] += er * f;
        buf[j * 3 + 1] += eg * f;
        buf[j * 3 + 2] += eb * f;
      };
      spread(x + 1, y, 7 / 16);
      spread(x - 1, y + 1, 3 / 16);
      spread(x, y + 1, 5 / 16);
      spread(x + 1, y + 1, 1 / 16);
    }
  }
  return { color, alpha, hasTransparency };
}

// Round-trip an RGBA buffer through RGB565 for the device preview.
// Transparent pixels become black (the device screen background).
export function roundTrip565(src: Uint8Array | Uint8ClampedArray, dst: Uint8ClampedArray): void {
  const n = src.length / 4;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (src[o + 3] >= ALPHA_THRESHOLD) {
      const [r, g, b] = from565(to565(src[o], src[o + 1], src[o + 2]));
      dst[o] = r;
      dst[o + 1] = g;
      dst[o + 2] = b;
    } else {
      dst[o] = 0;
      dst[o + 1] = 0;
      dst[o + 2] = 0;
    }
    dst[o + 3] = 255;
  }
}
