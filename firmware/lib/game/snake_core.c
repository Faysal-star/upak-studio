// DeskPet Snake core — see snake_core.h for the contract.
#include "snake_core.h"

#include <string.h>

static uint16_t tail_index(const snake_t *s) {
  return (uint16_t)((s->head + SNAKE_MAX_CELLS - (s->len - 1)) % SNAKE_MAX_CELLS);
}

// Uniform pick among the free cells (never on the snake). With a full board
// there is nothing to place — food parks off-grid (0xff) and the game is,
// by definition, already won at 225 cells.
static void place_food(snake_t *s) {
  uint16_t freeCells = (uint16_t)(SNAKE_MAX_CELLS - s->len);
  if (freeCells == 0) {
    s->food.x = 0xff;
    s->food.y = 0xff;
    return;
  }
  uint32_t r = s->rng ? (s->rng(s->rngCtx) % freeCells) : 0;
  for (int i = 0; i < SNAKE_MAX_CELLS; i++) {
    if (s->occ[i]) continue;
    if (r == 0) {
      s->food.x = (uint8_t)(i % SNAKE_GRID_W);
      s->food.y = (uint8_t)(i / SNAKE_GRID_W);
      return;
    }
    r--;
  }
}

void snake_init(snake_t *s, snake_rng_fn rng, void *rngCtx) {
  memset(s, 0, sizeof(*s));
  s->rng = rng;
  s->rngCtx = rngCtx;
  s->dir = SNAKE_RIGHT;
  s->pending = SNAKE_RIGHT;
  s->stepMs = SNAKE_STEP_START_MS;
  s->alive = 1;
  s->len = SNAKE_START_LEN;
  s->head = SNAKE_START_LEN - 1;
  const uint8_t cy = SNAKE_GRID_H / 2;
  const uint8_t headX = SNAKE_GRID_W / 2;  // head at center, body to the left
  for (uint16_t i = 0; i < SNAKE_START_LEN; i++) {
    uint8_t x = (uint8_t)(headX - (SNAKE_START_LEN - 1) + i);
    s->cells[i].x = x;
    s->cells[i].y = cy;
    s->occ[cy * SNAKE_GRID_W + x] = 1;
  }
  place_food(s);
}

void snake_set_dir(snake_t *s, snake_dir_t d) {
  snake_dir_t opposite;
  switch (s->dir) {
    case SNAKE_UP: opposite = SNAKE_DOWN; break;
    case SNAKE_DOWN: opposite = SNAKE_UP; break;
    case SNAKE_LEFT: opposite = SNAKE_RIGHT; break;
    default: opposite = SNAKE_LEFT; break;
  }
  if (d == opposite) return;  // reversal would be instant self-collision
  s->pending = d;
}

snake_event_t snake_tick(snake_t *s, snake_step_t *out) {
  if (out) memset(out, 0, sizeof(*out));
  if (out) out->food = s->food;
  if (!s->alive) return SNAKE_DIED;

  s->dir = s->pending;
  snake_cell_t h = s->cells[s->head];
  int nx = h.x, ny = h.y;
  switch (s->dir) {
    case SNAKE_UP: ny--; break;
    case SNAKE_DOWN: ny++; break;
    case SNAKE_LEFT: nx--; break;
    default: nx++; break;
  }

  // Edges wrap — the board is a torus; only self-collision kills.
  nx = (nx + SNAKE_GRID_W) % SNAKE_GRID_W;
  ny = (ny + SNAKE_GRID_H) % SNAKE_GRID_H;

  int eating = (nx == s->food.x && ny == s->food.y);

  // The tail vacates its cell this same step (unless growing), so moving into
  // it is legal — free it before the self-collision check.
  if (!eating) {
    uint16_t ti = tail_index(s);
    snake_cell_t t = s->cells[ti];
    s->occ[t.y * SNAKE_GRID_W + t.x] = 0;
    s->len--;
    if (out) {
      out->oldTail = t;
      out->tailRemoved = 1;
    }
  }

  if (s->occ[ny * SNAKE_GRID_W + nx]) {
    s->alive = 0;  // bit itself
    return SNAKE_DIED;
  }

  s->head = (uint16_t)((s->head + 1) % SNAKE_MAX_CELLS);
  s->cells[s->head].x = (uint8_t)nx;
  s->cells[s->head].y = (uint8_t)ny;
  s->occ[ny * SNAKE_GRID_W + nx] = 1;
  s->len++;
  if (out) out->newHead = s->cells[s->head];

  if (eating) {
    s->score++;
    s->stepMs = (uint16_t)(s->stepMs > SNAKE_STEP_FLOOR_MS + SNAKE_STEP_DEC_MS
                               ? s->stepMs - SNAKE_STEP_DEC_MS
                               : SNAKE_STEP_FLOOR_MS);
    place_food(s);
    if (out) {
      out->food = s->food;
      out->foodMoved = 1;
    }
    return SNAKE_ATE;
  }
  return SNAKE_MOVED;
}

snake_cell_t snake_body(const snake_t *s, uint16_t i) {
  uint16_t idx = (uint16_t)((s->head + SNAKE_MAX_CELLS - i) % SNAKE_MAX_CELLS);
  return s->cells[idx];
}

int snake_occupied(const snake_t *s, int x, int y) {
  if (x < 0 || y < 0 || x >= SNAKE_GRID_W || y >= SNAKE_GRID_H) return 0;
  return s->occ[y * SNAKE_GRID_W + x] ? 1 : 0;
}
