#include "hal_touch_core.h"

#include <string.h>

void hal_touch_core_init(hal_touch_core_t *tc) { memset(tc, 0, sizeof(*tc)); }

static void emit(hal_evq_t *q, uint8_t type, uint8_t padId, uint32_t tMs) {
  hal_event_t ev;
  ev.type = type;
  ev.a = (int16_t)padId;
  ev.b = 0;
  ev.tMs = tMs;
  hal_evq_push(q, &ev);
}

void hal_touch_core_sample(hal_touch_core_t *tc, uint8_t padId, int touched,
                           uint32_t tMs, hal_evq_t *q) {
  if (padId >= HAL_TOUCH_MAX_PADS) return;
  hal_touch_pad_t *p = &tc->pads[padId];
  uint8_t raw = touched ? 1 : 0;

  if (raw != p->rawState) {
    p->rawState = raw;
    p->rawSinceMs = tMs;
  }

  // Debounce: accept a raw state that has persisted >= GLITCH_MS. Shorter
  // blips flip rawState back before acceptance and are never seen. Timing
  // (press start / release instant) uses rawSinceMs, not the acceptance time.
  if (p->rawState != p->stableState &&
      (uint32_t)(tMs - p->rawSinceMs) >= HAL_TOUCH_GLITCH_MS) {
    p->stableState = p->rawState;
    if (p->stableState) {  // press accepted
      p->pressStartMs = p->rawSinceMs;
      p->holdFired = 0;
    } else {  // release accepted
      uint32_t heldMs = p->rawSinceMs - p->pressStartMs;
      if (!p->holdFired) {
        // Sparse sampling may reach the release before the while-held check
        // ever ran; classify by duration (>= 600 ms is a hold, ADR boundary).
        emit(q, heldMs < HAL_TOUCH_HOLD_MS ? HEV_TOUCH_TAP : HEV_TOUCH_HOLD,
             padId, p->rawSinceMs);
      }
    }
  }

  // While held: fire HOLD at the 600 ms boundary, then repeat every 1 s.
  // Gated on rawState too: once the finger has (raw-)lifted, the pending
  // release classifies the press — the debounce window must not grow it into
  // a hold it never was.
  if (p->stableState && p->rawState) {
    if (!p->holdFired &&
        (uint32_t)(tMs - p->pressStartMs) >= HAL_TOUCH_HOLD_MS) {
      p->holdFired = 1;
      p->nextRepeatMs = p->pressStartMs + HAL_TOUCH_HOLD_MS + HAL_TOUCH_HOLD_REPEAT_MS;
      emit(q, HEV_TOUCH_HOLD, padId, tMs);
    } else if (p->holdFired && (int32_t)(tMs - p->nextRepeatMs) >= 0) {
      p->nextRepeatMs += HAL_TOUCH_HOLD_REPEAT_MS;
      emit(q, HEV_TOUCH_HOLD, padId, tMs);
    }
  }
}
