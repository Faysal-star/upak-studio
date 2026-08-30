// MODE_GAME — Snake on the pet's screen. Doubles as the partial-update
// capability test for the graphics stack: full-screen redraw once on entry,
// then every tick pushes ONLY the changed 16x16 cells (new head, recolored
// old head, vacated tail, food) plus the score/FPS overlay sprites.
//
// DPAK-UPLOAD mid-game: the upload handler in main.cpp blocks the loop for the
// whole transfer. Game timing tolerates that gracefully — a stall longer than
// one step+500 ms resyncs the step clock instead of replaying missed steps, so
// the snake resumes where it was (no burst of moves, no unfair death). On a
// SUCCESSFUL upload main.cpp switches to sticker mode anyway (existing
// behavior, kept); a failed/aborted upload returns to the game seamlessly.
#include "game_scene.h"

#include <Arduino.h>
#define LGFX_USE_V1
#include <LovyanGFX.hpp>

extern "C" {
#include "face_render.h"  // face_style_default — the game reuses the pet's palette
#include "snake_core.h"
}

static lgfx::LGFX_Device* g_lcd = nullptr;
static LGFX_Sprite* g_fpsSpr = nullptr;
static LGFX_Sprite g_scoreSpr;
static uint16_t* g_fb = nullptr;

static constexpr int SCR_W = SNAKE_GRID_W * SNAKE_CELL_PX;  // 240
static constexpr int SCR_H = SNAKE_GRID_H * SNAKE_CELL_PX;  // 240
static constexpr int BORDER_PX = 2;        // edges wrap — tint them as "portals"
static constexpr uint32_t QUIT_HOLD_MS = 1500;
static constexpr uint32_t GAMEOVER_SHOW_MS = 3000;
static constexpr uint32_t STALL_RESYNC_MS = 500;  // gap tolerance beyond stepMs

// Palette: snake in the face's cyan, food in its warm mouth orange, background
// a subtle checkerboard around the face's dark blue-grey.
static uint16_t COL_SNAKE, COL_FOOD, COL_BG_A;
static constexpr uint16_t COL_BG_B = 0x18E3;    // checker partner (a notch lighter)
static constexpr uint16_t COL_HEAD = 0x87FF;    // bright cyan head
static constexpr uint16_t COL_BORDER = 0x1A7A;  // dim cyan portal edge (wrap-around)

static snake_t g_snake;
static uint32_t g_lastStepMs = 0;
static uint32_t g_deadAtMs = 0;
static bool g_gameOver = false;

static uint32_t rngCb(void*) { return esp_random(); }

// ---------------------------------------------------------------------------
// frame-buffer drawing + dirty-rect push
// ---------------------------------------------------------------------------
static inline uint16_t bgPixel(int px, int py) {
  if (px < BORDER_PX || py < BORDER_PX || px >= SCR_W - BORDER_PX || py >= SCR_H - BORDER_PX)
    return COL_BORDER;
  return (((px / SNAKE_CELL_PX) + (py / SNAKE_CELL_PX)) & 1) ? COL_BG_B : COL_BG_A;
}

static void drawCellBg(int cx, int cy) {
  int x0 = cx * SNAKE_CELL_PX, y0 = cy * SNAKE_CELL_PX;
  for (int y = 0; y < SNAKE_CELL_PX; y++)
    for (int x = 0; x < SNAKE_CELL_PX; x++)
      g_fb[(size_t)(y0 + y) * SCR_W + x0 + x] = bgPixel(x0 + x, y0 + y);
}

// Snake cell: 1 px background inset so segments read as separate links.
static void drawSnakeCell(int cx, int cy, uint16_t color) {
  drawCellBg(cx, cy);
  int x0 = cx * SNAKE_CELL_PX, y0 = cy * SNAKE_CELL_PX;
  for (int y = 1; y < SNAKE_CELL_PX - 1; y++)
    for (int x = 1; x < SNAKE_CELL_PX - 1; x++)
      g_fb[(size_t)(y0 + y) * SCR_W + x0 + x] = color;
}

// Food: 8x8 warm square centered in its cell (corners nipped -> "berry").
static void drawFoodCell(int cx, int cy) {
  drawCellBg(cx, cy);
  int x0 = cx * SNAKE_CELL_PX + 4, y0 = cy * SNAKE_CELL_PX + 4;
  for (int y = 0; y < 8; y++)
    for (int x = 0; x < 8; x++) {
      bool corner = (x == 0 || x == 7) && (y == 0 || y == 7);
      if (!corner) g_fb[(size_t)(y0 + y) * SCR_W + x0 + x] = COL_FOOD;
    }
}

// Push a frame-buffer region to the panel (caller wraps in start/endWrite).
static void pushRect(int x, int y, int w, int h) {
  g_lcd->setWindow(x, y, x + w - 1, y + h - 1);
  for (int yy = y; yy < y + h; yy++)
    g_lcd->writePixels((const lgfx::rgb565_t*)&g_fb[(size_t)yy * SCR_W + x], w);
}

static void pushCell(int cx, int cy) {
  pushRect(cx * SNAKE_CELL_PX, cy * SNAKE_CELL_PX, SNAKE_CELL_PX, SNAKE_CELL_PX);
}

static void updateScoreSprite() {
  g_scoreSpr.fillSprite(TFT_BLACK);
  g_scoreSpr.setCursor(2, 3);
  g_scoreSpr.printf("SCORE %u", (unsigned)g_snake.score);
}

static void pushOverlays() {
  if (g_fpsSpr) g_fpsSpr->pushSprite(2, 2);
  // g_scoreSpr is default-constructed (no parent) — must push with an explicit
  // destination; parentless pushSprite(x, y) dereferences a null parent.
  g_scoreSpr.pushSprite(g_lcd, SCR_W - g_scoreSpr.width() - 2, 2);
}

