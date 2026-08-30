// MODE_GAME scene — Snake rendering/UX glue for main.cpp.
// Game logic lives in lib/game/snake_core (pure C, native-tested); this file
// owns timing, dirty-rect drawing through the shared frame buffer, and the
// game-over flow. Split out of main.cpp to keep it under its size budget.
#ifndef GAME_SCENE_H
#define GAME_SCENE_H

#include <stdint.h>

namespace lgfx {
inline namespace v1 {
class LGFX_Device;
class LGFX_Sprite;
}  // namespace v1
}  // namespace lgfx

// Button edge bits passed into gameSceneLoop (main.cpp maps its GPIOs).
enum : uint8_t {
  GAME_BTN_UP = 1 << 0,
  GAME_BTN_DOWN = 1 << 1,
  GAME_BTN_LEFT = 1 << 2,
  GAME_BTN_RIGHT = 1 << 3,
};

enum GameResult : uint8_t {
  GAME_RUNNING = 0,   // stay in MODE_GAME
  GAME_EXIT_QUIT,     // user held a button — leave quietly
  GAME_EXIT_PLAYED,   // played to game over (score screen shown); react to score
};

// One-time wiring (call from setup, after the frame buffer exists).
void gameSceneInit(lgfx::v1::LGFX_Device* lcd, lgfx::v1::LGFX_Sprite* fpsSpr,
                   uint16_t* frameBuf);

// Fresh game + full-screen redraw. Call on every entry into MODE_GAME.
void gameSceneEnter(uint32_t nowMs);

// Drive one loop iteration. btnEdges = GAME_BTN_* press edges this iteration;
// btnHeldMs = longest current button hold (>=1500 ms quits). *drewFrame is set
// when pixels were pushed (for the shared FPS accounting). On a non-RUNNING
// result, *scoreOut is the final score.
GameResult gameSceneLoop(uint32_t nowMs, uint8_t btnEdges, uint32_t btnHeldMs,
                         int* scoreOut, bool* drewFrame);

#endif  // GAME_SCENE_H
