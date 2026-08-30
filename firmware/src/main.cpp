// DeskPet firmware — M1: procedural face (default scene) + M0 sticker player.
// MODE_FACE: parametric eyes/mouth, blinks, idle gaze, mood-driven expressions
//            (lib/face), dirty-rect pushes.
// MODE_STICKER: /demo.dpak playback (12 s, then back to the face). A serial
//            DPAK-UPLOAD drops the new art into sticker mode automatically.
// MODE_GAME: Snake on 4 push buttons (src/game_scene.cpp + lib/game). Enter:
//            any button while the face is up, or serial "mode game". Exit:
//            hold any button >=1.5 s, "mode face", or game over (3 s score).
#include <Arduino.h>
#include <LittleFS.h>
#define LGFX_USE_V1
#include <LovyanGFX.hpp>

extern "C" {
#include "dpak.h"
#include "face_engine.h"
#include "face_render.h"
#include "hal.h"
}

#include "game_scene.h"
#include "version.h"

// Display pins + LGFX_DeskPet panel class live in lgfx_deskpet.hpp (shared
// with the benchmark app).
#include "lgfx_deskpet.hpp"

// ---------------------------------------------------------------------------
// Game buttons (Snake, MODE_GAME). Wiring per button: one leg to its GPIO,
// the other leg to GND — INPUT_PULLUP, active low, 20 ms debounce in software.
// No external resistors needed.
// S3 pin budget: 8/9/10/11/12 display, 4/5 touch, 19/20 USB, 0 BOOT,
// straps 3/45/46 avoided -> GPIO 1/2/6/7 are free and side-by-side.
// ---------------------------------------------------------------------------
#if defined(CONFIG_IDF_TARGET_ESP32S3)
#define DP_PIN_BTN_UP    1
#define DP_PIN_BTN_DOWN  2
#define DP_PIN_BTN_LEFT  6
#define DP_PIN_BTN_RIGHT 7
#else
// Classic devkit: GPIO1 is UART TX and 6/7 are flash pins — use safe inputs.
#define DP_PIN_BTN_UP    32
#define DP_PIN_BTN_DOWN  33
#define DP_PIN_BTN_LEFT  25
#define DP_PIN_BTN_RIGHT 26
#endif

static LGFX_DeskPet lcd;
static LGFX_Sprite fpsSpr(&lcd);

static constexpr int SCREEN_W = 240, SCREEN_H = 240;
static constexpr size_t FRAME_BYTES = (size_t)SCREEN_W * SCREEN_H * 2;
// Largest v1 decoded payload at full screen: RGB565_A1 = color plane + 1-bit mask rows
static constexpr size_t DECODE_BUF_BYTES = FRAME_BYTES + (size_t)SCREEN_H * ((SCREEN_W + 7) / 8);

// Anim state
struct AnimFrame { uint32_t spriteId; uint16_t durationMs; int16_t dx, dy; };
static dpak_t g_pak;
static uint8_t* g_packBuf = nullptr;
static uint16_t* g_frameBuf = nullptr;  // composed RGB565 frame (native u16)
static uint8_t* g_decodeBuf = nullptr;  // decompressed sprite payload (any v1 format)
static AnimFrame* g_frames = nullptr;
static uint16_t g_frameCount = 0;
static uint16_t g_fpsX10 = 0;
static bool g_ready = false;  // sticker pack (demo.dpak) loaded and playable

// Scene state
enum RunMode : uint8_t { MODE_FACE, MODE_STICKER, MODE_GAME };
static RunMode g_mode = MODE_FACE;
static face_engine_t g_face;
static face_style_t g_faceStyle;
static bool g_faceFullPush = true;      // full-screen push on mode entry
static int g_prevBx, g_prevBy, g_prevBw, g_prevBh;  // last pushed face bounds
static uint32_t g_stickerUntilMs = 0;   // sticker mode auto-returns to the face
static constexpr uint32_t STICKER_SHOW_MS = 12000;

