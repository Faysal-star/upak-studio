// DeskPet face renderer. See face_render.h. Integer-only scanline fills,
// every span clipped to the target rect — safe on arbitrary param values.
#include "face_render.h"

#include <stddef.h>

void face_style_default(face_style_t *style) {
  style->bg = 0x10A2;    // dark blue-grey
  style->eye = 0x35BD;   // DeskPet cyan
  style->mouth = 0xFBE4; // warm orange
}

static int imin(int a, int b) { return a < b ? a : b; }
static int imax(int a, int b) { return a > b ? a : b; }

static uint32_t isqrt32(uint32_t n) {
  uint32_t r = 0, bit = 1u << 30;
  while (bit > n) bit >>= 2;
  while (bit) {
    if (n >= r + bit) {
      n -= r + bit;
      r = (r >> 1) + bit;
    } else {
      r >>= 1;
    }
    bit >>= 2;
  }
  return r;
}

// horizontal span [x0, x0+len) at row y, clipped to w x h
static void hspan(uint16_t *buf, int stridePx, int w, int h, int x0, int y, int len,
                  uint16_t color) {
  if (y < 0 || y >= h || len <= 0) return;
  int x1 = x0 + len;
  if (x0 < 0) x0 = 0;
  if (x1 > w) x1 = w;
  uint16_t *row = buf + (size_t)y * stridePx;
  for (int x = x0; x < x1; x++) row[x] = color;
}

// filled rounded rect, top-left (x0,y0), size rw x rh, corner radius r
static void fill_rrect(uint16_t *buf, int stridePx, int w, int h, int x0, int y0, int rw,
                       int rh, int r, uint16_t color) {
  if (rw <= 0 || rh <= 0) return;
  r = imax(0, imin(r, imin(rw, rh) / 2));
  for (int row = 0; row < rh; row++) {
    int inset = 0;
    if (row < r) {
      int dy = r - row;
      inset = r - (int)isqrt32((uint32_t)(r * r - dy * dy));
    }
    if (row >= rh - r) {
      int dy = row - (rh - 1 - r);
      if (dy > 0) {
        int ins = r - (int)isqrt32((uint32_t)(r * r - dy * dy));
        inset = imax(inset, ins);
      }
    }
    hspan(buf, stridePx, w, h, x0 + inset, y0 + row, rw - 2 * inset, color);
  }
}

// ---------------------------------------------------------------------------
// Shared geometry (face_render and face_bounds must agree)
// ---------------------------------------------------------------------------
typedef struct {
  int ex, ey;        // eye center px
  int ew, eh, ehFull; // width, squashed height, unsquashed height
  int r;             // corner radius
  int browBaseY, browTilt; // brow anchor + signed inner-end drop (px)
} eye_geom_t;

static void eye_geometry(const face_params_t *p, int w, int h, int side, eye_geom_t *g) {
  int cx = w / 2, cy = h / 2;
  int px = p->v[side ? FP_EYE_RX : FP_EYE_LX];
  int py = p->v[side ? FP_EYE_RY : FP_EYE_LY];
  g->ex = cx + px / 256;
  g->ey = cy + py / 256;
  g->ew = imax(0, p->v[FP_EYE_W] / 256);
  g->ehFull = imax(0, p->v[FP_EYE_H] / 256);
  int squash = imax(0, imin(256, (int)p->v[FP_SQUASH]));
  g->eh = (g->ehFull * (256 - squash)) / 256;
  g->r = imax(0, p->v[FP_EYE_RADIUS] / 256);
  g->browBaseY = g->ey - g->ehFull / 2 - 12;
  g->browTilt = p->v[side ? FP_BROW_R : FP_BROW_L] / 256;
}

typedef struct {
  int cx, cy, hw;       // mouth center + half width
  int curveAmp;         // signed parabola amplitude (px)
  int open;             // 0..256
  int thick;            // stroke thickness (closed mouth)
  int ellW, ellH;       // open-mouth ellipse half extents
} mouth_geom_t;

static void mouth_geometry(const face_params_t *p, int w, int h, mouth_geom_t *m) {
  m->cx = w / 2;
  m->cy = h / 2 + (h * 52) / 240;
  m->hw = imax(1, (w * 34) / 240);
  int curve = imax(-256, imin(256, (int)p->v[FP_MOUTH_CURVE]));
  m->curveAmp = (curve * 12) / 256;
  m->open = imax(0, imin(256, (int)p->v[FP_MOUTH_OPEN]));
  m->thick = 2 + (imin(m->open, 100) * 4) / 100;
  m->ellW = imax(1, (w * 22) / 240);
  m->ellH = 6 + ((imax(m->open, 100) - 100) * 20) / 156;
}

