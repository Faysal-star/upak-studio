// DeskPet procedural face engine. See face_engine.h. Pure C99, integer math,
// no allocation — deterministic for a given (seed, nowMs sequence).
#include "face_engine.h"

#include <string.h>

// ---------------------------------------------------------------------------
// Neutral pose (240x240 reference; dimensional values are 1/256 px)
// ---------------------------------------------------------------------------
#define PXV(n) ((int16_t)((n) * 256))

const face_params_t FACE_NEUTRAL_POSE = {{
    PXV(-42), PXV(-10), // eyeLX, eyeLY
    PXV(42), PXV(-10),  // eyeRX, eyeRY
    PXV(56), PXV(64),   // eyeW, eyeH
    PXV(20),            // eyeRadius
    0, 0, 0, 0,         // lids open
    0, 0,               // brows hidden
    28, 40,             // mouthOpen (thin line), mouthCurve (slight smile)
    0,                  // squash
}};

// ---------------------------------------------------------------------------
// Built-in expressions (same data shape as DPAK EXPR tracks; gen-face.mjs
// mirrors these numbers into firmware/data/face.dpak)
// ---------------------------------------------------------------------------
typedef struct {
  uint8_t paramId, keyCount;
  face_key_t keys[4];
} builtin_track_t;

// clang-format off
static const builtin_track_t k_happy[] = {
  {FP_LID_BOT_L,   2, {{0, 0, 2},     {300, 96, 0}}},
  {FP_LID_BOT_R,   2, {{0, 0, 2},     {300, 96, 0}}},
  {FP_MOUTH_CURVE, 2, {{0, 40, 2},    {300, 200, 0}}},
  {FP_MOUTH_OPEN,  2, {{0, 28, 2},    {300, 80, 0}}},
  {FP_EYE_H,       2, {{0, 16384, 2}, {300, 15360, 0}}},
  {FP_SQUASH,      3, {{0, 0, 4},     {220, 56, 2}, {440, 0, 0}}},
};
static const builtin_track_t k_sleepy[] = {
  {FP_LID_TOP_L,   3, {{0, 120, 2}, {1500, 176, 3}, {3000, 150, 0}}},
  {FP_LID_TOP_R,   3, {{0, 120, 2}, {1500, 176, 3}, {3000, 150, 0}}},
  {FP_EYE_H,       1, {{0, 15104, 0}}},
  {FP_MOUTH_CURVE, 1, {{0, 10, 0}}},
  {FP_MOUTH_OPEN,  1, {{0, 12, 0}}},
  {FP_SQUASH,      1, {{0, 40, 0}}},
};
static const builtin_track_t k_angry[] = {
  {FP_BROW_L,      2, {{0, 0, 2},   {250, 2560, 0}}},
  {FP_BROW_R,      2, {{0, 0, 2},   {250, 2560, 0}}},
  {FP_LID_TOP_L,   2, {{0, 70, 2},  {250, 110, 0}}},
  {FP_LID_TOP_R,   2, {{0, 70, 2},  {250, 110, 0}}},
  {FP_MOUTH_CURVE, 2, {{0, -40, 2}, {250, -150, 0}}},
  {FP_MOUTH_OPEN,  1, {{0, 20, 0}}},
  {FP_EYE_H,       1, {{0, 14080, 0}}},
};
static const builtin_track_t k_surprised[] = {
  {FP_EYE_W,       2, {{0, 14336, 4}, {200, 16128, 0}}},
  {FP_EYE_H,       2, {{0, 16384, 4}, {200, 19456, 0}}},
  {FP_EYE_RADIUS,  1, {{0, 6656, 0}}},
  {FP_BROW_L,      1, {{0, -2048, 0}}},
  {FP_BROW_R,      1, {{0, -2048, 0}}},
  {FP_MOUTH_OPEN,  2, {{0, 28, 2},    {200, 170, 0}}},
  {FP_MOUTH_CURVE, 1, {{0, 0, 0}}},
};
static const builtin_track_t k_sad[] = {
  {FP_LID_TOP_L,   2, {{0, 60, 2},  {400, 120, 0}}},
  {FP_LID_TOP_R,   2, {{0, 60, 2},  {400, 120, 0}}},
  {FP_BROW_L,      1, {{0, -2304, 0}}},
  {FP_BROW_R,      1, {{0, -2304, 0}}},
  {FP_MOUTH_CURVE, 2, {{0, 40, 2},  {400, -180, 0}}},
  {FP_MOUTH_OPEN,  1, {{0, 12, 0}}},
  {FP_EYE_LY,      2, {{0, -2560, 2}, {400, -1024, 0}}},
  {FP_EYE_RY,      2, {{0, -2560, 2}, {400, -1024, 0}}},
  {FP_SQUASH,      1, {{0, 24, 0}}},
};
// clang-format on