static void enterFaceMode() {
  g_mode = MODE_FACE;
  g_faceFullPush = true;
}

static bool enterStickerMode() {
  if (!g_ready) return false;
  g_mode = MODE_STICKER;
  g_stickerUntilMs = millis() + STICKER_SHOW_MS;
  return true;
}

static bool enterGameMode(uint32_t nowMs) {
  if (!g_frameBuf) return false;  // OOM boot — no board to draw on
  g_mode = MODE_GAME;
  gameSceneEnter(nowMs);
  return true;
}

// ---------------------------------------------------------------------------
// Game buttons — debounced polling, kept as a static helper here (not in
// lib/hal) on purpose: main.cpp is the only consumer, the buttons are UI
// rather than a sensed capability, and the HAL queue drops oldest events
// under pressure — fine for mood nudges, wrong for game input. No overbuild.
// ---------------------------------------------------------------------------
static constexpr uint8_t BTN_PINS[4] = {DP_PIN_BTN_UP, DP_PIN_BTN_DOWN,
                                        DP_PIN_BTN_LEFT, DP_PIN_BTN_RIGHT};
static constexpr uint32_t BTN_DEBOUNCE_MS = 20;

static void buttonsInit() {
  for (uint8_t pin : BTN_PINS) pinMode(pin, INPUT_PULLUP);
}

// Returns GAME_BTN_* press-edge bits for this iteration; *heldMs = longest
// current stable hold among pressed buttons (0 when none pressed).
static uint8_t buttonsPoll(uint32_t now, uint32_t* heldMs) {
  static bool raw[4] = {}, stable[4] = {};
  static uint32_t rawSince[4] = {}, pressedAt[4] = {};
  uint8_t edges = 0;
  *heldMs = 0;
  for (int i = 0; i < 4; i++) {
    bool r = digitalRead(BTN_PINS[i]) == LOW;  // active low
    if (r != raw[i]) { raw[i] = r; rawSince[i] = now; }
    if (r != stable[i] && now - rawSince[i] >= BTN_DEBOUNCE_MS) {
      stable[i] = r;
      if (r) { edges |= (uint8_t)(1u << i); pressedAt[i] = now; }
    }
    if (stable[i] && now - pressedAt[i] > *heldMs) *heldMs = now - pressedAt[i];
  }
  return edges;  // bit order matches GAME_BTN_UP/DOWN/LEFT/RIGHT
}

static void showFatal(const char* line1, const char* line2) {
  // built-in checkerboard + message — works with no assets and no big buffers
  for (int y = 0; y < SCREEN_H; y += 24)
    for (int x = 0; x < SCREEN_W; x += 24)
      lcd.fillRect(x, y, 24, 24, ((x / 24 + y / 24) & 1) ? TFT_DARKGREY : TFT_BLACK);
  lcd.setTextColor(TFT_WHITE, TFT_BLACK);
  lcd.setTextDatum(lgfx::middle_center);
  lcd.drawString(line1, 120, 108);
  lcd.drawString(line2, 120, 128);
  Serial.printf("FATAL: %s %s\n", line1, line2);
}

// Allocate the shared frame/decode buffers (once; kept across pack reloads).
static bool ensureBuffers() {
  if (!g_frameBuf) {
    g_frameBuf = (uint16_t*)heap_caps_malloc(FRAME_BYTES, MALLOC_CAP_SPIRAM);
    if (g_frameBuf) {
      Serial.println("frame buffer in PSRAM");
    } else {
      g_frameBuf = (uint16_t*)heap_caps_malloc(FRAME_BYTES, MALLOC_CAP_8BIT);
      Serial.printf("frame buffer in internal RAM: %s\n", g_frameBuf ? "ok" : "FAILED");
    }
  }
  if (!g_frameBuf) {
    showFatal("out of memory", "(frame buffer)");
    return false;
  }
  if (!g_decodeBuf) {
    g_decodeBuf = (uint8_t*)heap_caps_malloc(DECODE_BUF_BYTES, MALLOC_CAP_SPIRAM);
    if (!g_decodeBuf) g_decodeBuf = (uint8_t*)heap_caps_malloc(DECODE_BUF_BYTES, MALLOC_CAP_8BIT);
  }
  if (!g_decodeBuf) {
    showFatal("out of memory", "(decode buffer)");
    return false;
  }
  return true;
}

