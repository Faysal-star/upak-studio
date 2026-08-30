// Host-side (pio test -e native) unit tests for the face engine + renderer.
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <unity.h>

#include "dpak.h"
#include "face_engine.h"
#include "face_render.h"

void setUp(void) {}
void tearDown(void) {}

// ---------------------------------------------------------------------------
// Track sampling + easing
// ---------------------------------------------------------------------------
static void test_track_sample_before_at_between_after(void) {
  face_track_t tr = {FP_EYE_W, 2, {{100, 0, 0}, {200, 256, 0}}};
  TEST_ASSERT_EQUAL_INT16(0, face_track_sample(&tr, 0));     // before first key
  TEST_ASSERT_EQUAL_INT16(0, face_track_sample(&tr, 100));   // at first key
  TEST_ASSERT_EQUAL_INT16(128, face_track_sample(&tr, 150)); // between (linear)
  TEST_ASSERT_EQUAL_INT16(256, face_track_sample(&tr, 200)); // at last key
  TEST_ASSERT_EQUAL_INT16(256, face_track_sample(&tr, 9999)); // after: hold
  // single-key track holds its value everywhere
  face_track_t one = {FP_EYE_H, 1, {{0, -1234, 0}}};
  TEST_ASSERT_EQUAL_INT16(-1234, face_track_sample(&one, 0));
  TEST_ASSERT_EQUAL_INT16(-1234, face_track_sample(&one, 50000));
}

static void test_easings_endpoints_exact(void) {
  for (uint8_t e = 0; e <= 4; e++) {
    TEST_ASSERT_EQUAL_INT32(0, face_ease(e, 0));
    TEST_ASSERT_EQUAL_INT32(65536, face_ease(e, 65536));
  }
}

static void test_easings_monotonic(void) {
  // 0..3 are strictly non-decreasing over [0,1]
  for (uint8_t e = 0; e <= 3; e++) {
    int32_t prev = 0;
    for (int32_t t = 0; t <= 65536; t += 256) {
      int32_t v = face_ease(e, t);
      TEST_ASSERT_TRUE(v >= prev);
      prev = v;
    }
  }
}

static void test_easeoutback_overshoot(void) {
  int32_t maxv = 0;
  for (int32_t t = 0; t <= 65536; t += 64) {
    int32_t v = face_ease(4, t);
    if (v > maxv) maxv = v;
  }
  TEST_ASSERT_TRUE(maxv > 65536); // overshoot present
  TEST_ASSERT_TRUE(maxv < 65536 + 8000); // ~1.7% -> bounded (~1.10 peak is 72000; sanity)
}

// ---------------------------------------------------------------------------
// Blink scheduler determinism
// ---------------------------------------------------------------------------
#define MAX_BLINKS 64
static int record_blinks(uint32_t seed, uint32_t starts[MAX_BLINKS]) {
  face_engine_t *eng = malloc(sizeof(*eng));
  face_params_t out;
  face_engine_init(eng, seed);
  eng->autoExpr = 0; // isolate: no expression switches
  int n = 0;
  uint8_t was = 0;
  for (uint32_t t = 0; t <= 60000; t += 16) {
    face_engine_update(eng, t, &out);
    if (eng->blinkActive && !was && n < MAX_BLINKS) starts[n++] = eng->blinkStartMs;
    was = eng->blinkActive;
    if (!eng->blinkActive) {
      // lids fully open again between blinks (neutral expression has open lids)
      TEST_ASSERT_EQUAL_INT16(0, out.v[FP_LID_TOP_L]);
      TEST_ASSERT_EQUAL_INT16(0, out.v[FP_LID_TOP_R]);
    }
  }
  free(eng);
  return n;
}

static void test_blink_deterministic_and_bounded(void) {
  uint32_t a[MAX_BLINKS], b[MAX_BLINKS];
  int na = record_blinks(1234, a);
  int nb = record_blinks(1234, b);
  TEST_ASSERT_EQUAL_INT(na, nb);
  TEST_ASSERT_TRUE(na >= 6); // 60 s / max ~8.3 s interval
  for (int i = 0; i < na; i++) TEST_ASSERT_EQUAL_UINT32(a[i], b[i]);
  // start-to-start intervals: >= 2500 min interval; <= 6500 + 1020 (low-energy
  // stretch) + 200 (blink duration) + 16 (tick granularity)
  for (int i = 1; i < na; i++) {
    uint32_t d = a[i] - a[i - 1];
    TEST_ASSERT_TRUE(d >= 2500);
    TEST_ASSERT_TRUE(d <= 6500u + 1020u + 200u + 16u);
  }
  // different seed -> different schedule
  uint32_t c[MAX_BLINKS];
  int nc = record_blinks(99, c);
  int same = (nc == na);
  if (same)
    for (int i = 0; i < na; i++)
      if (a[i] != c[i]) { same = 0; break; }
  TEST_ASSERT_FALSE(same);
}

