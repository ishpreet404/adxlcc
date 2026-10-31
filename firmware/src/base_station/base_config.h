// Cyber Chaukidaar nRF base station — compile-time configuration.
// A classic ESP32 DevKit with three SSD1306 128x64 OLEDs. It joins WiFi, finds the
// server (UDP discovery, same as the sentry nodes), and shows live system status.
// WiFi / server can also be set over the serial console: `cfg wifi <ssid> <pass>`,
// `cfg server http://ip:8787` (or "auto"), `cfg show`, `reboot`.
#pragma once

#define BASE_FW_VERSION "1.0.0"

// ---- network ----
// Leave credentials blank here (don't commit secrets). Set them once over the serial
// console after flashing:  cfg wifi <ssid> <password>   — they persist in NVS.
#define BASE_WIFI_SSID   ""
#define BASE_WIFI_PASS   ""
#define BASE_SERVER_URL  "auto"            // "auto" = UDP-discover the server; or "http://10.110.87.26:8787"

// ---- three OLEDs, each on its own software-I2C pin pair ----
// Three identical SSD1306 share the same I2C address (0x3C), so they cannot sit on one
// bus. U8g2 software I2C gives each display its own SCL/SDA pins, sidestepping the clash.
// These are safe output-capable GPIOs on a classic ESP32 DevKit; change to match wiring.
#define OLED0_SCL 22   // screen 0 — SYSTEM
#define OLED0_SDA 21
#define OLED1_SCL 19   // screen 1 — ALERT
#define OLED1_SDA 18
#define OLED2_SCL 17   // screen 2 — NODES
#define OLED2_SDA 16

// ---- 5-way navigation buttons + status LED ----
// Buttons are active-low to GND with the ESP32's internal pull-ups (no external resistors).
// These GPIOs all support INPUT_PULLUP and avoid the OLED pins and the input-only 34-39 range.
// Wire your buttons/LED to match, or change these to your actual pins.
#define BTN_UP      32
#define BTN_DOWN    33
#define BTN_SELECT  27
#define BTN_LEFT    25
#define BTN_RIGHT   26
#define STATUS_LED   4     // discrete LED to GND through a resistor (active-high)
#define STATUS_LED_ACTIVE_HIGH 1

// ---- behaviour ----
#define POLL_INTERVAL_MS   3000
#define HTTP_TIMEOUT_MS    4000
#define DISCOVERY_PORT     8788
#define SERIAL_BAUD        115200