// Optional /face.dpak: EXPR assets override the built-in expression tracks
// (data-driven per ADR-003). Missing file or bad pack -> built-ins stay.
static void loadFaceOverrides() {
  File f = LittleFS.open("/face.dpak", "r");
  if (!f || f.size() < 32) {
    Serial.println("no /face.dpak — using built-in expressions");
    return;
  }
  size_t sz = f.size();
  uint8_t* buf = (uint8_t*)malloc(sz);
  if (!buf || f.read(buf, sz) != sz) {
    Serial.println("face.dpak read failed — using built-ins");
    free(buf);
    return;
  }
  f.close();
  dpak_t pak;
  int rc = dpak_open(buf, sz, 0, &pak);
  if (rc == DPAK_OK) {
    int n = face_engine_load_dpak(&g_face, &pak);  // copies tracks; buf can go
    Serial.printf("face.dpak: %d expression override(s) loaded\n", n);
  } else {
    Serial.printf("face.dpak: dpak_open rc=%d — using built-ins\n", rc);
  }
  free(buf);
}

// Load /demo.dpak for sticker mode. Non-fatal: the face runs without it.
static bool loadPack() {
  File f = LittleFS.open("/demo.dpak", "r");
  if (!f || f.size() < 32) {
    Serial.println("no /demo.dpak — sticker mode unavailable (upload one)");
    return false;
  }
  size_t sz = f.size();
  g_packBuf = (uint8_t*)heap_caps_malloc(sz, MALLOC_CAP_SPIRAM);
  if (!g_packBuf) g_packBuf = (uint8_t*)malloc(sz);
  if (!g_packBuf || f.read(g_packBuf, sz) != sz) {
    showFatal("pack read failed", "");
    return false;
  }
  f.close();

  int rc = dpak_open(g_packBuf, sz, 0, &g_pak);
  if (rc != DPAK_OK) {
    Serial.printf("dpak_open rc=%d\n", rc);
    showFatal("bad demo.dpak", "re-run uploadfs");
    return false;
  }
  Serial.printf("pack: %u bytes, %u assets, id=%016llx\n", (unsigned)sz, g_pak.tocCount,
                (unsigned long long)g_pak.packId);

  dpak_entry_t anim;
  if (dpak_find(&g_pak, dpak_fnv1a_str("demo"), &anim) != DPAK_OK || anim.type != DPAK_TYPE_ANIM ||
      anim.length < 8) {
    showFatal("anim 'demo' missing", "");
    return false;
  }
  const uint8_t* a = anim.blob;
  g_frameCount = (uint16_t)(a[0] | (a[1] << 8));
  g_fpsX10 = (uint16_t)(a[4] | (a[5] << 8));
  if (g_frameCount == 0 || anim.length < 8u + (uint32_t)g_frameCount * 12u) {
    showFatal("bad anim blob", "");
    return false;
  }
  g_frames = (AnimFrame*)malloc(sizeof(AnimFrame) * g_frameCount);
  for (uint16_t i = 0; i < g_frameCount; i++) {
    const uint8_t* r = a + 8 + i * 12;
    g_frames[i].spriteId = (uint32_t)(r[0] | (r[1] << 8) | (r[2] << 16) | ((uint32_t)r[3] << 24));
    g_frames[i].durationMs = (uint16_t)(r[4] | (r[5] << 8));
    g_frames[i].dx = (int16_t)(r[6] | (r[7] << 8));
    g_frames[i].dy = (int16_t)(r[8] | (r[9] << 8));
  }
  Serial.printf("anim 'demo': %u frames, fpsX10=%u\n", g_frameCount, g_fpsX10);
  return true;
}