// ---------------------------------------------------------------------------
// Mood drift
// ---------------------------------------------------------------------------
static void test_mood_drift_bounds(void) {
  face_engine_t *eng = malloc(sizeof(*eng));
  face_params_t out;
  face_engine_init(eng, 7);
  eng->autoExpr = 0;
  for (uint32_t t = 0; t <= 3u * 3600u * 1000u; t += 1000) { // 3 simulated hours
    face_engine_update(eng, t, &out);
    TEST_ASSERT_TRUE(eng->mood.energy >= 48 && eng->mood.energy <= 208);
  }
  // saturation, not wraparound
  TEST_ASSERT_EQUAL_UINT8(255, eng->mood.boredom);
  TEST_ASSERT_EQUAL_UINT8(0, eng->mood.attention);
  TEST_ASSERT_EQUAL_UINT8(128, eng->mood.happiness); // relaxed to baseline
  free(eng);
}

static void test_bump_new_art(void) {
  face_engine_t *eng = malloc(sizeof(*eng));
  face_params_t out;
  face_engine_init(eng, 7);
  face_engine_update(eng, 0, &out);
  uint8_t h0 = eng->mood.happiness, a0 = eng->mood.attention;
  face_engine_bump(eng, FACE_EVT_NEW_ART);
  TEST_ASSERT_TRUE(eng->mood.happiness > h0);
  TEST_ASSERT_TRUE(eng->mood.attention > a0);
  TEST_ASSERT_EQUAL_UINT8(FACE_EXPR_SURPRISED, eng->curExpr);
  // happy follow-up fires at the (shortened) next scheduler pick
  face_engine_update(eng, 2600, &out);
  TEST_ASSERT_EQUAL_UINT8(FACE_EXPR_HAPPY, eng->curExpr);
  free(eng);
}

// ---------------------------------------------------------------------------
// EXPR parsing (DPAK override path)
// ---------------------------------------------------------------------------
// Build a minimal 1-asset DPAK pack around an EXPR blob (header+TOC+blob, CRC'd).
static size_t build_expr_pack(const uint8_t *blob, uint32_t blobLen, uint32_t nameHash,
                              uint8_t *out, size_t outCap) {
  size_t total = 32 + 32 + blobLen;
  if (total > outCap) return 0;
  memset(out, 0, 64);
  memcpy(out, "DPAK", 4);
  out[4] = 1;             // version
  out[8] = 1;             // tocCount
  out[12] = 32;           // tocOffset
  // TOC entry at 32
  out[32] = 1;            // assetId
  out[36] = DPAK_TYPE_EXPR;
  memcpy(out + 40, &nameHash, 4);
  uint32_t off = 64, len = blobLen;
  memcpy(out + 44, &off, 4);
  memcpy(out + 48, &len, 4);
  memcpy(out + 64, blob, blobLen);
  uint32_t crc = dpak_crc32(out + 32, total - 32);
  memcpy(out + 16, &crc, 4);
  return total;
}

// EXPR blob writer mirroring tools/dpak-cli/dpakw.mjs exprBlob()
typedef struct { uint16_t t; int16_t v; uint8_t e; } tk_t;
static uint32_t put_track(uint8_t *p, uint8_t paramId, const tk_t *keys, uint8_t n) {
  p[0] = paramId; p[1] = n; p[2] = 0; p[3] = 0;
  for (uint8_t i = 0; i < n; i++) {
    uint8_t *k = p + 4 + i * 6;
    k[0] = keys[i].t & 0xff; k[1] = keys[i].t >> 8;
    k[2] = (uint16_t)keys[i].v & 0xff; k[3] = ((uint16_t)keys[i].v >> 8) & 0xff;
    k[4] = keys[i].e; k[5] = 0;
  }
  return 4u + n * 6u;
}

