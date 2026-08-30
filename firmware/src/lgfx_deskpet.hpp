// Shared LovyanGFX panel configuration for the DeskPet display.
// Included by both the product firmware (main.cpp) and the benchmark app
// (bench_main.cpp) so there is exactly one place where pins/bus live.
//
// SET YOUR PINS HERE. Typical classic-devkit wiring for a 1.3" ST7789 240x240:
//   MOSI (SDA) -> GPIO23   SCLK (SCL) -> GPIO18   DC -> GPIO2   RST -> GPIO4
//   CS  -> -1 for the common CS-less 7-pin modules (tie module GND well!),
//          or the GPIO you wired CS to.
//   BL  -> backlight GPIO, or -1 if hardwired to 3V3.
// SPI: 40 MHz is safe; many panels run fine at 80 MHz — try it for more FPS.
// CS-less modules need SPI mode 3; with CS wired, mode 0 is standard.
#ifndef LGFX_DESKPET_HPP
#define LGFX_DESKPET_HPP

#ifndef LGFX_USE_V1
#define LGFX_USE_V1
#endif
#include <LovyanGFX.hpp>

#if defined(CONFIG_IDF_TARGET_ESP32S3)
// ESP32-S3-DevKitC-1 + GMT130 (7-pin CS-less ST7789). One contiguous pin run:
//   GND->GND  VCC->3V3  SCK->12  SDA->11  RES->10  DC->9  BLK->8
// GPIO11/12 are the S3's native FSPI IOMUX pins -> clean 80 MHz capable.
#define DP_PIN_MOSI 11
#define DP_PIN_SCLK 12
#define DP_PIN_CS   -1
#define DP_PIN_DC   9
#define DP_PIN_RST  10
#define DP_PIN_BL   8
#define DP_SPI_HOST SPI2_HOST
#else
// Classic ESP32 devkit (VSPI)
#define DP_PIN_MOSI 23
#define DP_PIN_SCLK 18
#define DP_PIN_CS   -1
#define DP_PIN_DC   2
#define DP_PIN_RST  4
#define DP_PIN_BL   -1
#define DP_SPI_HOST VSPI_HOST
#endif

#ifndef DP_SPI_FREQ
#define DP_SPI_FREQ 40000000  // try 80000000 once stable (bench env can -DDP_SPI_FREQ=...)
#endif

class LGFX_DeskPet : public lgfx::LGFX_Device {
  lgfx::Panel_ST7789 _panel;
  lgfx::Bus_SPI _bus;
  lgfx::Light_PWM _light;

 public:
  LGFX_DeskPet() {
    {
      auto cfg = _bus.config();
      cfg.spi_host = DP_SPI_HOST;
      cfg.spi_mode = (DP_PIN_CS < 0) ? 3 : 0;
      cfg.freq_write = DP_SPI_FREQ;
      cfg.freq_read = 16000000;
      cfg.spi_3wire = false;
      cfg.use_lock = true;
      cfg.dma_channel = SPI_DMA_CH_AUTO;
      cfg.pin_sclk = DP_PIN_SCLK;
      cfg.pin_mosi = DP_PIN_MOSI;
      cfg.pin_miso = -1;
      cfg.pin_dc = DP_PIN_DC;
      _bus.config(cfg);
      _panel.setBus(&_bus);
    }
    {
      auto cfg = _panel.config();
      cfg.pin_cs = DP_PIN_CS;
      cfg.pin_rst = DP_PIN_RST;
      cfg.pin_busy = -1;
      cfg.panel_width = 240;
      cfg.panel_height = 240;
      cfg.offset_x = 0;
      cfg.offset_y = 0;  // some 240x240 modules need 80 when rotated
      cfg.invert = true; // typical for these IPS modules; flip if colors look negative
      cfg.rgb_order = false;
      cfg.bus_shared = false;
      _panel.config(cfg);
    }
#if DP_PIN_BL >= 0
    {
      auto cfg = _light.config();
      cfg.pin_bl = DP_PIN_BL;
      cfg.freq = 44100;
      cfg.pwm_channel = 7;
      _light.config(cfg);
      _panel.setLight(&_light);
    }
#endif
    setPanel(&_panel);
  }
};

#endif  // LGFX_DESKPET_HPP
