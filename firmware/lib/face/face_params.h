// DeskPet face parameter registry — matches the DPAK EXPR paramId registry in
// docs/architecture/asset-format-dpak.md (NORMATIVE, extend append-only).
//
// Coordinate model (screen w x h, origin top-left, y down):
//   left  eye center = (screenCx + eyeLX/256, screenCy + eyeLY/256)
//   right eye center = (screenCx + eyeRX/256, screenCy + eyeRY/256)
// Dimensional params (eye positions/sizes, brows) are 1/256 device-pixel fixed
// point. Fractional params (lids, mouthOpen, squash) are 0..256 normalized;
// mouthCurve is -256..256.
#ifndef FACE_PARAMS_H
#define FACE_PARAMS_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
  FP_EYE_LX = 0,   // left eye center x offset from screen center, 1/256 px (signed)
  FP_EYE_LY = 1,   // left eye center y offset, 1/256 px (+ is down)
  FP_EYE_RX = 2,   // right eye center x offset, 1/256 px
  FP_EYE_RY = 3,   // right eye center y offset, 1/256 px
  FP_EYE_W = 4,    // eye width, 1/256 px (both eyes)
  FP_EYE_H = 5,    // eye height, 1/256 px (before squash)
  FP_EYE_RADIUS = 6, // corner radius, 1/256 px (clamped to half min dimension)
  FP_LID_TOP_L = 7,  // top lid coverage, 0=open .. 256=fully closed
  FP_LID_TOP_R = 8,
  FP_LID_BOT_L = 9,  // bottom lid coverage, 0..256
  FP_LID_BOT_R = 10,
  FP_BROW_L = 11,  // brow tilt, 1/256 px vertical drop of the INNER (nose-side)
  FP_BROW_R = 12,  //   end vs the outer end; + = inner down (angry), - = inner
                   //   up (sad/surprised). 0 = brow not drawn.
  FP_MOUTH_OPEN = 13,  // 0..256; <=100 scales stroke thickness, >100 open-mouth ellipse
  FP_MOUTH_CURVE = 14, // -256 (sad arc) .. 256 (happy arc)
  FP_SQUASH = 15,      // 0..256 vertical squash applied to eye height (0 = none)
  FACE_PARAM_COUNT = 16
};

// One full face pose. v[] is indexed by FP_* above.
typedef struct {
  int16_t v[FACE_PARAM_COUNT];
} face_params_t;

#ifdef __cplusplus
}
#endif
#endif // FACE_PARAMS_H