static void load_builtin(face_expr_t *e, const builtin_track_t *tr, int n) {
  memset(e, 0, sizeof(*e));
  e->trackCount = (uint8_t)n;
  for (int i = 0; i < n; i++) {
    e->tracks[i].paramId = tr[i].paramId;
    e->tracks[i].keyCount = tr[i].keyCount;
    for (int k = 0; k < tr[i].keyCount; k++) e->tracks[i].keys[k] = tr[i].keys[k];
    uint16_t last = tr[i].keys[tr[i].keyCount - 1].tMs;
    if (last > e->durationMs) e->durationMs = last;
  }
}

// ---------------------------------------------------------------------------
// RNG + easing + sampling
// ---------------------------------------------------------------------------
static uint32_t xorshift32(uint32_t *s) {
  uint32_t x = *s;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  *s = x;
  return x;
}

// uniform in [lo, hi] inclusive
static uint32_t rng_range(face_engine_t *eng, uint32_t lo, uint32_t hi) {
  return lo + xorshift32(&eng->rng) % (hi - lo + 1u);
}

int32_t face_ease(uint8_t easing, int32_t t) {
  if (t < 0) t = 0;
  if (t > 65536) t = 65536;
  int64_t T = t;
  switch (easing) {
    default:
    case 0: return t;                                  // linear
    case 1: return (int32_t)((T * T) >> 16);           // easeInQuad
    case 2: {                                          // easeOutQuad
      int64_t u = 65536 - T;
      return (int32_t)(65536 - ((u * u) >> 16));
    }
    case 3: {                                          // easeInOutQuad
      if (T < 32768) return (int32_t)((2 * T * T) >> 16);
      int64_t u = 2 * (65536 - T);
      return (int32_t)(65536 - ((u * u) >> 17));
    }
    case 4: {                                          // easeOutBack (overshoots)
      const int64_t c1 = 111514; // 1.70158 in q16
      const int64_t c3 = c1 + 65536;
      int64_t x = T - 65536;             // [-65536, 0]
      int64_t x2 = (x * x) >> 16;
      int64_t x3 = (x2 * x) >> 16;
      return (int32_t)(65536 + ((c3 * x3) >> 16) + ((c1 * x2) >> 16));
    }
  }
}

static int16_t lerp16(int16_t a, int16_t b, int32_t eq16) {
  return (int16_t)(a + (int32_t)(((int64_t)(b - a) * eq16) >> 16));
}

int16_t face_track_sample(const face_track_t *tr, uint32_t tMs) {
  if (tr->keyCount == 0) return 0;
  if (tMs <= tr->keys[0].tMs) return tr->keys[0].value;
  for (int i = 0; i + 1 < tr->keyCount; i++) {
    const face_key_t *a = &tr->keys[i], *b = &tr->keys[i + 1];
    if (tMs < b->tMs) {
      uint32_t span = (uint32_t)(b->tMs - a->tMs);
      if (span == 0) return b->value;
      int32_t f = (int32_t)(((uint64_t)(tMs - a->tMs) << 16) / span);
      return lerp16(a->value, b->value, face_ease(a->easing, f));
    }
  }
  return tr->keys[tr->keyCount - 1].value;
}

