#include "hal_events.h"

#include <string.h>

void hal_evq_init(hal_evq_t *q) { memset(q, 0, sizeof(*q)); }

int hal_evq_push(hal_evq_t *q, const hal_event_t *ev) {
  int dropped = 0;
  if (q->count == HAL_EVQ_SLOTS) {  // full: evict the oldest
    q->head = (uint8_t)((q->head + 1) % HAL_EVQ_SLOTS);
    q->count--;
    dropped = 1;
  }
  q->slots[(q->head + q->count) % HAL_EVQ_SLOTS] = *ev;
  q->count++;
  return !dropped;
}

int hal_evq_pop(hal_evq_t *q, hal_event_t *out) {
  if (q->count == 0) return 0;
  *out = q->slots[q->head];
  q->head = (uint8_t)((q->head + 1) % HAL_EVQ_SLOTS);
  q->count--;
  return 1;
}
