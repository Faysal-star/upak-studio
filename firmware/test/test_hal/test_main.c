// Host-side (pio test -e native) unit tests for the HAL pure cores:
// hwinfo encode/decode, event queue, touch tap/hold classifier.
#include <stdio.h>
#include <string.h>
#include <unity.h>

#include "hal_caps.h"
#include "hal_events.h"
#include "hal_touch_core.h"

void setUp(void) {}
void tearDown(void) {}

// ---------------------------------------------------------------------------
// hwinfo encode/decode
// ---------------------------------------------------------------------------
static void test_hwinfo_roundtrip(void) {
  hal_hwinfo_t in = {HAL_HWINFO_SCHEMA, 1, 'B', HAL_TIER_P,
                     CAP_TOUCH | CAP_IMU | CAP_BATTERY,
                     0x0123456789abcdefULL, 20260829};
  uint8_t buf[HAL_HWINFO_BLOB_SIZE];
  TEST_ASSERT_EQUAL_INT(HAL_HWINFO_BLOB_SIZE, hal_hwinfo_encode(&in, buf, sizeof(buf)));
  hal_hwinfo_t out;
  memset(&out, 0xff, sizeof(out));
  TEST_ASSERT_EQUAL_INT(0, hal_hwinfo_decode(buf, sizeof(buf), &out));
  TEST_ASSERT_EQUAL_UINT8(in.schema, out.schema);
  TEST_ASSERT_EQUAL_UINT8(in.gen, out.gen);
  TEST_ASSERT_EQUAL_UINT8(in.boardRev, out.boardRev);
  TEST_ASSERT_EQUAL_UINT8(in.tier, out.tier);
  TEST_ASSERT_EQUAL_UINT32(in.caps, out.caps);
  // (two 32-bit compares: Unity's 64-bit support is off in this env)
  TEST_ASSERT_EQUAL_UINT32((uint32_t)in.serial, (uint32_t)out.serial);
  TEST_ASSERT_EQUAL_UINT32((uint32_t)(in.serial >> 32), (uint32_t)(out.serial >> 32));
  TEST_ASSERT_EQUAL_UINT32(in.mfgDate, out.mfgDate);
}

static void test_hwinfo_encode_is_little_endian(void) {
  hal_hwinfo_t in = {HAL_HWINFO_SCHEMA, 1, 'A', HAL_TIER_DEV, 0x00000401u,
                     0x1122334455667788ULL, 0x01353E9Du /* 20266653 */};
  uint8_t buf[HAL_HWINFO_BLOB_SIZE];
  TEST_ASSERT_EQUAL_INT(HAL_HWINFO_BLOB_SIZE, hal_hwinfo_encode(&in, buf, sizeof(buf)));
  TEST_ASSERT_EQUAL_UINT8(0x01, buf[4]);  // caps LSB first
  TEST_ASSERT_EQUAL_UINT8(0x04, buf[5]);
  TEST_ASSERT_EQUAL_UINT8(0x88, buf[8]);  // serial LSB first
  TEST_ASSERT_EQUAL_UINT8(0x11, buf[15]);
  TEST_ASSERT_EQUAL_UINT8(0x9D, buf[16]);  // mfgDate LSB first
  // reserved tail is zeroed
  TEST_ASSERT_EQUAL_UINT8(0, buf[20]);
  TEST_ASSERT_EQUAL_UINT8(0, buf[23]);
}

static void test_hwinfo_rejects_truncated_and_bad_schema(void) {
  hal_hwinfo_t in = {HAL_HWINFO_SCHEMA, 1, 'A', HAL_TIER_M, CAP_TOUCH, 7, 20260101};
  uint8_t buf[HAL_HWINFO_BLOB_SIZE];
  TEST_ASSERT_EQUAL_INT(HAL_HWINFO_BLOB_SIZE, hal_hwinfo_encode(&in, buf, sizeof(buf)));

  hal_hwinfo_t out;
  // truncated input
  TEST_ASSERT_EQUAL_INT(-1, hal_hwinfo_decode(buf, HAL_HWINFO_BLOB_SIZE - 1, &out));
  TEST_ASSERT_EQUAL_INT(-1, hal_hwinfo_decode(buf, 0, &out));
  // unknown schema byte must refuse (forward compat)
  buf[0] = 2;
  TEST_ASSERT_EQUAL_INT(-1, hal_hwinfo_decode(buf, sizeof(buf), &out));
  buf[0] = 0;
  TEST_ASSERT_EQUAL_INT(-1, hal_hwinfo_decode(buf, sizeof(buf), &out));
  // encode into too-small buffer must refuse
  TEST_ASSERT_EQUAL_INT(-1, hal_hwinfo_encode(&in, buf, HAL_HWINFO_BLOB_SIZE - 1));
  // NULL args
  TEST_ASSERT_EQUAL_INT(-1, hal_hwinfo_decode(NULL, sizeof(buf), &out));
  TEST_ASSERT_EQUAL_INT(-1, hal_hwinfo_encode(NULL, buf, sizeof(buf)));
}

