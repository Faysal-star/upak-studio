// hwinfo (de)serialization + registry strings — pure C99, unit-tested natively.
#include "hal_caps.h"

#include <string.h>

int hal_hwinfo_encode(const hal_hwinfo_t *rec, uint8_t *buf, size_t bufLen) {
  if (!rec || !buf || bufLen < HAL_HWINFO_BLOB_SIZE) return -1;
  memset(buf, 0, HAL_HWINFO_BLOB_SIZE);
  buf[0] = rec->schema;
  buf[1] = rec->gen;
  buf[2] = rec->boardRev;
  buf[3] = rec->tier;
  for (int i = 0; i < 4; i++) buf[4 + i] = (uint8_t)(rec->caps >> (8 * i));
  for (int i = 0; i < 8; i++) buf[8 + i] = (uint8_t)(rec->serial >> (8 * i));
  for (int i = 0; i < 4; i++) buf[16 + i] = (uint8_t)(rec->mfgDate >> (8 * i));
  // bytes 20..23 reserved (zeroed)
  return HAL_HWINFO_BLOB_SIZE;
}

int hal_hwinfo_decode(const uint8_t *buf, size_t bufLen, hal_hwinfo_t *rec) {
  if (!buf || !rec || bufLen < HAL_HWINFO_BLOB_SIZE) return -1;
  if (buf[0] != HAL_HWINFO_SCHEMA) return -1;
  rec->schema = buf[0];
  rec->gen = buf[1];
  rec->boardRev = buf[2];
  rec->tier = buf[3];
  rec->caps = 0;
  rec->serial = 0;
  rec->mfgDate = 0;
  for (int i = 0; i < 4; i++) rec->caps |= (uint32_t)buf[4 + i] << (8 * i);
  for (int i = 0; i < 8; i++) rec->serial |= (uint64_t)buf[8 + i] << (8 * i);
  for (int i = 0; i < 4; i++) rec->mfgDate |= (uint32_t)buf[16 + i] << (8 * i);
  return 0;
}

const char *hal_tier_str(uint8_t tier) {
  switch (tier) {
    case HAL_TIER_DEV: return "dev";
    case HAL_TIER_M: return "M";
    case HAL_TIER_P: return "P";
    case HAL_TIER_U: return "U";
    default: return "?";
  }
}

const char *hal_cap_name(int bit) {
  static const char *names[HAL_CAP_KNOWN_COUNT] = {
      "TOUCH", "IMU",       "MIC",       "SPEAKER",   "PRESENCE", "ALS",
      "RTC_EXT", "BATTERY", "FUELGAUGE", "PANEL_ALT", "AI_LINK"};
  if (bit < 0 || bit >= HAL_CAP_KNOWN_COUNT) return NULL;
  return names[bit];
}
