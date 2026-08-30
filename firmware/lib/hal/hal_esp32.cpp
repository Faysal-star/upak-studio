// ESP32/ESP32-S3 peripheral glue for the HAL (thin by design: all decision
// logic lives in the pure C cores). Native test builds never see this file —
// everything is inside #ifdef ARDUINO.
#ifdef ARDUINO

#include <Arduino.h>
#include <Preferences.h>

extern "C" {
#include "hal.h"
#include "hal_stubs.h"
#include "hal_touch_core.h"
}

static const char *NVS_NS = "hwinfo";
static const char *NVS_KEY = "rec";

static hal_hwinfo_t g_hwinfo;
static const char *g_source = "probe";
static hal_evq_t g_evq;
static hal_touch_core_t g_touch;

// ---------------------------------------------------------------------------
// Touch driver — ESP32-S3 only for now.
// S3 semantics: touchRead() values RISE when the pad is touched (opposite of
// the classic ESP32, where they fall). Threshold = boot baseline x factor.
// Polled at 50 Hz from dp_hal_poll(); classification is in hal_touch_core.
// TODO(classic ESP32): its touchRead values FALL on touch and sit in a very
// different range — needs its own thresholding before enabling CAP_TOUCH.
// ---------------------------------------------------------------------------
#if defined(CONFIG_IDF_TARGET_ESP32S3)
#define DP_HAS_TOUCH_DRIVER 1
// S3 touch channels are GPIO1-14; 8/9/10/11/12 are taken by the display, so
// GPIO4 ("head", pad 0) and GPIO5 ("side", pad 1) are free on the DevKitC-1.
static const uint8_t TOUCH_PINS[] = {4, 5};
static const int TOUCH_PAD_COUNT = sizeof(TOUCH_PINS) / sizeof(TOUCH_PINS[0]);
static uint32_t g_touchBaseline[TOUCH_PAD_COUNT];
static constexpr float TOUCH_THRESH_FACTOR = 1.25f;  // touched when > baseline x this
static uint32_t g_touchThresh[TOUCH_PAD_COUNT];
static bool g_touchOk = false;

// Baseline self-calibration: average ~20 idle samples per pad at boot.
// Returns true if every pad reads sanely (also our CAP_TOUCH probe).
static bool touchInit() {
  for (int p = 0; p < TOUCH_PAD_COUNT; p++) {
    uint64_t sum = 0;
    int good = 0;
    for (int i = 0; i < 20; i++) {
      uint32_t v = touchRead(TOUCH_PINS[p]);
      if (v > 0) { sum += v; good++; }
      delay(2);
    }
    if (good < 10) return false;  // peripheral not responding
    g_touchBaseline[p] = (uint32_t)(sum / good);
    g_touchThresh[p] = (uint32_t)(g_touchBaseline[p] * TOUCH_THRESH_FACTOR);
  }
  return true;
}

static void touchPoll(uint32_t nowMs) {
  if (!g_touchOk) return;
  for (int p = 0; p < TOUCH_PAD_COUNT; p++) {
    uint32_t v = touchRead(TOUCH_PINS[p]);
    hal_touch_core_sample(&g_touch, (uint8_t)p, v > g_touchThresh[p], nowMs, &g_evq);
  }
}
#else
#define DP_HAS_TOUCH_DRIVER 0
static bool g_touchOk = false;
static bool touchInit() { return false; }
static void touchPoll(uint32_t nowMs) { (void)nowMs; }
#endif

// ---------------------------------------------------------------------------
// hwinfo: NVS record, else auto-probe (ADR-008 §3)
// ---------------------------------------------------------------------------
static bool loadHwinfoNvs() {
  Preferences prefs;
  if (!prefs.begin(NVS_NS, true)) return false;  // namespace absent
  uint8_t buf[HAL_HWINFO_BLOB_SIZE];
  size_t got = prefs.getBytes(NVS_KEY, buf, sizeof(buf));
  prefs.end();
  return got == HAL_HWINFO_BLOB_SIZE && hal_hwinfo_decode(buf, got, &g_hwinfo) == 0;
}

static void probeHwinfo() {
  g_hwinfo.schema = HAL_HWINFO_SCHEMA;
  g_hwinfo.gen = 1;
  g_hwinfo.boardRev = 'A';
  g_hwinfo.tier = HAL_TIER_DEV;
  g_hwinfo.caps = 0;
  g_hwinfo.serial = 0;
  g_hwinfo.mfgDate = 0;
  // Touch self-test doubles as the CAP_TOUCH probe (below, in dp_hal_init).
  // Future: I2C scan here sets CAP_IMU / CAP_PRESENCE / ... as parts land.
}

void dp_hal_init(void) {
  hal_evq_init(&g_evq);
  hal_touch_core_init(&g_touch);

  bool fromNvs = loadHwinfoNvs();
  g_source = fromNvs ? "nvs" : "probe";
  if (!fromNvs) probeHwinfo();

  // Golden rule: drivers init iff their cap bit is set — except during probe,
  // where the self-test decides the bit.
  if (!fromNvs) {
    g_touchOk = DP_HAS_TOUCH_DRIVER && touchInit();
    if (g_touchOk) g_hwinfo.caps |= CAP_TOUCH;
  } else if (g_hwinfo.caps & CAP_TOUCH) {
    g_touchOk = DP_HAS_TOUCH_DRIVER && touchInit();
  }
  if (g_hwinfo.caps & CAP_IMU) hal_imu_init();
  if (g_hwinfo.caps & CAP_PRESENCE) hal_presence_init();
  if (g_hwinfo.caps & CAP_MIC) hal_mic_init();
}

void dp_hal_poll(uint32_t nowMs) {
  static uint32_t lastMs = 0;
  if (nowMs - lastMs < 20) return;  // 50 Hz
  lastMs = nowMs;
  touchPoll(nowMs);
  if (g_hwinfo.caps & CAP_IMU) hal_imu_poll(&g_evq, nowMs);
  if (g_hwinfo.caps & CAP_PRESENCE) hal_presence_poll(&g_evq, nowMs);
  if (g_hwinfo.caps & CAP_MIC) hal_mic_poll(&g_evq, nowMs);
}

const hal_hwinfo_t *dp_hal_hwinfo(void) { return &g_hwinfo; }
const char *dp_hal_hwinfo_source(void) { return g_source; }
hal_evq_t *dp_hal_queue(void) { return &g_evq; }

int dp_hal_caps_set_override(uint32_t caps) {
  hal_hwinfo_t rec = g_hwinfo;  // keep gen/rev/tier/serial as currently active
  rec.schema = HAL_HWINFO_SCHEMA;
  rec.caps = caps;
  uint8_t buf[HAL_HWINFO_BLOB_SIZE];
  if (hal_hwinfo_encode(&rec, buf, sizeof(buf)) < 0) return -1;
  Preferences prefs;
  if (!prefs.begin(NVS_NS, false)) return -1;
  size_t put = prefs.putBytes(NVS_KEY, buf, sizeof(buf));
  prefs.end();
  return put == sizeof(buf) ? 0 : -1;
}

int dp_hal_hwinfo_clear(void) {
  Preferences prefs;
  if (!prefs.begin(NVS_NS, false)) return -1;
  prefs.remove(NVS_KEY);  // absent key is fine — goal state is "no record"
  prefs.end();
  return 0;
}

#endif  // ARDUINO