// ---------------------------------------------------------------------------
// Event queue
// ---------------------------------------------------------------------------
static hal_event_t mkev(uint8_t type, int16_t a, uint32_t t) {
  hal_event_t ev = {type, a, 0, t};
  return ev;
}

static void test_evq_empty_and_fifo_order(void) {
  hal_evq_t q;
  hal_evq_init(&q);
  hal_event_t out;
  TEST_ASSERT_EQUAL_INT(0, hal_evq_pop(&q, &out));  // empty

  for (int i = 0; i < 5; i++) {
    hal_event_t ev = mkev(HEV_TOUCH_TAP, (int16_t)i, (uint32_t)(100 + i));
    TEST_ASSERT_EQUAL_INT(1, hal_evq_push(&q, &ev));
  }
  for (int i = 0; i < 5; i++) {
    TEST_ASSERT_EQUAL_INT(1, hal_evq_pop(&q, &out));
    TEST_ASSERT_EQUAL_INT16((int16_t)i, out.a);
    TEST_ASSERT_EQUAL_UINT32((uint32_t)(100 + i), out.tMs);
  }
  TEST_ASSERT_EQUAL_INT(0, hal_evq_pop(&q, &out));
}

static void test_evq_fill_and_overflow_drops_oldest(void) {
  hal_evq_t q;
  hal_evq_init(&q);
  for (int i = 0; i < HAL_EVQ_SLOTS; i++) {
    hal_event_t ev = mkev(HEV_LIGHT, (int16_t)i, (uint32_t)i);
    TEST_ASSERT_EQUAL_INT(1, hal_evq_push(&q, &ev));
  }
  // two more: events 0 and 1 must be evicted
  hal_event_t ev = mkev(HEV_LIGHT, 100, 100);
  TEST_ASSERT_EQUAL_INT(0, hal_evq_push(&q, &ev));
  ev = mkev(HEV_LIGHT, 101, 101);
  TEST_ASSERT_EQUAL_INT(0, hal_evq_push(&q, &ev));

  hal_event_t out;
  TEST_ASSERT_EQUAL_INT(1, hal_evq_pop(&q, &out));
  TEST_ASSERT_EQUAL_INT16(2, out.a);  // 0 and 1 were dropped
  for (int i = 3; i < HAL_EVQ_SLOTS; i++) {
    TEST_ASSERT_EQUAL_INT(1, hal_evq_pop(&q, &out));
    TEST_ASSERT_EQUAL_INT16((int16_t)i, out.a);
  }
  TEST_ASSERT_EQUAL_INT(1, hal_evq_pop(&q, &out));
  TEST_ASSERT_EQUAL_INT16(100, out.a);
  TEST_ASSERT_EQUAL_INT(1, hal_evq_pop(&q, &out));
  TEST_ASSERT_EQUAL_INT16(101, out.a);
  TEST_ASSERT_EQUAL_INT(0, hal_evq_pop(&q, &out));
}

// ---------------------------------------------------------------------------
// Touch classifier. Helper: feed pad `pad` as touched over [t0,t1) with 1 ms
// samples (fine-grained so boundary tests are exact), released elsewhere.
// ---------------------------------------------------------------------------
static void feed(hal_touch_core_t *tc, hal_evq_t *q, uint8_t pad, int touched,
                 uint32_t from, uint32_t to) {
  for (uint32_t t = from; t < to; t++) hal_touch_core_sample(tc, pad, touched, t, q);
}

static int count_events(hal_evq_t *q, uint8_t type, int16_t pad) {
  int n = 0;
  hal_event_t ev;
  while (hal_evq_pop(q, &ev)) {
    TEST_ASSERT_EQUAL_UINT8(type, ev.type);
    TEST_ASSERT_EQUAL_INT16(pad, ev.a);
    n++;
  }
  return n;
}

static void test_touch_tap(void) {
  hal_touch_core_t tc;
  hal_evq_t q;
  hal_touch_core_init(&tc);
  hal_evq_init(&q);
  feed(&tc, &q, 0, 1, 0, 150);    // pressed 0..149
  feed(&tc, &q, 0, 0, 150, 300);  // released
  TEST_ASSERT_EQUAL_INT(1, count_events(&q, HEV_TOUCH_TAP, 0));
}

static void test_touch_glitch_rejected(void) {
  hal_touch_core_t tc;
  hal_evq_t q;
  hal_touch_core_init(&tc);
  hal_evq_init(&q);
  // 20 ms blip: below the 30 ms glitch filter -> no events at all
  feed(&tc, &q, 0, 1, 0, 20);
  feed(&tc, &q, 0, 0, 20, 200);
  hal_event_t ev;
  TEST_ASSERT_EQUAL_INT(0, hal_evq_pop(&q, &ev));

  // 29 ms release blip inside a long press must not split the hold
  hal_touch_core_init(&tc);
  hal_evq_init(&q);
  feed(&tc, &q, 1, 1, 0, 300);
  feed(&tc, &q, 1, 0, 300, 329);   // 29 ms dropout
  feed(&tc, &q, 1, 1, 329, 700);   // still one continuous press -> HOLD at 600
  feed(&tc, &q, 1, 0, 700, 800);
  TEST_ASSERT_EQUAL_INT(1, count_events(&q, HEV_TOUCH_HOLD, 1));
}

