// Device-facing HAL API (implemented in hal_esp32.cpp for Arduino targets).
// The pure cores (hal_caps / hal_events / hal_touch_core) have no Arduino
// dependency and are unit-tested natively; this header is the glue contract
// main.cpp talks to.
#ifndef HAL_H
#define HAL_H

#include <stdint.h>

#include "hal_caps.h"
#include "hal_events.h"

#ifdef __cplusplus
extern "C" {
#endif

// Load hwinfo from NVS (namespace "hwinfo", key "rec"); missing/invalid ->
// auto-probe (tier=dev, caps from self-test). Then init the drivers whose cap
// bits are set. Call once after display init.
void dp_hal_init(void);

// Poll sensors and feed the event queue. Call every loop() iteration; touch
// sampling is rate-limited to 50 Hz internally.
void dp_hal_poll(uint32_t nowMs);

// The active hardware record and where it came from ("nvs" or "probe").
const hal_hwinfo_t *dp_hal_hwinfo(void);
const char *dp_hal_hwinfo_source(void);

// The input event queue (drain with hal_evq_pop each loop).
hal_evq_t *dp_hal_queue(void);

// Dev tools (serial console). Both return 0 on success, -1 on NVS failure.
int dp_hal_caps_set_override(uint32_t caps);  // persist; applies on reboot
int dp_hal_hwinfo_clear(void);                // erase record; next boot re-probes

#ifdef __cplusplus
}
#endif
#endif // HAL_H