// mirrors gen-face.mjs expr_happy (same numbers as the k_happy builtin),
// except mouthCurve ends at 123 so the override is observable.
static uint32_t build_happy_blob(uint8_t *b, int16_t curveEnd) {
  uint32_t o = 0;
  b[0] = 6; b[1] = 0; b[2] = 0; b[3] = 0;
  o = 4;
  o += put_track(b + o, 9,  (tk_t[]){{0, 0, 2}, {300, 96, 0}}, 2);        // lidBotL
  o += put_track(b + o, 10, (tk_t[]){{0, 0, 2}, {300, 96, 0}}, 2);        // lidBotR
  o += put_track(b + o, 14, (tk_t[]){{0, 40, 2}, {300, curveEnd, 0}}, 2); // mouthCurve
  o += put_track(b + o, 13, (tk_t[]){{0, 28, 2}, {300, 80, 0}}, 2);       // mouthOpen
  o += put_track(b + o, 5,  (tk_t[]){{0, 16384, 2}, {300, 15360, 0}}, 2); // eyeH
  o += put_track(b + o, 15, (tk_t[]){{0, 0, 4}, {220, 56, 2}, {440, 0, 0}}, 3); // squash
  return o;
}

static void test_expr_override_applies(void) {
  uint8_t blob[256], pack[512];
  uint32_t blobLen = build_happy_blob(blob, 123);
  TEST_ASSERT_EQUAL_UINT32(106, blobLen); // matches gen-face.mjs expr_happy size
  size_t packLen =
      build_expr_pack(blob, blobLen, dpak_fnv1a_str("expr_happy"), pack, sizeof(pack));
  TEST_ASSERT_TRUE(packLen > 0);

  dpak_t pak;
  TEST_ASSERT_EQUAL_INT(DPAK_OK, dpak_open(pack, packLen, 0, &pak));
  face_engine_t *eng = malloc(sizeof(*eng));
  face_engine_init(eng, 1);
  // builtin happy holds mouthCurve 200 at end of track
  const face_expr_t *happy = &eng->exprs[FACE_EXPR_HAPPY];
  TEST_ASSERT_EQUAL_INT16(200, face_track_sample(&happy->tracks[2], 300));
  TEST_ASSERT_EQUAL_INT(1, face_engine_load_dpak(eng, &pak));
  // override in place: same shape, new value, duration preserved
  TEST_ASSERT_EQUAL_UINT8(6, happy->trackCount);
  TEST_ASSERT_EQUAL_UINT16(440, happy->durationMs);
  TEST_ASSERT_EQUAL_INT16(123, face_track_sample(&happy->tracks[2], 300));
  free(eng);
}