static void freePack() {
  g_ready = false;
  free(g_frames);
  g_frames = nullptr;
  g_frameCount = 0;
  free(g_packBuf);
  g_packBuf = nullptr;
}

// ---------------------------------------------------------------------------
// DPAK-UPLOAD v1 serial listener — contract: tools/animator/PROTOCOL.md
// Blocks the render loop for the duration of a transfer (progress on screen).
// ---------------------------------------------------------------------------
static constexpr size_t UPLOAD_MAX_CHUNK = 4096;
static constexpr uint32_t UPLOAD_RX_TIMEOUT_MS = 5000;

// Incremental CRC-32 IEEE (bitwise; serial at 115200 is the bottleneck, not CPU)
static uint32_t crc32_update(uint32_t crc, const uint8_t* p, size_t n) {
  crc = ~crc;
  while (n--) {
    crc ^= *p++;
    for (int k = 0; k < 8; k++) crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
  }
  return ~crc;
}

static bool readExact(uint8_t* dst, size_t n) {
  size_t got = 0;
  uint32_t start = millis();
  while (got < n) {
    int avail = Serial.available();
    if (avail > 0) {
      got += Serial.read(dst + got, min((size_t)avail, n - got));
      start = millis();
    } else if (millis() - start > UPLOAD_RX_TIMEOUT_MS) {
      return false;
    } else {
      delay(1);
    }
  }
  return true;
}

static void uploadScreen(const char* msg, uint32_t received, uint32_t total) {
  lcd.fillRect(0, 100, 240, 40, TFT_BLACK);
  lcd.setTextColor(TFT_WHITE, TFT_BLACK);
  lcd.setTextDatum(lgfx::middle_center);
  lcd.drawString(msg, 120, 110);
  lcd.drawRect(20, 124, 200, 10, TFT_DARKGREY);
  if (total) lcd.fillRect(21, 125, (int)(198u * (uint64_t)received / total), 8, TFT_GREEN);
}

