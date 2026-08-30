// Future-sensor driver interfaces — stubs only for now (parts still being
// researched). Each driver inits iff its cap bit is set (ADR-008 golden rule)
// and pushes hal_event_t onto the queue from poll(). Today every init returns
// 0 (absent) and every poll produces nothing, so absent caps degrade silently.
#ifndef HAL_STUBS_H
#define HAL_STUBS_H

#include <stdint.h>

#include "hal_events.h"

#ifdef __cplusplus
extern "C" {
#endif

// IMU (pickup/shake/tilt -> HEV_PICKUP/HEV_SHAKE/HEV_TILT). TODO: part TBD.
int hal_imu_init(void);                             // 1 = present+ready, 0 = absent
int hal_imu_poll(hal_evq_t *q, uint32_t nowMs);     // 1 = events pushed

// Presence sensor (HEV_PRESENCE). TODO: part TBD.
int hal_presence_init(void);
int hal_presence_poll(hal_evq_t *q, uint32_t nowMs);

// Microphone loudness (HEV_SOUND_LOUD). TODO: part TBD.
int hal_mic_init(void);
int hal_mic_poll(hal_evq_t *q, uint32_t nowMs);

#ifdef __cplusplus
}
#endif
#endif // HAL_STUBS_H
