// DeskPet capability registry + factory hwinfo record — pure C99, no
// Arduino/IDF dependencies. The bit assignments mirror ADR-008 and are an
// append-only public contract shared with Studio: never renumber.
//
// Golden rule (ADR-008): firmware logic branches on capabilities, never on
// tier. Tier appears only in branding strings and service entitlements.
#ifndef HAL_CAPS_H
#define HAL_CAPS_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// ---- capability bitmask (ADR-008 §4, append-only) --------------------------
#define CAP_TOUCH     (1u << 0)
#define CAP_IMU       (1u << 1)
#define CAP_MIC       (1u << 2)
#define CAP_SPEAKER   (1u << 3)
#define CAP_PRESENCE  (1u << 4)
#define CAP_ALS       (1u << 5)
#define CAP_RTC_EXT   (1u << 6)
#define CAP_BATTERY   (1u << 7)
#define CAP_FUELGAUGE (1u << 8)
#define CAP_PANEL_ALT (1u << 9)
#define CAP_AI_LINK   (1u << 10)
// bits 11+ reserved, append-only
#define HAL_CAP_KNOWN_COUNT 11

// ---- tiers (ADR-008 §3) ----------------------------------------------------
#define HAL_TIER_DEV 0
#define HAL_TIER_M   1
#define HAL_TIER_P   2
#define HAL_TIER_U   3

// ---- factory hwinfo record (ADR-008 §3) ------------------------------------
typedef struct {
  uint8_t schema;    // record layout version; 1 = this layout
  uint8_t gen;       // product generation (DP<gen>)
  uint8_t boardRev;  // 'A'..
  uint8_t tier;      // HAL_TIER_*
  uint32_t caps;     // capability bitmask
  uint64_t serial;   // unit serial number
  uint32_t mfgDate;  // yyyymmdd
} hal_hwinfo_t;

#define HAL_HWINFO_SCHEMA 1
// Encoded blob: schema,gen,boardRev,tier, caps u32, serial u64, mfgDate u32,
// 4 reserved bytes (zero on encode, ignored on decode). All little-endian.
#define HAL_HWINFO_BLOB_SIZE 24

// Serialize rec into buf (little-endian, HAL_HWINFO_BLOB_SIZE bytes).
// Returns bytes written, or -1 if bufLen is too small.
int hal_hwinfo_encode(const hal_hwinfo_t *rec, uint8_t *buf, size_t bufLen);

// Parse buf into rec. Returns 0 on success, -1 on truncated input or an
// unknown schema byte (forward-compat: refuse rather than misread).
int hal_hwinfo_decode(const uint8_t *buf, size_t bufLen, hal_hwinfo_t *rec);

// "dev" / "M" / "P" / "U" ("?" for out-of-range values).
const char *hal_tier_str(uint8_t tier);

// Registry name of capability bit (0-based), e.g. "TOUCH"; NULL if unknown.
const char *hal_cap_name(int bit);

#ifdef __cplusplus
}
#endif
#endif // HAL_CAPS_H