static void handleUpload(uint32_t totalSize, uint32_t expectCrc) {
  if (totalSize < 32) { Serial.print("ERR too-small\n"); return; }
  if (!LittleFS.begin(false, "/littlefs", 10, "assets")) { Serial.print("ERR no-fs\n"); return; }
  size_t freeBytes = LittleFS.totalBytes() - LittleFS.usedBytes();
  // temp + final can coexist briefly; demo.dpak is replaced, so count it as free
  File old = LittleFS.open("/demo.dpak", "r");
  if (old) { freeBytes += old.size(); old.close(); }
  if (totalSize + 8192 > freeBytes) { Serial.print("ERR too-big\n"); return; }

  static uint8_t* chunk = nullptr;
  if (!chunk) chunk = (uint8_t*)malloc(UPLOAD_MAX_CHUNK);
  if (!chunk) { Serial.print("ERR oom\n"); return; }

  if (LittleFS.exists("/upload.tmp")) LittleFS.remove("/upload.tmp");
  File out = LittleFS.open("/upload.tmp", "w");
  if (!out) { Serial.print("ERR open-tmp\n"); return; }

  // Draw BEFORE acking: after we ack, the host immediately transmits the next
  // frame, and slow work here (SPI drawing) lets the CDC RX buffer overflow.
  uploadScreen("receiving assets...", 0, totalSize);
  Serial.print("OK\n");

  uint32_t received = 0, runCrc = 0, badStreak = 0, sinceDraw = 0;
  while (received < totalSize) {
    uint8_t hdr[2];
    if (!readExact(hdr, 2)) { out.close(); LittleFS.remove("/upload.tmp"); Serial.print("ERR timeout\n"); return; }
    uint32_t len = hdr[0] | (hdr[1] << 8);
    if (len < 1 || len > UPLOAD_MAX_CHUNK || received + len > totalSize) {
      out.close(); LittleFS.remove("/upload.tmp"); Serial.print("ERR bad-chunk\n"); return;
    }
    uint8_t crcb[4];
    if (!readExact(chunk, len) || !readExact(crcb, 4)) {
      out.close(); LittleFS.remove("/upload.tmp"); Serial.print("ERR timeout\n"); return;
    }
    uint32_t crc = crcb[0] | (crcb[1] << 8) | (crcb[2] << 16) | ((uint32_t)crcb[3] << 24);
    if (dpak_crc32(chunk, len) != crc) {
      if (++badStreak > 8) { out.close(); LittleFS.remove("/upload.tmp"); Serial.print("ERR crc-giveup\n"); return; }
      Serial.print("R\n");
      continue;
    }
    badStreak = 0;
    if (out.write(chunk, len) != len) {
      out.close(); LittleFS.remove("/upload.tmp"); Serial.print("ERR write\n"); return;
    }
    runCrc = crc32_update(runCrc, chunk, len);
    received += len;
    // slow work (LCD) strictly BEFORE the ack — see comment at the handshake
    if (++sinceDraw >= 8 || received == totalSize) { uploadScreen("receiving assets...", received, totalSize); sinceDraw = 0; }
    Serial.print("A\n");
  }
  out.close();

  if (runCrc != expectCrc) { LittleFS.remove("/upload.tmp"); Serial.print("ERR total-crc\n"); return; }
  if (LittleFS.exists("/demo.dpak")) LittleFS.remove("/demo.dpak");
  if (!LittleFS.rename("/upload.tmp", "/demo.dpak")) { Serial.print("ERR rename\n"); return; }
  Serial.print("DONE\n");
  Serial.flush();

  freePack();
  lcd.fillScreen(TFT_BLACK);
  g_ready = loadPack();
  if (g_ready) {
    face_engine_bump(&g_face, FACE_EVT_NEW_ART);  // pet reacts to fresh art
    enterStickerMode();                           // show it right away
  } else {
    enterFaceMode();
  }
}

static int exprIdByName(const char* name) {
  static const char* names[FACE_EXPR_COUNT] = {"neutral", "happy",     "sleepy",
                                               "angry",   "surprised", "sad"};
  for (int i = 0; i < FACE_EXPR_COUNT; i++)
    if (strcmp(name, names[i]) == 0) return i;
  return -1;
}

