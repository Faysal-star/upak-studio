// DeskPet input event bus — pure C99 fixed-size ring buffer, no allocation.
// Sensor glue pushes; the main loop drains once per iteration. On overflow the
// OLDEST event is dropped (fresh input beats stale input for a pet).
#ifndef HAL_EVENTS_H
#define HAL_EVENTS_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Event types (payload meaning in a/b):
enum {
  HEV_NONE = 0,
  HEV_TOUCH_TAP,   // a = padId
  HEV_TOUCH_HOLD,  // a = padId (fires at 600 ms, repeats every 1 s while held)
  HEV_PICKUP,      //
  HEV_SHAKE,       //
  HEV_TILT,        // a,b = direction
  HEV_SOUND_LOUD,  // a = level
  HEV_PRESENCE,    // a = 0/1
  HEV_LIGHT,       // a = level
  HEV_BATTERY,     // a = percent
};

typedef struct {
  uint8_t type;   // HEV_*
  int16_t a, b;   // payload (see type)
  uint32_t tMs;   // event timestamp (source clock, ms)
} hal_event_t;

#define HAL_EVQ_SLOTS 16

typedef struct {
  hal_event_t slots[HAL_EVQ_SLOTS];
  uint8_t head;   // index of oldest event
  uint8_t count;  // number of queued events
} hal_evq_t;

void hal_evq_init(hal_evq_t *q);

// Enqueue ev. When full, drops the oldest queued event to make room.
// Returns 1 if nothing was dropped, 0 if an old event was evicted.
int hal_evq_push(hal_evq_t *q, const hal_event_t *ev);

// Dequeue the oldest event into out. Returns 1 on success, 0 if empty.
int hal_evq_pop(hal_evq_t *q, hal_event_t *out);

#ifdef __cplusplus
}
#endif
#endif // HAL_EVENTS_H
