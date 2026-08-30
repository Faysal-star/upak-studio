// Host-side (pio test -e native) unit tests for the Snake game core.
// The core is deterministic given a seeded RNG callback — these tests use a
// fixed LCG so food placement is reproducible.
#include <string.h>
#include <unity.h>

#include "snake_core.h"

static uint32_t g_rngState;
static uint32_t test_rng(void *ctx) {
  (void)ctx;
  g_rngState = g_rngState * 1664525u + 1013904223u;
  return g_rngState >> 8;
}

static snake_t s;

void setUp(void) {
  g_rngState = 0xC0FFEE42u;
  snake_init(&s, test_rng, NULL);
}
void tearDown(void) {}

// Feed the snake: put food directly in the head's path, tick, expect ATE.
static void force_feed(snake_dir_t d) {
  snake_cell_t h = snake_body(&s, 0);
  int fx = h.x, fy = h.y;
  switch (d) {
    case SNAKE_UP: fy--; break;
    case SNAKE_DOWN: fy++; break;
    case SNAKE_LEFT: fx--; break;
    default: fx++; break;
  }
  s.food.x = (uint8_t)fx;
  s.food.y = (uint8_t)fy;
  snake_set_dir(&s, d);
  TEST_ASSERT_EQUAL_INT(SNAKE_ATE, snake_tick(&s, NULL));
  // invariant after every seeded re-placement: in bounds, never on the snake
  TEST_ASSERT_TRUE(s.food.x < SNAKE_GRID_W && s.food.y < SNAKE_GRID_H);
  TEST_ASSERT_FALSE(snake_occupied(&s, s.food.x, s.food.y));
}

static void test_init_state(void) {
  TEST_ASSERT_EQUAL_UINT16(SNAKE_START_LEN, s.len);
  TEST_ASSERT_EQUAL_UINT16(0, s.score);
  TEST_ASSERT_EQUAL_UINT16(SNAKE_STEP_START_MS, s.stepMs);
  TEST_ASSERT_EQUAL_UINT8(1, s.alive);
  snake_cell_t h = snake_body(&s, 0);
  TEST_ASSERT_EQUAL_UINT8(SNAKE_GRID_W / 2, h.x);
  TEST_ASSERT_EQUAL_UINT8(SNAKE_GRID_H / 2, h.y);
  snake_cell_t t = snake_body(&s, SNAKE_START_LEN - 1);
  TEST_ASSERT_EQUAL_UINT8(SNAKE_GRID_W / 2 - (SNAKE_START_LEN - 1), t.x);
  // food placed inside the grid and never on the snake
  TEST_ASSERT_TRUE(s.food.x < SNAKE_GRID_W && s.food.y < SNAKE_GRID_H);
  TEST_ASSERT_FALSE(snake_occupied(&s, s.food.x, s.food.y));
}

static void test_moves_one_cell(void) {
  s.food.x = 0;  // out of the path — plain move
  s.food.y = 0;
  snake_step_t st;
  TEST_ASSERT_EQUAL_INT(SNAKE_MOVED, snake_tick(&s, &st));
  snake_cell_t h = snake_body(&s, 0);
  TEST_ASSERT_EQUAL_UINT8(SNAKE_GRID_W / 2 + 1, h.x);
  TEST_ASSERT_EQUAL_UINT8(SNAKE_GRID_H / 2, h.y);
  TEST_ASSERT_EQUAL_UINT16(SNAKE_START_LEN, s.len);  // no growth
  // dirty-rect contract: head added, tail removed, food untouched
  TEST_ASSERT_EQUAL_UINT8(1, st.tailRemoved);
  TEST_ASSERT_EQUAL_UINT8(SNAKE_GRID_W / 2 - (SNAKE_START_LEN - 1), st.oldTail.x);
  TEST_ASSERT_EQUAL_UINT8(0, st.foodMoved);
  TEST_ASSERT_FALSE(snake_occupied(&s, st.oldTail.x, st.oldTail.y));
}

static void test_turn_moves_vertically(void) {
  s.food.x = 0;
  s.food.y = 0;
  snake_set_dir(&s, SNAKE_UP);
  TEST_ASSERT_EQUAL_INT(SNAKE_MOVED, snake_tick(&s, NULL));
  snake_cell_t h = snake_body(&s, 0);
  TEST_ASSERT_EQUAL_UINT8(SNAKE_GRID_W / 2, h.x);
  TEST_ASSERT_EQUAL_UINT8(SNAKE_GRID_H / 2 - 1, h.y);
}

static void test_reversal_prevented(void) {
  s.food.x = 0;
  s.food.y = 14;
  snake_set_dir(&s, SNAKE_LEFT);  // moving right — must be ignored
  TEST_ASSERT_EQUAL_INT(SNAKE_MOVED, snake_tick(&s, NULL));
  snake_cell_t h = snake_body(&s, 0);
  TEST_ASSERT_EQUAL_UINT8(SNAKE_GRID_W / 2 + 1, h.x);  // still went right
  // a legal turn afterwards still works
  snake_set_dir(&s, SNAKE_DOWN);
  TEST_ASSERT_EQUAL_INT(SNAKE_MOVED, snake_tick(&s, NULL));
  TEST_ASSERT_EQUAL_UINT8(SNAKE_GRID_H / 2 + 1, snake_body(&s, 0).y);
}