// One complete serial line. Unknown lines are ignored (protocol tolerance).
static void handleSerialLine(const char* line) {
  uint32_t size = 0, crc = 0;
  // trailing fields after crc are a v2 extension — ignored by design
  if (sscanf(line, "DPAK-UPLOAD v1 %lu %8lx", (unsigned long*)&size, (unsigned long*)&crc) == 2) {
    handleUpload(size, crc);
  } else if (strncmp(line, "expr ", 5) == 0) {
    int id = exprIdByName(line + 5);
    if (id >= 0) {
      face_engine_set_expression(&g_face, (face_expr_id_t)id);
      face_engine_bump(&g_face, FACE_EVT_INTERACTION);
      Serial.print("OK expr\n");
    } else {
      Serial.print("ERR unknown-expr\n");
    }
  } else if (strcmp(line, "mode face") == 0) {
    enterFaceMode();
    Serial.print("OK mode\n");
  } else if (strcmp(line, "mode sticker") == 0) {
    if (enterStickerMode()) Serial.print("OK mode\n");
    else Serial.print("ERR no-pack\n");
  } else if (strcmp(line, "mode game") == 0 || strcmp(line, "game") == 0) {
    if (enterGameMode(millis())) Serial.print("OK mode\n");
    else Serial.print("ERR no-mem\n");
  } else if (strcmp(line, "info") == 0) {
    // Introspection contract — ADR-008 §6. Studio adapts its UI from caps.
    const hal_hwinfo_t* hw = dp_hal_hwinfo();
    Serial.printf("INFO fw=%s gen=%u rev=%c tier=%s caps=%lx proto=1 dpak=1\n",
                  DP_FW_VERSION, hw->gen, (char)hw->boardRev, hal_tier_str(hw->tier),
                  (unsigned long)hw->caps);
  } else if (strcmp(line, "caps") == 0) {
    const hal_hwinfo_t* hw = dp_hal_hwinfo();
    Serial.printf("caps %08lx", (unsigned long)hw->caps);
    for (int b = 0; b < 32; b++)
      if ((hw->caps >> b) & 1u)
        Serial.printf(" %s", hal_cap_name(b) ? hal_cap_name(b) : "?");
    Serial.print("\n");
  } else if (strncmp(line, "caps set ", 9) == 0) {
    unsigned long caps = 0;
    if (sscanf(line + 9, "%8lx", &caps) == 1 && dp_hal_caps_set_override((uint32_t)caps) == 0)
      Serial.print("OK caps-override (applies on reboot)\n");
    else
      Serial.print("ERR caps-set\n");
  } else if (strcmp(line, "hwinfo clear") == 0) {
    if (dp_hal_hwinfo_clear() == 0) Serial.print("OK hwinfo-cleared (re-probes on reboot)\n");
    else Serial.print("ERR hwinfo-clear\n");
  } else if (strcmp(line, "mood") == 0) {
    Serial.printf("mood happiness=%u energy=%u boredom=%u attention=%u\n",
                  g_face.mood.happiness, g_face.mood.energy, g_face.mood.boredom,
                  g_face.mood.attention);
  }
}

// Drain the HAL input event queue: touch drives the face (a tap perks the pet
// up, a hold is "petting" -> sleepy contentment). Other event types have no
// behavior yet — logged at debug level only.
static void drainHalEvents() {
  hal_event_t ev;
  while (hal_evq_pop(dp_hal_queue(), &ev)) {
    switch (ev.type) {
      case HEV_TOUCH_TAP:
        face_engine_set_expression(&g_face, FACE_EXPR_HAPPY);
        face_engine_bump(&g_face, FACE_EVT_INTERACTION);
        break;
      case HEV_TOUCH_HOLD:
        face_engine_set_expression(&g_face, FACE_EXPR_SLEEPY);
        face_engine_bump(&g_face, FACE_EVT_INTERACTION);
        break;
      default:
        log_d("hal event type=%u a=%d b=%d", ev.type, ev.a, ev.b);
        break;
    }
  }
}

// Non-blocking line reader; dispatches complete lines to handleSerialLine.
static void pollSerialCommands() {
  static char line[128];
  static size_t lineLen = 0;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      line[lineLen] = 0;
      if (lineLen > 0) handleSerialLine(line);
      lineLen = 0;
    } else if (lineLen < sizeof(line) - 1) {
      line[lineLen++] = c;
    } else {
      lineLen = 0; // overlong garbage — resync
    }
  }
}

// FPS accounting shared by both scenes (1/s overlay + serial line, as in M0)
static void fpsTick(uint32_t now) {
  static uint32_t fpsCount = 0, fpsWindowStart = 0;
  fpsCount++;
  if (now - fpsWindowStart >= 1000) {
    float fps = fpsCount * 1000.0f / (now - fpsWindowStart);
    fpsCount = 0;
    fpsWindowStart = now;
    fpsSpr.fillSprite(TFT_BLACK);
    fpsSpr.setCursor(2, 3);
    fpsSpr.printf("%.1f FPS", fps);
    Serial.printf("%.1f FPS\n", fps);
  }
}