static void test_expr_fuzz_truncation(void) {
  uint8_t blob[256], pack[512];
  uint32_t blobLen = build_happy_blob(blob, 200);
  // fuzz the blob length down byte by byte; parser must never read OOB or crash
  for (uint32_t len = blobLen; len > 0; len--) {
    size_t packLen =
        build_expr_pack(blob, len - 1, dpak_fnv1a_str("expr_happy"), pack, sizeof(pack));
    dpak_t pak;
    if (dpak_open(pack, packLen, 0, &pak) != DPAK_OK) continue;
    face_engine_t *eng = malloc(sizeof(*eng));
    face_engine_init(eng, 1);
    int n = face_engine_load_dpak(eng, &pak); // must not crash; 0 or 1 ok
    TEST_ASSERT_TRUE(n == 0 || n == 1);
    face_params_t out;
    face_engine_update(eng, 0, &out); // engine still functional either way
    free(eng);
  }
  // corrupt bytes: bad paramId / keyCount / easing all rejected
  face_expr_t e;
  uint8_t bad[64];
  memcpy(bad, blob, sizeof(bad));
  bad[4] = 99; // paramId out of range
  TEST_ASSERT_EQUAL_INT(-1, face_expr_parse(bad, blobLen, &e));
  memcpy(bad, blob, sizeof(bad));
  bad[5] = 0; // keyCount 0
  TEST_ASSERT_EQUAL_INT(-1, face_expr_parse(bad, blobLen, &e));
  memcpy(bad, blob, sizeof(bad));
  bad[12] = 9; // easing out of range (first key of first track)
  TEST_ASSERT_EQUAL_INT(-1, face_expr_parse(bad, blobLen, &e));
  bad[0] = 17; // trackCount > param count
  TEST_ASSERT_EQUAL_INT(-1, face_expr_parse(bad, blobLen, &e));
  TEST_ASSERT_EQUAL_INT(-1, face_expr_parse(NULL, 10, &e));
  TEST_ASSERT_EQUAL_INT(-1, face_expr_parse(bad, 3, &e));
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
#define RW 240
#define RH 240
static uint16_t g_buf[RW * RH];

// golden FNV-1a checksums over the rendered RGB565 buffer (native u16 bytes)
#define GOLDEN_NEUTRAL_FNV 3737044150u  // 0xdec02cb6
#define GOLDEN_MIDBLINK_FNV 1946316934u // 0x7401c886

static void test_render_golden_neutral(void) {
  face_render(&FACE_NEUTRAL_POSE, g_buf, RW, RH, RW, NULL);
  uint32_t fnv = dpak_fnv1a(g_buf, sizeof(g_buf));
  printf("neutral fnv=0x%08x\n", fnv);
  TEST_ASSERT_EQUAL_UINT32(GOLDEN_NEUTRAL_FNV, fnv);
}

static void test_render_golden_midblink(void) {
  face_params_t p = FACE_NEUTRAL_POSE;
  p.v[FP_LID_TOP_L] = 128;
  p.v[FP_LID_TOP_R] = 128;
  face_render(&p, g_buf, RW, RH, RW, NULL);
  uint32_t fnv = dpak_fnv1a(g_buf, sizeof(g_buf));
  printf("midblink fnv=0x%08x\n", fnv);
  TEST_ASSERT_EQUAL_UINT32(GOLDEN_MIDBLINK_FNV, fnv);
}

static void check_bounds_contain_all(const face_params_t *p) {
  face_style_t st;
  face_style_default(&st);
  face_render(p, g_buf, RW, RH, RW, &st);
  int bx, by, bw, bh;
  face_bounds(p, RW, RH, &bx, &by, &bw, &bh);
  for (int y = 0; y < RH; y++)
    for (int x = 0; x < RW; x++)
      if (g_buf[y * RW + x] != st.bg) {
        int inside = x >= bx && x < bx + bw && y >= by && y < by + bh;
        if (!inside) {
          char msg[80];
          snprintf(msg, sizeof(msg), "pixel (%d,%d) outside bounds (%d,%d %dx%d)", x, y, bx,
                   by, bw, bh);
          TEST_FAIL_MESSAGE(msg);
        }
      }
}

static void test_bounds_contain_all_pixels(void) {
  check_bounds_contain_all(&FACE_NEUTRAL_POSE);
  // end pose of each built-in expression (sampled through the engine, no
  // gaze/blink active yet at t=1000 with these schedules)
  for (int id = 0; id < FACE_EXPR_COUNT; id++) {
    face_engine_t *eng = malloc(sizeof(*eng));
    face_params_t out;
    face_engine_init(eng, 5);
    eng->autoExpr = 0;
    face_engine_update(eng, 0, &out);
    face_engine_set_expression(eng, (face_expr_id_t)id);
    face_engine_update(eng, 1000, &out); // past duration+blend for short exprs
    check_bounds_contain_all(&out);
    free(eng);
  }
  // pathological params must clamp, not crash or escape bounds
  face_params_t crazy;
  for (int i = 0; i < FACE_PARAM_COUNT; i++) crazy.v[i] = (int16_t)(0x7fff - i * 4096);
  face_render(&crazy, g_buf, RW, RH, RW, NULL); // just must not crash/overflow
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_track_sample_before_at_between_after);
  RUN_TEST(test_easings_endpoints_exact);
  RUN_TEST(test_easings_monotonic);
  RUN_TEST(test_easeoutback_overshoot);
  RUN_TEST(test_blink_deterministic_and_bounded);
  RUN_TEST(test_mood_drift_bounds);
  RUN_TEST(test_bump_new_art);
  RUN_TEST(test_expr_override_applies);
  RUN_TEST(test_expr_fuzz_truncation);
  RUN_TEST(test_render_golden_neutral);
  RUN_TEST(test_render_golden_midblink);
  RUN_TEST(test_bounds_contain_all_pixels);
  return UNITY_END();
}
