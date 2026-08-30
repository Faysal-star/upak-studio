// Stub sensor drivers — compile everywhere, do nothing. Replace each with a
// real driver (guarded by its cap bit) once the part is chosen.
#include "hal_stubs.h"

int hal_imu_init(void) { return 0; }  // TODO: real IMU driver (part TBD)
int hal_imu_poll(hal_evq_t *q, uint32_t nowMs) {
  (void)q; (void)nowMs;
  return 0;
}

int hal_presence_init(void) { return 0; }  // TODO: presence driver (part TBD)
int hal_presence_poll(hal_evq_t *q, uint32_t nowMs) {
  (void)q; (void)nowMs;
  return 0;
}

int hal_mic_init(void) { return 0; }  // TODO: mic loudness driver (part TBD)
int hal_mic_poll(hal_evq_t *q, uint32_t nowMs) {
  (void)q; (void)nowMs;
  return 0;
}