// ---------------------------------------------------------------------------
// MODE_FACE: engine tick -> software render -> dirty-rect push
// ---------------------------------------------------------------------------
static void loopFace(uint32_t now) {
  static uint32_t lastTick = 0;
  if (now - lastTick < 15) {  // ~60 Hz tick
    delay(1);
    return;
  }
  lastTick = now;

  face_params_t fp;
  face_engine_update(&g_face, now, &fp);
  face_render(&fp, g_frameBuf, SCREEN_W, SCREEN_H, SCREEN_W, &g_faceStyle);

  int bx, by, bw, bh;
  face_bounds(&fp, SCREEN_W, SCREEN_H, &bx, &by, &bw, &bh);

  // push only the union of the previous and current bounds (full on mode entry)
  int ux, uy, ux1, uy1;
  if (g_faceFullPush) {
    ux = 0; uy = 0; ux1 = SCREEN_W; uy1 = SCREEN_H;
    g_faceFullPush = false;
  } else {
    ux = min(bx, g_prevBx);
    uy = min(by, g_prevBy);
    ux1 = max(bx + bw, g_prevBx + g_prevBw);
    uy1 = max(by + bh, g_prevBy + g_prevBh);
    ux = max(0, ux); uy = max(0, uy);
    ux1 = min(SCREEN_W, ux1); uy1 = min(SCREEN_H, uy1);
  }
  lcd.startWrite();
  if (ux1 > ux && uy1 > uy) {
    lcd.setWindow(ux, uy, ux1 - 1, uy1 - 1);
    for (int y = uy; y < uy1; y++)
      lcd.writePixels((const lgfx::rgb565_t*)&g_frameBuf[(size_t)y * SCREEN_W + ux], ux1 - ux);
  }
  fpsSpr.pushSprite(2, 2);  // overlay region repushed every frame
  lcd.endWrite();
  g_prevBx = bx; g_prevBy = by; g_prevBw = bw; g_prevBh = bh;
  fpsTick(now);
}

// ---------------------------------------------------------------------------
// MODE_STICKER: M0 demo.dpak playback, 12 s then back to the face
// ---------------------------------------------------------------------------
static void loopSticker(uint32_t now) {
  if (!g_ready || (int32_t)(now - g_stickerUntilMs) >= 0) {
    enterFaceMode();
    return;
  }

  static uint16_t curFrame = 0;
  static uint32_t frameShownAt = 0;

  // advance anim by wall clock (defaultFpsX10 wins over per-frame durations if set)
  if (curFrame >= g_frameCount) curFrame = 0;  // pack may have been replaced
  uint32_t durMs = g_fpsX10 ? (10000u / g_fpsX10) : g_frames[curFrame].durationMs;
  if (durMs == 0) durMs = 100;
  if (now - frameShownAt >= durMs) {
    curFrame = (uint16_t)((curFrame + 1) % g_frameCount);
    frameShownAt = now;
  }

  dpak_entry_t sprE;
  bool drawn = false;
  if (dpak_get(&g_pak, g_frames[curFrame].spriteId, &sprE) == DPAK_OK) {
    dpak_sprite_t spr;
    if (dpak_sprite_header(&g_pak, &sprE, &spr) == DPAK_OK) {
      int x = g_frames[curFrame].dx, y = g_frames[curFrame].dy;
      bool fullOpaque = spr.format == DPAK_FMT_RGB565 && x == 0 && y == 0 &&
                        spr.width == SCREEN_W && spr.height == SCREEN_H;
      if (fullOpaque) {
        // fast path: opaque full-screen frame decodes straight into the frame buffer
        drawn = dpak_sprite_decode(&g_pak, &sprE, (uint8_t*)g_frameBuf, FRAME_BYTES) > 0;
      } else if (x >= 0 && y >= 0 && x + spr.width <= SCREEN_W && y + spr.height <= SCREEN_H &&
                 dpak_sprite_decode(&g_pak, &sprE, g_decodeBuf, DECODE_BUF_BYTES) > 0) {
        const uint8_t* pal = nullptr;
        uint16_t palCount = 0;
        if (spr.paletteRef) dpak_palette_get(&g_pak, spr.paletteRef, &pal, &palCount);
        memset(g_frameBuf, 0, FRAME_BYTES);  // black background; blit skips transparent px
        drawn = dpak_blit_to_rgb565(&spr, g_decodeBuf, pal, palCount,
                                    g_frameBuf + (size_t)y * SCREEN_W + x, SCREEN_W) == DPAK_OK;
      }
    }
  }
  if (drawn) {
    // native-u16 RGB565; the typed pointer lets LovyanGFX handle panel byte order
    lcd.startWrite();
    lcd.pushImage(0, 0, SCREEN_W, SCREEN_H, (const lgfx::rgb565_t*)g_frameBuf);
    fpsSpr.pushSprite(2, 2);
    lcd.endWrite();
  } else {
    static uint32_t lastErrLog = 0;
    if (now - lastErrLog > 1000) {
      Serial.printf("frame %u draw failed (format unsupported or out of bounds)\n", curFrame);
      lastErrLog = now;
    }
    delay(50);  // don't spin the loop (and the log) at full speed on a bad pack
  }
  fpsTick(now);
}

