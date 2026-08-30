// DeskPet procedural face engine — pure C99, no Arduino/IDF dependencies.
// Composes, per tick: expression keyframe tracks (built-in or DPAK EXPR
// overrides) + autonomous blink + idle gaze wander + mood-driven expression
// scheduling, into one face_params_t pose. Deterministic given (seed, nowMs
// sequence): internal xorshift RNG, integer math only, no allocation.
#ifndef FACE_ENGINE_H
#define FACE_ENGINE_H

#include <stdint.h>

#include "face_params.h"

#ifdef __cplusplus
extern "C" {
#endif

#include "dpak.h"

// ---- expressions -----------------------------------------------------------

typedef enum {
  FACE_EXPR_NEUTRAL = 0,
  FACE_EXPR_HAPPY,
  FACE_EXPR_SLEEPY,
  FACE_EXPR_ANGRY,
  FACE_EXPR_SURPRISED,
  FACE_EXPR_SAD,
  FACE_EXPR_COUNT
} face_expr_id_t;

typedef enum {
  FACE_EVT_INTERACTION = 0, // user touched/talked to the pet
  FACE_EVT_NEW_ART = 1,     // fresh art uploaded -> surprised, then happy
} face_event_t;

// Same data shape as a DPAK EXPR track (asset-format-dpak.md): a track "plays"
// its keys over the expression duration, then HOLDS its final value.
// The easing on key k shapes the segment k -> k+1 (last key's easing unused).
#define FACE_MAX_KEYS 8

typedef struct {
  uint16_t tMs;
  int16_t value;
  uint8_t easing; // 0=linear 1=easeInQuad 2=easeOutQuad 3=easeInOutQuad 4=easeOutBack
} face_key_t;

typedef struct {
  uint8_t paramId; // FP_*
  uint8_t keyCount;
  face_key_t keys[FACE_MAX_KEYS];
} face_track_t;

typedef struct {
  uint8_t trackCount;          // at most one track per param
  uint16_t durationMs;         // max key tMs across tracks
  face_track_t tracks[FACE_PARAM_COUNT];
} face_expr_t;

// ---- mood ------------------------------------------------------------------

typedef struct {
  uint8_t happiness, energy, boredom, attention;
} mood_t;

// ---- engine ----------------------------------------------------------------

typedef struct {
  uint32_t rng;

  face_expr_t exprs[FACE_EXPR_COUNT]; // built-ins, possibly DPAK-overridden

  // current expression playback
  uint8_t curExpr;
  uint32_t exprStartMs;
  // crossfade from the previous expression pose (prevents pops on switch)
  face_params_t blendFrom;
  uint32_t blendStartMs;
  uint16_t blendDurMs;

  // blink scheduler
  uint32_t nextBlinkMs;
  uint32_t blinkStartMs;
  uint16_t blinkDurMs;
  uint8_t blinkActive;

  // idle gaze wander (offsets ADD to the expression pose, 1/256 px)
  uint32_t nextGazeMs;
  uint32_t gazeStartMs;
  uint16_t gazeTweenMs;
  int16_t gazeFromX, gazeFromY, gazeToX, gazeToY;
  int16_t gazeX, gazeY; // current composed offset

  // mood
  mood_t mood;
  uint32_t moodAccumMs;   // ms accumulated toward the next per-minute drift step
  uint32_t energyPhaseMs; // slow energy wave phase
  uint32_t nextExprPickMs;
  uint8_t newArtChain; // 2 = show surprised, 1 = happy follow-up pending, 0 = idle

  uint8_t autoExpr; // 1 (default): mood scheduler picks expressions; 0: manual only
  uint8_t started;  // first update() seen (schedules are seeded from its nowMs)
  uint32_t lastNowMs;
} face_engine_t;

void face_engine_init(face_engine_t *eng, uint32_t rngSeed);

// Advance everything to nowMs and write the fully composed pose to out.
// nowMs must be monotonically non-decreasing (wall-clock millis()).
void face_engine_update(face_engine_t *eng, uint32_t nowMs, face_params_t *out);

// Manually trigger an expression (also used internally by the scheduler).
void face_engine_set_expression(face_engine_t *eng, face_expr_id_t id);

// Mood event hooks.
void face_engine_bump(face_engine_t *eng, face_event_t evt);

// Override built-in expressions from EXPR assets named "expr_neutral",
// "expr_happy", "expr_sleepy", "expr_angry", "expr_surprised", "expr_sad"
// (FNV-1a name hashes). Missing assets keep their built-ins. Blobs are parsed
// strictly with bounds checks (untrusted input); a malformed blob leaves that
// expression's built-in intact. Returns the number of expressions overridden.
int face_engine_load_dpak(face_engine_t *eng, const dpak_t *pak);

// Parse one EXPR blob into out. Returns 0 on success, -1 on malformed input.
// Exposed for tests; face_engine_load_dpak uses it internally.
int face_expr_parse(const uint8_t *blob, uint32_t len, face_expr_t *out);

// The neutral base pose (params not covered by a track sample from this).
extern const face_params_t FACE_NEUTRAL_POSE;

// Easing evaluator, q16: t in [0,65536] -> eased fraction in q16
// (easeOutBack may exceed 65536). Exposed for tests.
int32_t face_ease(uint8_t easing, int32_t t);

// Sample one track at t ms (clamps before first / after last key). For tests.
int16_t face_track_sample(const face_track_t *tr, uint32_t tMs);

#ifdef __cplusplus
}
#endif
#endif // FACE_ENGINE_H
