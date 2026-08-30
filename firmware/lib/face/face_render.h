// DeskPet face renderer — pure software RGB565 rasterizer, C99, no deps.
// Draws crisp cartoon shapes (no AA): rounded-rect eyes with lids, tilted brow
// bars, parabolic mouth. All geometry derives from face_params_t; everything
// is clamped, so partial/garbage params degrade gracefully instead of writing
// out of bounds.
#ifndef FACE_RENDER_H
#define FACE_RENDER_H

#include <stdint.h>

#include "face_params.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  uint16_t bg;    // background fill
  uint16_t eye;   // eye + brow fill
  uint16_t mouth; // mouth stroke/fill
} face_style_t;

// Defaults: dark blue-grey bg, DeskPet-cyan eyes, warm orange mouth.
void face_style_default(face_style_t *style);

// Render the pose into buf (native-u16 RGB565, buf[y*stridePx+x], w x h
// visible area). style may be NULL for defaults. Fills the whole w x h region
// with bg first. No allocation.
void face_render(const face_params_t *p, uint16_t *buf, int w, int h, int stridePx,
                 const face_style_t *style);

// Bounding box of everything face_render would draw (excluding the bg fill),
// clamped to [0,0,w,h]. Conservative: contains every non-bg pixel, with a
// small margin. For dirty-rect pushes.
void face_bounds(const face_params_t *p, int w, int h, int *x, int *y, int *bw, int *bh);

#ifdef __cplusplus
}
#endif
#endif // FACE_RENDER_H