static void test_eat_grows_and_speeds_up(void) {
  snake_step_t st;
  s.food.x = SNAKE_GRID_W / 2 + 1;  // directly in the path
  s.food.y = SNAKE_GRID_H / 2;
  TEST_ASSERT_EQUAL_INT(SNAKE_ATE, snake_tick(&s, &st));
  TEST_ASSERT_EQUAL_UINT16(SNAKE_START_LEN + 1, s.len);
  TEST_ASSERT_EQUAL_UINT16(1, s.score);
  TEST_ASSERT_EQUAL_UINT16(SNAKE_STEP_START_MS - SNAKE_STEP_DEC_MS, s.stepMs);
  TEST_ASSERT_EQUAL_UINT8(0, st.tailRemoved);  // grew: tail stayed put
  TEST_ASSERT_EQUAL_UINT8(1, st.foodMoved);
  TEST_ASSERT_FALSE(snake_occupied(&s, st.food.x, st.food.y));
}

static void test_edge_wrap(void) {
  s.food.x = 0;
  s.food.y = 0;
  // head starts at x=7 heading right; x reaches 14 in 7 moves, move 8 wraps to x=0
  for (int i = 0; i < 7; i++) TEST_ASSERT_EQUAL_INT(SNAKE_MOVED, snake_tick(&s, NULL));
  TEST_ASSERT_EQUAL_UINT8(SNAKE_GRID_W - 1, snake_body(&s, 0).x);
  snake_step_t st;
  TEST_ASSERT_EQUAL_INT(SNAKE_MOVED, snake_tick(&s, &st));
  TEST_ASSERT_EQUAL_UINT8(0, st.newHead.x);
  TEST_ASSERT_EQUAL_UINT8(SNAKE_GRID_H / 2, st.newHead.y);
  TEST_ASSERT_EQUAL_UINT8(1, s.alive);
  // wrap vertically too: head up from y=cy crosses y=0 -> y=GRID_H-1
  s.food.x = 10;  // off the snake's path (it will climb x=0 through (0,0))
  s.food.y = 10;
  snake_set_dir(&s, SNAKE_UP);
  for (int i = 0; i < SNAKE_GRID_H / 2; i++) TEST_ASSERT_EQUAL_INT(SNAKE_MOVED, snake_tick(&s, NULL));
  TEST_ASSERT_EQUAL_UINT8(0, snake_body(&s, 0).y);
  TEST_ASSERT_EQUAL_INT(SNAKE_MOVED, snake_tick(&s, &st));
  TEST_ASSERT_EQUAL_UINT8(SNAKE_GRID_H - 1, st.newHead.y);
  TEST_ASSERT_EQUAL_UINT8(1, s.alive);
}

static void test_self_collision_death(void) {
  // grow to length 5, then U-turn into the body: right, up, left, down
  force_feed(SNAKE_RIGHT);
  force_feed(SNAKE_RIGHT);
  TEST_ASSERT_EQUAL_UINT16(5, s.len);
  s.food.x = 0;
  s.food.y = 0;
  snake_set_dir(&s, SNAKE_UP);
  TEST_ASSERT_EQUAL_INT(SNAKE_MOVED, snake_tick(&s, NULL));
  snake_set_dir(&s, SNAKE_LEFT);
  TEST_ASSERT_EQUAL_INT(SNAKE_MOVED, snake_tick(&s, NULL));
  snake_set_dir(&s, SNAKE_DOWN);  // straight into the body
  TEST_ASSERT_EQUAL_INT(SNAKE_DIED, snake_tick(&s, NULL));
  TEST_ASSERT_EQUAL_UINT8(0, s.alive);
}

static void test_moving_into_departing_tail_is_legal(void) {
  // Hand-built 2x2 loop, head (7,7), tail (7,8) directly below. Last executed
  // move was LEFT (from (8,7) onto (7,7)); moving DOWN enters the tail cell,
  // which the tail vacates this same step — classic snake allows it.
  memset(&s, 0, sizeof(s));
  s.rng = test_rng;
  s.alive = 1;
  s.stepMs = SNAKE_STEP_START_MS;
  s.len = 4;
  s.head = 3;
  const uint8_t px[4] = {7, 8, 8, 7};  // tail -> head
  const uint8_t py[4] = {8, 8, 7, 7};
  for (int i = 0; i < 4; i++) {
    s.cells[i].x = px[i];
    s.cells[i].y = py[i];
    s.occ[py[i] * SNAKE_GRID_W + px[i]] = 1;
  }
  s.dir = SNAKE_LEFT;
  s.pending = SNAKE_LEFT;
  s.food.x = 0;
  s.food.y = 0;
  snake_set_dir(&s, SNAKE_DOWN);
  TEST_ASSERT_EQUAL_INT(SNAKE_MOVED, snake_tick(&s, NULL));
  snake_cell_t h = snake_body(&s, 0);
  TEST_ASSERT_EQUAL_UINT8(7, h.x);
  TEST_ASSERT_EQUAL_UINT8(8, h.y);
}