// ---------------------------------------------------------------------------
// scene lifecycle
// ---------------------------------------------------------------------------
void gameSceneInit(lgfx::LGFX_Device* lcd, LGFX_Sprite* fpsSpr, uint16_t* frameBuf) {
  g_lcd = lcd;
  g_fpsSpr = fpsSpr;
  g_fb = frameBuf;
  face_style_t st;
  face_style_default(&st);
  COL_SNAKE = st.eye;    // DeskPet cyan
  COL_FOOD = st.mouth;   // warm orange
  COL_BG_A = st.bg;      // dark blue-grey
  g_scoreSpr.setPsram(false);
  g_scoreSpr.setColorDepth(16);
  g_scoreSpr.createSprite(78, 14);
  g_scoreSpr.setTextColor(TFT_WHITE, TFT_BLACK);
}

void gameSceneEnter(uint32_t nowMs) {
  snake_init(&g_snake, rngCb, nullptr);
  g_lastStepMs = nowMs;
  g_gameOver = false;

  // Full redraw, exactly once per entry: board, snake, food -> one big push.
  for (int cy = 0; cy < SNAKE_GRID_H; cy++)
    for (int cx = 0; cx < SNAKE_GRID_W; cx++) drawCellBg(cx, cy);
  for (uint16_t i = 1; i < g_snake.len; i++) {
    snake_cell_t c = snake_body(&g_snake, i);
    drawSnakeCell(c.x, c.y, COL_SNAKE);
  }
  snake_cell_t h = snake_body(&g_snake, 0);
  drawSnakeCell(h.x, h.y, COL_HEAD);
  drawFoodCell(g_snake.food.x, g_snake.food.y);
  updateScoreSprite();

  g_lcd->startWrite();
  pushRect(0, 0, SCR_W, SCR_H);
  pushOverlays();
  g_lcd->endWrite();
}

static void showGameOver(uint32_t nowMs) {
  g_gameOver = true;
  g_deadAtMs = nowMs;
  g_lcd->fillScreen(TFT_WHITE);  // quick death flash
  delay(70);
  g_lcd->fillScreen(TFT_BLACK);
  g_lcd->setTextColor(TFT_WHITE, TFT_BLACK);
  g_lcd->setTextDatum(lgfx::middle_center);
  g_lcd->drawString("GAME OVER", 120, 100);
  char buf[24];
  snprintf(buf, sizeof(buf), "score %u", (unsigned)g_snake.score);
  g_lcd->drawString(buf, 120, 124);
}

GameResult gameSceneLoop(uint32_t nowMs, uint8_t btnEdges, uint32_t btnHeldMs,
                         int* scoreOut, bool* drewFrame) {
  *drewFrame = false;
  *scoreOut = g_snake.score;

  if (btnHeldMs >= QUIT_HOLD_MS)  // hold any button to leave, any time
    return g_gameOver ? GAME_EXIT_PLAYED : GAME_EXIT_QUIT;

  if (g_gameOver) {
    if (nowMs - g_deadAtMs >= GAMEOVER_SHOW_MS) return GAME_EXIT_PLAYED;
    delay(5);
    return GAME_RUNNING;
  }

  if (btnEdges & GAME_BTN_UP) snake_set_dir(&g_snake, SNAKE_UP);
  if (btnEdges & GAME_BTN_DOWN) snake_set_dir(&g_snake, SNAKE_DOWN);
  if (btnEdges & GAME_BTN_LEFT) snake_set_dir(&g_snake, SNAKE_LEFT);
  if (btnEdges & GAME_BTN_RIGHT) snake_set_dir(&g_snake, SNAKE_RIGHT);

  if (nowMs - g_lastStepMs < g_snake.stepMs) {
    delay(1);
    return GAME_RUNNING;
  }
  // Stall tolerance (e.g. a blocking DPAK upload): resync instead of a burst
  // of catch-up steps — the game resumes exactly where it paused.
  if (nowMs - g_lastStepMs > (uint32_t)g_snake.stepMs + STALL_RESYNC_MS)
    g_lastStepMs = nowMs;
  else
    g_lastStepMs += g_snake.stepMs;

  snake_cell_t prevHead = snake_body(&g_snake, 0);
  snake_step_t st;
  snake_event_t ev = snake_tick(&g_snake, &st);

  if (ev == SNAKE_DIED) {
    showGameOver(nowMs);
    *scoreOut = g_snake.score;
    return GAME_RUNNING;  // score screen runs its 3 s, then GAME_EXIT_PLAYED
  }

  // Dirty cells only: old head -> body color, new head, vacated tail, food.
  drawSnakeCell(prevHead.x, prevHead.y, COL_SNAKE);
  drawSnakeCell(st.newHead.x, st.newHead.y, COL_HEAD);
  if (st.tailRemoved) drawCellBg(st.oldTail.x, st.oldTail.y);
  if (st.foodMoved && st.food.x < SNAKE_GRID_W) drawFoodCell(st.food.x, st.food.y);
  if (ev == SNAKE_ATE) updateScoreSprite();

  g_lcd->startWrite();
  pushCell(prevHead.x, prevHead.y);
  pushCell(st.newHead.x, st.newHead.y);
  if (st.tailRemoved) pushCell(st.oldTail.x, st.oldTail.y);
  if (st.foodMoved && st.food.x < SNAKE_GRID_W) pushCell(st.food.x, st.food.y);
  pushOverlays();
  g_lcd->endWrite();

  *drewFrame = true;
  *scoreOut = g_snake.score;
  return GAME_RUNNING;
}
