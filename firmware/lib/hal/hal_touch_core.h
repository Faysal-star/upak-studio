// Touch debounce/classification core — pure C99, no Arduino/IDF dependencies.
// Feed raw per-pad "touched/released + timestamp" samples (any rate; the S3
// glue polls at 50 Hz) and TAP/HOLD events come out on a hal_evq_t:
//
//   - transitions shorter than HAL_TOUCH_GLITCH_MS are ignored (glitch filter),
//     with event timing measured from the RAW transition instant, so debounce
//     latency does not skew tap/hold durations;
//   - release after < HAL_TOUCH_HOLD_MS held  -> HEV_TOUCH_TAP  (a = padId)
//   - held >= HAL_TOUCH_HOLD_MS               -> HEV_TOUCH_HOLD (a = padId),
//     repeating every HAL_TOUCH_HOLD_REPEAT_MS while the pad stays held
//     (a hold never also emits a tap on release).
#ifndef HAL_TOUCH_CORE_H
#define HAL_TOUCH_CORE_H

#include <stdint.h>

#include "hal_events.h"

#ifdef __cplusplus
extern "C" {
#endif

#define HAL_TOUCH_MAX_PADS 4
#define HAL_TOUCH_GLITCH_MS 30u
#define HAL_TOUCH_HOLD_MS 600u
#define HAL_TOUCH_HOLD_REPEAT_MS 1000u

typedef struct {
  uint8_t rawState;      // last raw sample (0/1)
  uint32_t rawSinceMs;   // when the raw state last changed
  uint8_t stableState;   // debounced state (0/1)
  uint32_t pressStartMs; // raw instant the accepted press began
  uint8_t holdFired;     // HOLD already emitted for this press
  uint32_t nextRepeatMs; // next HOLD repeat (valid when holdFired)
} hal_touch_pad_t;

typedef struct {
  hal_touch_pad_t pads[HAL_TOUCH_MAX_PADS];
} hal_touch_core_t;

void hal_touch_core_init(hal_touch_core_t *tc);

// Process one raw sample for pad `padId` at time `tMs` (monotonic, ms).
// `touched` is 0/1. Resulting events (0..2 per call) are pushed onto q.
void hal_touch_core_sample(hal_touch_core_t *tc, uint8_t padId, int touched,
                           uint32_t tMs, hal_evq_t *q);

#ifdef __cplusplus
}
#endif
#endif // HAL_TOUCH_CORE_H
