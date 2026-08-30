// DeskPet Snake — pure C99 game core, no Arduino/IDF dependencies.
// Deterministic given a seeded RNG callback: fixed 15x15 grid (16 px cells on
// the 240x240 panel), snake stored as a ring buffer of cells + an occupancy
// grid for O(1) collision/food checks. Edges wrap (torus board); only
// self-collision kills. The scene
// glue (src/game_scene.cpp) owns all timing and rendering; this core only
// advances one step per snake_tick() call.
#ifndef SNAKE_CORE_H
#define SNAKE_CORE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define SNAKE_GRID_W 15
#define SNAKE_GRID_H 15
#define SNAKE_CELL_PX 16
#define SNAKE_MAX_CELLS (SNAKE_GRID_W * SNAKE_GRID_H)  /* 225 */

#define SNAKE_START_LEN 3
#define SNAKE_STEP_START_MS 280  /* speed curve: start slow ... */
#define SNAKE_STEP_DEC_MS 8      /* ... -8 ms per food ...     */
#define SNAKE_STEP_FLOOR_MS 90   /* ... down to this floor     */

typedef enum { SNAKE_UP = 0, SNAKE_DOWN, SNAKE_LEFT, SNAKE_RIGHT } snake_dir_t;
typedef enum { SNAKE_MOVED = 0, SNAKE_ATE, SNAKE_DIED } snake_event_t;

typedef struct { uint8_t x, y; } snake_cell_t;

// RNG callback (any 32-bit generator; the core takes % over free cells).
typedef uint32_t (*snake_rng_fn)(void *ctx);

typedef struct {
  snake_cell_t cells[SNAKE_MAX_CELLS];  // ring buffer, tail..head
  uint16_t head;                        // ring index of the head cell
  uint16_t len;
  uint8_t occ[SNAKE_MAX_CELLS];         // 1 = cell occupied by the snake
  snake_dir_t dir;      // direction of the last executed step
  snake_dir_t pending;  // direction to apply on the next tick
  snake_cell_t food;
  uint16_t score;
  uint16_t stepMs;      // current ms-per-step (speed curve)
  uint8_t alive;
  snake_rng_fn rng;
  void *rngCtx;
} snake_t;

// What changed during one tick — everything a dirty-rect renderer needs.
typedef struct {
  snake_cell_t newHead;
  snake_cell_t oldTail;   // valid iff tailRemoved (cell to repaint as bg)
  uint8_t tailRemoved;    // 0 when the snake grew this tick
  snake_cell_t food;      // current food cell
  uint8_t foodMoved;      // 1 iff food was re-placed this tick (i.e. ATE)
} snake_step_t;

// Snake of SNAKE_START_LEN heading right from the grid center; food placed
// via rng (never on the snake).
void snake_init(snake_t *s, snake_rng_fn rng, void *rngCtx);

// Queue a direction for the next tick. A direct reversal (vs the last
// executed step) is ignored. Note: checked against the executed direction,
// not the pending one — two quick presses within one step keep the last
// non-reversing press (classic, lean behavior).
void snake_set_dir(snake_t *s, snake_dir_t d);

// Advance one step. Moving into the departing tail cell is allowed (the tail
// vacates it this same step). On SNAKE_DIED the snake stops (further ticks
// keep returning SNAKE_DIED); out is still filled with the last known state.
snake_event_t snake_tick(snake_t *s, snake_step_t *out /* may be NULL */);

// i-th body cell from the head (0 = head, len-1 = tail).
snake_cell_t snake_body(const snake_t *s, uint16_t i);

// 1 if (x,y) is on the snake, 0 otherwise (also 0 out of bounds).
int snake_occupied(const snake_t *s, int x, int y);

#ifdef __cplusplus
}
#endif
#endif  // SNAKE_CORE_H