static int16_t clamp16(int32_t v, int32_t lo, int32_t hi) {
  if (v < lo) v = lo;
  if (v > hi) v = hi;
  return (int16_t)v;
}

static uint8_t sat_add8(uint8_t v, int d) {
  int r = v + d;
  return (uint8_t)(r < 0 ? 0 : (r > 255 ? 255 : r));
}

// Sample the expression layer only (neutral base + current tracks + crossfade).
static void sample_expr_layer(const face_engine_t *eng, uint32_t nowMs, face_params_t *out) {
  const face_expr_t *e = &eng->exprs[eng->curExpr];
  uint32_t t = nowMs - eng->exprStartMs;
  if (t > e->durationMs) t = e->durationMs;
  *out = FACE_NEUTRAL_POSE;
  for (int i = 0; i < e->trackCount; i++) {
    const face_track_t *tr = &e->tracks[i];
    if (tr->paramId < FACE_PARAM_COUNT) out->v[tr->paramId] = face_track_sample(tr, t);
  }
  // crossfade from the pose captured at the last expression switch
  if (eng->blendDurMs) {
    uint32_t bt = nowMs - eng->blendStartMs;
    if (bt < eng->blendDurMs) {
      int32_t f = face_ease(2, (int32_t)(((uint64_t)bt << 16) / eng->blendDurMs));
      for (int p = 0; p < FACE_PARAM_COUNT; p++)
        out->v[p] = lerp16(eng->blendFrom.v[p], out->v[p], f);
    }
  }
}

// ---------------------------------------------------------------------------
// Schedulers
// ---------------------------------------------------------------------------
static uint32_t blink_interval(face_engine_t *eng) {
  // 2500..6500 ms base; low energy stretches it (up to +1020 ms)
  return rng_range(eng, 2500, 6500) + (uint32_t)(255 - eng->mood.energy) * 4u;
}

static uint16_t blink_duration(const face_engine_t *eng) {
  // 140 ms nominal; low energy => slower, heavier blinks (up to 200 ms)
  return (uint16_t)(140 + ((255 - eng->mood.energy) * 60) / 255);
}

// 0..256 lid closure overlay for the in-flight blink
static int16_t blink_amount(const face_engine_t *eng, uint32_t nowMs) {
  if (!eng->blinkActive) return 0;
  uint32_t t = nowMs - eng->blinkStartMs;
  uint32_t half = eng->blinkDurMs / 2u;
  if (half == 0 || t >= eng->blinkDurMs) return 0;
  uint32_t ph = (t < half) ? t : (eng->blinkDurMs - t); // triangle
  int32_t f = face_ease(2, (int32_t)(((uint64_t)ph << 16) / half));
  return (int16_t)((256 * (int64_t)f) >> 16);
}

static void pick_gaze(face_engine_t *eng, uint32_t nowMs) {
  eng->gazeFromX = eng->gazeX;
  eng->gazeFromY = eng->gazeY;
  // random target within +/-14 px (1/256 px units)
  eng->gazeToX = (int16_t)((int32_t)rng_range(eng, 0, 28 * 256) - 14 * 256);
  eng->gazeToY = (int16_t)((int32_t)rng_range(eng, 0, 28 * 256) - 14 * 256);
  eng->gazeStartMs = nowMs;
  eng->gazeTweenMs = (uint16_t)rng_range(eng, 300, 500);
  eng->nextGazeMs = nowMs + eng->gazeTweenMs + rng_range(eng, 3000, 8000);
}