// Serpentine forced-feed run: grows the snake to ~40 cells. After every eat,
// the (seeded) placement must land in bounds and off the snake.
static void serpentine_feed(void) {
  for (int i = 0; i < 7; i++) force_feed(SNAKE_RIGHT);  // row 7: x 8..14
  force_feed(SNAKE_DOWN);                               // to row 8
  for (int i = 0; i < 14; i++) force_feed(SNAKE_LEFT);  // row 8: x 13..0
  force_feed(SNAKE_DOWN);                               // to row 9
  for (int i = 0; i < 14; i++) force_feed(SNAKE_RIGHT); // row 9: x 1..14
}

static void test_food_never_on_snake_seeded(void) {
  // force_feed itself asserts the placement invariant after every eat:
  // 37 seeded placements during the serpentine, then 30 more against a snake
  // covering ~30% of the board (head ends at (14,9), rows 10-11 are free).
  serpentine_feed();
  TEST_ASSERT_EQUAL_UINT16(SNAKE_START_LEN + 37, s.len);
  force_feed(SNAKE_DOWN);                               // to row 10
  for (int i = 0; i < 14; i++) force_feed(SNAKE_LEFT);  // row 10: x 13..0
  force_feed(SNAKE_DOWN);                               // to row 11
  for (int i = 0; i < 14; i++) force_feed(SNAKE_RIGHT); // row 11: x 1..14
  TEST_ASSERT_EQUAL_UINT16(SNAKE_START_LEN + 67, s.len);
}

static void test_speed_floor(void) {
  serpentine_feed();  // 37 foods: 280 - 8*37 = -16 -> clamped at 90
  TEST_ASSERT_EQUAL_UINT16(37, s.score);
  TEST_ASSERT_EQUAL_UINT16(SNAKE_STEP_FLOOR_MS, s.stepMs);
}

static void test_ring_buffer_wrap_long_snake(void) {
  // Head index parked near the end of the ring: two ticks walk it across the
  // 224 -> 0 boundary. Body must stay contiguous and correctly ordered.
  memset(&s, 0, sizeof(s));
  s.rng = test_rng;
  s.alive = 1;
  s.stepMs = SNAKE_STEP_START_MS;
  s.len = 5;
  s.head = SNAKE_MAX_CELLS - 2;  // 223
  for (int i = 0; i < 5; i++) {
    uint16_t idx = (uint16_t)(SNAKE_MAX_CELLS - 6 + i);  // 219..223
    uint8_t x = (uint8_t)(6 + i);                        // tail (6,0) .. head (10,0)
    s.cells[idx].x = x;
    s.cells[idx].y = 0;
    s.occ[0 * SNAKE_GRID_W + x] = 1;
  }
  s.dir = SNAKE_RIGHT;
  s.pending = SNAKE_RIGHT;
  s.food.x = 0;
  s.food.y = 14;
  TEST_ASSERT_EQUAL_INT(SNAKE_MOVED, snake_tick(&s, NULL));  // head -> ring 224
  TEST_ASSERT_EQUAL_INT(SNAKE_MOVED, snake_tick(&s, NULL));  // head -> ring 0 (wrap)
  TEST_ASSERT_EQUAL_UINT16(0, s.head);
  TEST_ASSERT_EQUAL_UINT16(5, s.len);
  for (int i = 0; i < 5; i++) {
    snake_cell_t c = snake_body(&s, (uint16_t)i);
    TEST_ASSERT_EQUAL_UINT8((uint8_t)(12 - i), c.x);  // head (12,0) back to (8,0)
    TEST_ASSERT_EQUAL_UINT8(0, c.y);
  }
  TEST_ASSERT_TRUE(snake_occupied(&s, 12, 0));
  TEST_ASSERT_FALSE(snake_occupied(&s, 7, 0));  // vacated by the tail
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_init_state);
  RUN_TEST(test_moves_one_cell);
  RUN_TEST(test_turn_moves_vertically);
  RUN_TEST(test_reversal_prevented);
  RUN_TEST(test_eat_grows_and_speeds_up);
  RUN_TEST(test_edge_wrap);
  RUN_TEST(test_self_collision_death);
  RUN_TEST(test_moving_into_departing_tail_is_legal);
  RUN_TEST(test_food_never_on_snake_seeded);
  RUN_TEST(test_speed_floor);
  RUN_TEST(test_ring_buffer_wrap_long_snake);
  return UNITY_END();
}