void setup() {
  Serial.setRxBufferSize(8192);  // upload chunks arrive faster than we drain during flash writes
  Serial.begin(115200);
  Serial.setTimeout(UPLOAD_RX_TIMEOUT_MS);
  lcd.init();
  lcd.setColorDepth(16);
  lcd.fillScreen(TFT_BLACK);
  fpsSpr.setColorDepth(16);
  fpsSpr.createSprite(72, 14);
  fpsSpr.setTextColor(TFT_GREEN, TFT_BLACK);

  // Hardware capability layer (ADR-008): hwinfo from NVS, else auto-probe.
  dp_hal_init();
  {
    const hal_hwinfo_t* hw = dp_hal_hwinfo();
    Serial.printf("hal: hwinfo=%s tier=%s caps=%08lx\n", dp_hal_hwinfo_source(),
                  hal_tier_str(hw->tier), (unsigned long)hw->caps);
  }

  // Face first: the pet is alive within ~0.5 s of display init.
  face_engine_init(&g_face, esp_random());
  face_style_default(&g_faceStyle);
  if (ensureBuffers()) loopFace(millis());  // first frame, full push

  buttonsInit();
  gameSceneInit(&lcd, &fpsSpr, g_frameBuf);  // Snake shares the frame buffer

  // Then the (optional) asset packs.
  if (!LittleFS.begin(false, "/littlefs", 10, "assets")) {
    Serial.println("LittleFS mount failed — run: pio run -t uploadfs (face still runs)");
  } else {
    loadFaceOverrides();
    g_ready = loadPack();
  }
}

void loop() {
  pollSerialCommands();
  if (!g_frameBuf) {  // OOM at boot — nothing to render with
    delay(50);
    return;
  }
  uint32_t now = millis();
  dp_hal_poll(now);  // 50 Hz sensor sampling (rate-limited internally)
  drainHalEvents();

  uint32_t btnHeldMs = 0;
  uint8_t btnEdges = buttonsPoll(now, &btnHeldMs);

  switch (g_mode) {
    case MODE_FACE:
      if (btnEdges) {  // any button while the face is up -> let's play
        enterGameMode(now);
        break;
      }
      loopFace(now);
      break;
    case MODE_STICKER:
      loopSticker(now);
      break;
    case MODE_GAME: {
      int score = 0;
      bool drew = false;
      GameResult r = gameSceneLoop(now, btnEdges, btnHeldMs, &score, &drew);
      if (drew) fpsTick(now);
      if (r != GAME_RUNNING) {
        if (r == GAME_EXIT_PLAYED) {
          // The pet watched you play: proud of a good run, sympathetic loss.
          if (score >= 10) {
            face_engine_set_expression(&g_face, FACE_EXPR_HAPPY);
            face_engine_bump(&g_face, FACE_EVT_INTERACTION);
          } else if (score < 3) {
            face_engine_set_expression(&g_face, FACE_EXPR_SAD);
          }
        }
        enterFaceMode();
      }
      break;
    }
  }
}