static void mood_minute_step(face_engine_t *eng) {
  mood_t *m = &eng->mood;
  m->boredom = sat_add8(m->boredom, 6);
  m->attention = sat_add8(m->attention, -8);
  // happiness relaxes toward 128
  if (m->happiness > 128) m->happiness = sat_add8(m->happiness, m->happiness - 128 > 4 ? -4 : -(m->happiness - 128));
  else if (m->happiness < 128) m->happiness = sat_add8(m->happiness, 128 - m->happiness > 4 ? 4 : 128 - m->happiness);
  // energy follows a slow triangle wave (20 min period, 64..192)
  eng->energyPhaseMs += 60000u;
  uint32_t period = 1200000u, half = period / 2u;
  uint32_t ph = eng->energyPhaseMs % period;
  uint32_t tri = (ph < half) ? ph : (period - ph); // 0..half
  uint8_t target = (uint8_t)(64 + (tri * 128u) / half);
  int d = (int)target - (int)m->energy;
  if (d > 16) d = 16;
  if (d < -16) d = -16;
  m->energy = sat_add8(m->energy, d);
}

static face_expr_id_t pick_expression(face_engine_t *eng) {
  const mood_t *m = &eng->mood;
  uint32_t w[FACE_EXPR_COUNT];
  w[FACE_EXPR_NEUTRAL] = 20;
  w[FACE_EXPR_HAPPY] = 6 + m->happiness / 8;
  w[FACE_EXPR_SLEEPY] = 2 + m->boredom / 8 + (255 - m->energy) / 8;
  w[FACE_EXPR_ANGRY] = 2;
  w[FACE_EXPR_SURPRISED] = 2 + m->attention / 32;
  w[FACE_EXPR_SAD] = 2 + m->boredom / 16 + (255 - m->happiness) / 16;
  uint32_t total = 0;
  for (int i = 0; i < FACE_EXPR_COUNT; i++) total += w[i];
  uint32_t r = xorshift32(&eng->rng) % total;
  for (int i = 0; i < FACE_EXPR_COUNT; i++) {
    if (r < w[i]) return (face_expr_id_t)i;
    r -= w[i];
  }
  return FACE_EXPR_NEUTRAL;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
void face_engine_init(face_engine_t *eng, uint32_t rngSeed) {
  memset(eng, 0, sizeof(*eng));
  eng->rng = rngSeed ? rngSeed : 0xC0FFEE21u;
  memset(&eng->exprs[FACE_EXPR_NEUTRAL], 0, sizeof(face_expr_t)); // 0 tracks = neutral pose
  load_builtin(&eng->exprs[FACE_EXPR_HAPPY], k_happy, (int)(sizeof(k_happy) / sizeof(k_happy[0])));
  load_builtin(&eng->exprs[FACE_EXPR_SLEEPY], k_sleepy, (int)(sizeof(k_sleepy) / sizeof(k_sleepy[0])));
  load_builtin(&eng->exprs[FACE_EXPR_ANGRY], k_angry, (int)(sizeof(k_angry) / sizeof(k_angry[0])));
  load_builtin(&eng->exprs[FACE_EXPR_SURPRISED], k_surprised, (int)(sizeof(k_surprised) / sizeof(k_surprised[0])));
  load_builtin(&eng->exprs[FACE_EXPR_SAD], k_sad, (int)(sizeof(k_sad) / sizeof(k_sad[0])));
  eng->curExpr = FACE_EXPR_NEUTRAL;
  eng->mood.happiness = 150;
  eng->mood.energy = 180;
  eng->mood.boredom = 30;
  eng->mood.attention = 120;
  eng->autoExpr = 1;
}

void face_engine_set_expression(face_engine_t *eng, face_expr_id_t id) {
  if ((unsigned)id >= FACE_EXPR_COUNT) return;
  // capture current pose (expr layer only) so the switch crossfades cleanly
  sample_expr_layer(eng, eng->lastNowMs, &eng->blendFrom);
  eng->curExpr = (uint8_t)id;
  eng->exprStartMs = eng->lastNowMs;
  eng->blendStartMs = eng->lastNowMs;
  eng->blendDurMs = eng->started ? 220 : 0;
}

void face_engine_bump(face_engine_t *eng, face_event_t evt) {
  switch (evt) {
    case FACE_EVT_INTERACTION:
      eng->mood.attention = sat_add8(eng->mood.attention, 60);
      eng->mood.boredom = sat_add8(eng->mood.boredom, -40);
      eng->mood.happiness = sat_add8(eng->mood.happiness, 10);
      break;
    case FACE_EVT_NEW_ART:
      eng->mood.happiness = sat_add8(eng->mood.happiness, 40);
      eng->mood.attention = sat_add8(eng->mood.attention, 50);
      eng->mood.boredom = sat_add8(eng->mood.boredom, -60);
      eng->newArtChain = 1; // surprised now, happy on the (soon) next pick
      face_engine_set_expression(eng, FACE_EXPR_SURPRISED);
      eng->nextExprPickMs = eng->lastNowMs + 2500;
      break;
  }
}

void face_engine_update(face_engine_t *eng, uint32_t nowMs, face_params_t *out) {
  if (!eng->started) {
    eng->started = 1;
    eng->lastNowMs = nowMs;
    eng->exprStartMs = nowMs;
    eng->nextBlinkMs = nowMs + blink_interval(eng);
    eng->gazeStartMs = nowMs;
    eng->gazeTweenMs = 1;
    eng->nextGazeMs = nowMs + rng_range(eng, 3000, 8000);
    eng->nextExprPickMs = nowMs + rng_range(eng, 12000, 25000);
  }
  uint32_t dt = nowMs - eng->lastNowMs;

  // mood drift, applied in whole-minute steps
  eng->moodAccumMs += dt;
  while (eng->moodAccumMs >= 60000u) {
    eng->moodAccumMs -= 60000u;
    mood_minute_step(eng);
  }

  // mood-weighted expression scheduler
  if (eng->autoExpr && (int32_t)(nowMs - eng->nextExprPickMs) >= 0) {
    face_expr_id_t next;
    if (eng->newArtChain) {
      next = FACE_EXPR_HAPPY;
      eng->newArtChain = 0;
    } else {
      next = pick_expression(eng);
    }
    face_engine_set_expression(eng, next);
    eng->nextExprPickMs = nowMs + rng_range(eng, 12000, 25000);
  }

  // blink scheduler
  if (eng->blinkActive && nowMs - eng->blinkStartMs >= eng->blinkDurMs) {
    eng->blinkActive = 0;
    eng->nextBlinkMs = nowMs + blink_interval(eng);
  }
  if (!eng->blinkActive && (int32_t)(nowMs - eng->nextBlinkMs) >= 0) {
    eng->blinkActive = 1;
    eng->blinkStartMs = nowMs;
    eng->blinkDurMs = blink_duration(eng);
  }

  // idle gaze wander
  if ((int32_t)(nowMs - eng->nextGazeMs) >= 0) pick_gaze(eng, nowMs);
  {
    uint32_t gt = nowMs - eng->gazeStartMs;
    if (gt >= eng->gazeTweenMs) {
      eng->gazeX = eng->gazeToX;
      eng->gazeY = eng->gazeToY;
    } else {
      int32_t f = face_ease(2, (int32_t)(((uint64_t)gt << 16) / eng->gazeTweenMs));
      eng->gazeX = lerp16(eng->gazeFromX, eng->gazeToX, f);
      eng->gazeY = lerp16(eng->gazeFromY, eng->gazeToY, f);
    }
  }

  eng->lastNowMs = nowMs;

  // compose ------------------------------------------------------------------
  face_params_t p;
  sample_expr_layer(eng, nowMs, &p);
  // gaze offsets ADD to the expression pose
  p.v[FP_EYE_LX] = clamp16((int32_t)p.v[FP_EYE_LX] + eng->gazeX, -32768, 32767);
  p.v[FP_EYE_LY] = clamp16((int32_t)p.v[FP_EYE_LY] + eng->gazeY, -32768, 32767);
  p.v[FP_EYE_RX] = clamp16((int32_t)p.v[FP_EYE_RX] + eng->gazeX, -32768, 32767);
  p.v[FP_EYE_RY] = clamp16((int32_t)p.v[FP_EYE_RY] + eng->gazeY, -32768, 32767);
  // blink OVERLAYS the top lids (max of expression lids and blink closure)
  {
    int16_t b = blink_amount(eng, nowMs);
    if (b > p.v[FP_LID_TOP_L]) p.v[FP_LID_TOP_L] = b;
    if (b > p.v[FP_LID_TOP_R]) p.v[FP_LID_TOP_R] = b;
  }
  // sanity clamps (tracks may carry arbitrary data-driven values)
  p.v[FP_EYE_W] = clamp16(p.v[FP_EYE_W], 0, 32767);
  p.v[FP_EYE_H] = clamp16(p.v[FP_EYE_H], 0, 32767);
  p.v[FP_EYE_RADIUS] = clamp16(p.v[FP_EYE_RADIUS], 0, 32767);
  for (int i = FP_LID_TOP_L; i <= FP_LID_BOT_R; i++) p.v[i] = clamp16(p.v[i], 0, 256);
  p.v[FP_MOUTH_OPEN] = clamp16(p.v[FP_MOUTH_OPEN], 0, 256);
  p.v[FP_MOUTH_CURVE] = clamp16(p.v[FP_MOUTH_CURVE], -256, 256);
  p.v[FP_SQUASH] = clamp16(p.v[FP_SQUASH], 0, 256);
  *out = p;
}

// ---------------------------------------------------------------------------
// DPAK EXPR overrides (untrusted input — strict bounds checks)
// ---------------------------------------------------------------------------
static uint16_t rd16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }

int face_expr_parse(const uint8_t *blob, uint32_t len, face_expr_t *out) {
  if (!blob || len < 4) return -1;
  uint8_t trackCount = blob[0];
  if (trackCount > FACE_PARAM_COUNT) return -1;
  face_expr_t e;
  memset(&e, 0, sizeof(e));
  uint32_t off = 4;
  uint32_t seen = 0; // paramId bitmask — reject duplicate tracks
  for (uint8_t t = 0; t < trackCount; t++) {
    if (off + 4 > len) return -1;
    uint8_t paramId = blob[off], keyCount = blob[off + 1];
    off += 4;
    if (paramId >= FACE_PARAM_COUNT) return -1;
    if (keyCount < 1 || keyCount > FACE_MAX_KEYS) return -1;
    if (seen & (1u << paramId)) return -1;
    seen |= 1u << paramId;
    if (off + (uint32_t)keyCount * 6u > len) return -1;
    face_track_t *tr = &e.tracks[t];
    tr->paramId = paramId;
    tr->keyCount = keyCount;
    uint16_t prevT = 0;
    for (uint8_t k = 0; k < keyCount; k++) {
      const uint8_t *kp = blob + off + (uint32_t)k * 6u;
      tr->keys[k].tMs = rd16(kp);
      tr->keys[k].value = (int16_t)rd16(kp + 2);
      tr->keys[k].easing = kp[4];
      if (tr->keys[k].easing > 4) return -1;
      if (k > 0 && tr->keys[k].tMs < prevT) return -1; // keys must be time-ordered
      prevT = tr->keys[k].tMs;
      if (tr->keys[k].tMs > e.durationMs) e.durationMs = tr->keys[k].tMs;
    }
    off += (uint32_t)keyCount * 6u;
  }
  e.trackCount = trackCount;
  *out = e;
  return 0;
}

int face_engine_load_dpak(face_engine_t *eng, const dpak_t *pak) {
  static const char *names[FACE_EXPR_COUNT] = {
      "expr_neutral", "expr_happy", "expr_sleepy", "expr_angry", "expr_surprised", "expr_sad",
  };
  int loaded = 0;
  for (int i = 0; i < FACE_EXPR_COUNT; i++) {
    dpak_entry_t e;
    if (dpak_find(pak, dpak_fnv1a_str(names[i]), &e) != DPAK_OK) continue;
    if (e.type != DPAK_TYPE_EXPR) continue;
    face_expr_t parsed;
    if (face_expr_parse(e.blob, e.length, &parsed) != 0) continue; // keep built-in
    eng->exprs[i] = parsed;
    loaded++;
  }
  return loaded;
}