// ---------------------------------------------------------------------------
void face_render(const face_params_t *p, uint16_t *buf, int w, int h, int stridePx,
                 const face_style_t *style) {
  face_style_t def;
  if (!style) {
    face_style_default(&def);
    style = &def;
  }
  if (w <= 0 || h <= 0) return;

  // background
  for (int y = 0; y < h; y++) {
    uint16_t *row = buf + (size_t)y * stridePx;
    for (int x = 0; x < w; x++) row[x] = style->bg;
  }

  for (int side = 0; side < 2; side++) {
    eye_geom_t g;
    eye_geometry(p, w, h, side, &g);

    // eye body, cut by lids (draw a shorter rounded rect)
    int lidTop = imax(0, imin(256, (int)p->v[side ? FP_LID_TOP_R : FP_LID_TOP_L]));
    int lidBot = imax(0, imin(256, (int)p->v[side ? FP_LID_BOT_R : FP_LID_BOT_L]));
    int y0 = g.ey - g.eh / 2 + (g.eh * lidTop) / 256;
    int y1 = g.ey + g.eh - g.eh / 2 - (g.eh * lidBot) / 256;
    if (y1 > y0 && g.ew > 0)
      fill_rrect(buf, stridePx, w, h, g.ex - g.ew / 2, y0, g.ew, y1 - y0, g.r, style->eye);

    // brow: 3px-thick tilted bar above the eye, drawn only when nonzero
    if (g.browTilt != 0 && g.ew > 1) {
      for (int i = 0; i < g.ew; i++) {
        // t: 0 at the OUTER end, ew-1 at the INNER (nose-side) end
        int t = side ? (g.ew - 1 - i) : i;
        int yb = g.browBaseY + (g.browTilt * t) / (g.ew - 1);
        for (int k = 0; k < 3; k++) {
          int yy = yb + k, xx = g.ex - g.ew / 2 + i;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) buf[(size_t)yy * stridePx + xx] = style->eye;
        }
      }
    }
  }

  // mouth
  {
    mouth_geom_t m;
    mouth_geometry(p, w, h, &m);
    if (m.open > 100) {
      // open mouth: filled ellipse
      for (int dy = -m.ellH; dy <= m.ellH; dy++) {
        int dxs = (int)((m.ellW * isqrt32((uint32_t)(m.ellH * m.ellH - dy * dy))) / (uint32_t)m.ellH);
        hspan(buf, stridePx, w, h, m.cx - dxs, m.cy + dy, 2 * dxs + 1, style->mouth);
      }
    } else {
      // curve stroke: per-column parabola y = cy + amp*(0.5 - dx^2/hw^2)
      int hw2 = 2 * m.hw * m.hw;
      for (int dx = -m.hw; dx <= m.hw; dx++) {
        int yoff = (m.curveAmp * (m.hw * m.hw - 2 * dx * dx)) / hw2;
        int yb = m.cy + yoff - m.thick / 2;
        for (int k = 0; k < m.thick; k++) {
          int yy = yb + k, xx = m.cx + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) buf[(size_t)yy * stridePx + xx] = style->mouth;
        }
      }
    }
  }
}

void face_bounds(const face_params_t *p, int w, int h, int *x, int *y, int *bw, int *bh) {
  int minX = w, minY = h, maxX = 0, maxY = 0;
  int any = 0;

  for (int side = 0; side < 2; side++) {
    eye_geom_t g;
    eye_geometry(p, w, h, side, &g);
    if (g.ew > 0 && g.eh > 0) {
      minX = imin(minX, g.ex - g.ew / 2);
      maxX = imax(maxX, g.ex - g.ew / 2 + g.ew);
      minY = imin(minY, g.ey - g.eh / 2);
      maxY = imax(maxY, g.ey - g.eh / 2 + g.eh);
      any = 1;
    }
    if (g.browTilt != 0 && g.ew > 1) {
      minX = imin(minX, g.ex - g.ew / 2);
      maxX = imax(maxX, g.ex - g.ew / 2 + g.ew);
      minY = imin(minY, g.browBaseY + imin(0, g.browTilt));
      maxY = imax(maxY, g.browBaseY + imax(0, g.browTilt) + 3);
      any = 1;
    }
  }

  {
    mouth_geom_t m;
    mouth_geometry(p, w, h, &m);
    int ampAbs = m.curveAmp < 0 ? -m.curveAmp : m.curveAmp;
    minX = imin(minX, m.cx - imax(m.hw, m.ellW) - 1);
    maxX = imax(maxX, m.cx + imax(m.hw, m.ellW) + 1);
    minY = imin(minY, m.cy - imax(m.ellH, ampAbs / 2 + m.thick) - 1);
    maxY = imax(maxY, m.cy + imax(m.ellH, ampAbs / 2 + m.thick) + 1);
    any = 1;
  }

  if (!any) {
    *x = 0; *y = 0; *bw = 0; *bh = 0;
    return;
  }
  // 2px margin, clamped to screen
  minX = imax(0, minX - 2);
  minY = imax(0, minY - 2);
  maxX = imin(w, maxX + 2);
  maxY = imin(h, maxY + 2);
  if (maxX <= minX || maxY <= minY) {
    *x = 0; *y = 0; *bw = 0; *bh = 0;
    return;
  }
  *x = minX;
  *y = minY;
  *bw = maxX - minX;
  *bh = maxY - minY;
}
