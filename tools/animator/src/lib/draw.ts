// Raster drawing ops on RGBA buffers. All ops REPLACE pixels (no blending) so
// the edit path is identical to the exported data. Pure TS, no React.

export type RGBA = [number, number, number, number];

export function hexToRgba(hex: string): RGBA {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    255,
  ];
}

export function rgbaToHex(r: number, g: number, b: number): string {
  const p = (v: number) => v.toString(16).padStart(2, "0");
  return `#${p(r)}${p(g)}${p(b)}`;
}

export function stamp(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  size: number,
  c: RGBA
): void {
  const off = Math.floor(size / 2);
  const x0 = x - off;
  const y0 = y - off;
  for (let yy = y0; yy < y0 + size; yy++) {
    if (yy < 0 || yy >= h) continue;
    for (let xx = x0; xx < x0 + size; xx++) {
      if (xx < 0 || xx >= w) continue;
      const o = (yy * w + xx) * 4;
      buf[o] = c[0];
      buf[o + 1] = c[1];
      buf[o + 2] = c[2];
      buf[o + 3] = c[3];
    }
  }
}

export function line(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  c: RGBA
): void {
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    stamp(buf, w, h, x, y, size, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

export function rectOutline(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  c: RGBA
): void {
  line(buf, w, h, x0, y0, x1, y0, size, c);
  line(buf, w, h, x1, y0, x1, y1, size, c);
  line(buf, w, h, x1, y1, x0, y1, size, c);
  line(buf, w, h, x0, y1, x0, y0, size, c);
}

export function ellipseOutline(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  c: RGBA
): void {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2;
  const ry = Math.abs(y1 - y0) / 2;
  const steps = Math.max(32, Math.ceil((rx + ry) * 4));
  let px = -1;
  let py = -1;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = Math.round(cx + rx * Math.cos(t));
    const y = Math.round(cy + ry * Math.sin(t));
    if (x !== px || y !== py) {
      stamp(buf, w, h, x, y, size, c);
      px = x;
      py = y;
    }
  }
}

export function rectFilled(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: RGBA
): void {
  const ax = Math.max(0, Math.min(x0, x1));
  const ay = Math.max(0, Math.min(y0, y1));
  const bx = Math.min(w - 1, Math.max(x0, x1));
  const by = Math.min(h - 1, Math.max(y0, y1));
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      const o = (y * w + x) * 4;
      buf[o] = c[0];
      buf[o + 1] = c[1];
      buf[o + 2] = c[2];
      buf[o + 3] = c[3];
    }
  }
}

export function ellipseFilled(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: RGBA
): void {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2 + 0.5;
  const ry = Math.abs(y1 - y0) / 2 + 0.5;
  if (rx <= 0 || ry <= 0) return;
  const ay = Math.max(0, Math.floor(cy - ry));
  const by = Math.min(h - 1, Math.ceil(cy + ry));
  for (let y = ay; y <= by; y++) {
    const dy = (y - cy) / ry;
    const span = 1 - dy * dy;
    if (span < 0) continue;
    const half = rx * Math.sqrt(span);
    const ax = Math.max(0, Math.round(cx - half));
    const bx = Math.min(w - 1, Math.round(cx + half));
    for (let x = ax; x <= bx; x++) {
      const o = (y * w + x) * 4;
      buf[o] = c[0];
      buf[o + 1] = c[1];
      buf[o + 2] = c[2];
      buf[o + 3] = c[3];
    }
  }
}

// Shift-constrain a line endpoint to the nearest 45-degree step from (x0,y0).
export function constrainLine45(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): [number, number] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx > 2 * ady) return [x1, y0]; // horizontal
  if (ady > 2 * adx) return [x0, y1]; // vertical
  const d = Math.max(adx, ady);
  return [x0 + Math.sign(dx) * d, y0 + Math.sign(dy) * d]; // diagonal
}

// Shift-constrain a rect/ellipse corner so the shape is square/circular.
export function constrainSquare(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): [number, number] {
  const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  return [x0 + Math.sign(x1 - x0 || 1) * d, y0 + Math.sign(y1 - y0 || 1) * d];
}

export function floodFill(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  c: RGBA
): void {
  if (x < 0 || x >= w || y < 0 || y >= h) return;
  const view = new Uint32Array(buf.buffer, buf.byteOffset, w * h);
  const target = view[y * w + x];
  const repl =
    (c[0] | (c[1] << 8) | (c[2] << 16) | (c[3] << 24)) >>> 0;
  if (target === repl) return;
  const stack = [y * w + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (view[i] !== target) continue;
    view[i] = repl;
    const ix = i % w;
    if (ix > 0) stack.push(i - 1);
    if (ix < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * (h - 1)) stack.push(i + w);
  }
}

export function pickColor(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number
): RGBA | null {
  if (x < 0 || x >= w || y < 0 || y >= h) return null;
  const o = (y * w + x) * 4;
  return [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]];
}