static void test_touch_hold_and_repeats(void) {
  hal_touch_core_t tc;
  hal_evq_t q;
  hal_touch_core_init(&tc);
  hal_evq_init(&q);
  // held 3 s: HOLD at 600, repeats at 1600, 2600 -> 3 events, then release: no tap
  feed(&tc, &q, 0, 1, 0, 3000);
  feed(&tc, &q, 0, 0, 3000, 3100);
  hal_event_t ev;
  TEST_ASSERT_EQUAL_INT(1, hal_evq_pop(&q, &ev));
  TEST_ASSERT_EQUAL_UINT8(HEV_TOUCH_HOLD, ev.type);
  TEST_ASSERT_EQUAL_UINT32(600, ev.tMs);
  TEST_ASSERT_EQUAL_INT(1, hal_evq_pop(&q, &ev));
  TEST_ASSERT_EQUAL_UINT32(1600, ev.tMs);
  TEST_ASSERT_EQUAL_INT(1, hal_evq_pop(&q, &ev));
  TEST_ASSERT_EQUAL_UINT32(2600, ev.tMs);
  TEST_ASSERT_EQUAL_INT(0, hal_evq_pop(&q, &ev));  // and nothing else
}

static void test_touch_600ms_boundary(void) {
  hal_touch_core_t tc;
  hal_evq_t q;

  // 599 ms press -> TAP
  hal_touch_core_init(&tc);
  hal_evq_init(&q);
  feed(&tc, &q, 0, 1, 0, 599);
  feed(&tc, &q, 0, 0, 599, 700);
  TEST_ASSERT_EQUAL_INT(1, count_events(&q, HEV_TOUCH_TAP, 0));

  // 600 ms press -> HOLD (>= 600 is a hold), exactly one, no tap
  hal_touch_core_init(&tc);
  hal_evq_init(&q);
  feed(&tc, &q, 0, 1, 0, 601);    // samples 0..600: the t=600 sample fires HOLD
  feed(&tc, &q, 0, 0, 601, 700);
  TEST_ASSERT_EQUAL_INT(1, count_events(&q, HEV_TOUCH_HOLD, 0));

  // sparse sampling: press seen only at 0, release only at 650 (plus debounce
  // settle) -> classified by duration as HOLD even though the 600 ms tick was
  // never sampled while held
  hal_touch_core_init(&tc);
  hal_evq_init(&q);
  hal_touch_core_sample(&tc, 0, 1, 0, &q);
  hal_touch_core_sample(&tc, 0, 1, 40, &q);   // press accepted (raw since 0)
  hal_touch_core_sample(&tc, 0, 0, 650, &q);  // raw release at 650
  hal_touch_core_sample(&tc, 0, 0, 700, &q);  // accepted: 650 ms -> one HOLD
  TEST_ASSERT_EQUAL_INT(1, count_events(&q, HEV_TOUCH_HOLD, 0));
}

static void test_touch_two_pads_independent(void) {
  hal_touch_core_t tc;
  hal_evq_t q;
  hal_touch_core_init(&tc);
  hal_evq_init(&q);
  // pad 0 held while pad 1 taps twice; interleave the samples
  for (uint32_t t = 0; t < 1000; t++) {
    hal_touch_core_sample(&tc, 0, 1, t, &q);
    int pad1 = (t < 100) || (t >= 400 && t < 500);  // two 100 ms taps
    hal_touch_core_sample(&tc, 1, pad1, t, &q);
  }
  feed(&tc, &q, 0, 0, 1000, 1100);
  feed(&tc, &q, 1, 0, 1000, 1100);

  int taps1 = 0, holds0 = 0;
  hal_event_t ev;
  while (hal_evq_pop(&q, &ev)) {
    if (ev.type == HEV_TOUCH_TAP) {
      TEST_ASSERT_EQUAL_INT16(1, ev.a);
      taps1++;
    } else if (ev.type == HEV_TOUCH_HOLD) {
      TEST_ASSERT_EQUAL_INT16(0, ev.a);
      holds0++;
    } else {
      TEST_FAIL_MESSAGE("unexpected event type");
    }
  }
  TEST_ASSERT_EQUAL_INT(2, taps1);
  TEST_ASSERT_EQUAL_INT(1, holds0);  // 1000 ms hold: initial fire only
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_hwinfo_roundtrip);
  RUN_TEST(test_hwinfo_encode_is_little_endian);
  RUN_TEST(test_hwinfo_rejects_truncated_and_bad_schema);
  RUN_TEST(test_evq_empty_and_fifo_order);
  RUN_TEST(test_evq_fill_and_overflow_drops_oldest);
  RUN_TEST(test_touch_tap);
  RUN_TEST(test_touch_glitch_rejected);
  RUN_TEST(test_touch_hold_and_repeats);
  RUN_TEST(test_touch_600ms_boundary);
  RUN_TEST(test_touch_two_pads_independent);
  return UNITY_END();
}
