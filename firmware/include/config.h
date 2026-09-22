// Cyber Chaukidaar sentry node — compile-time configuration.
// Anything marked [NVS] can be overridden at runtime over the serial console
// (`cfg id N1`, `cfg wifi <ssid> <pass>`, `cfg server http://192.168.1.50:8787`, `cfg show`).
#pragma once

#define FW_VERSION "2.0.0"

// ---------------------------------------------------------------- identity
#define DEFAULT_NODE_ID        "N1"                 // [NVS]
#define DEFAULT_WIFI_SSID      "CyberChaukidaar"    // [NVS]
#define DEFAULT_WIFI_PASS      "SentryGrid2026"     // [NVS]
#define DEFAULT_SERVER_URL     "http://192.168.4.1:8787"  // [NVS] Raspberry Pi address
#define DEFAULT_NODE_KEY       ""                   // [NVS] must match NODE_API_KEY on the server (optional)

// ---------------------------------------------------------------- pins (ESP32 DevKit)
#define PIN_I2C_SDA            21
#define PIN_I2C_SCL            22
#define ADXL_A_ADDR            0x53   // probe A: SDO/ALT pin -> GND   (LEFT of heading)
#define ADXL_B_ADDR            0x1D   // probe B: SDO/ALT pin -> 3V3   (RIGHT of heading)
#define PIN_ADXL_A_INT1        27     // optional, only used by the deep-sleep profile
#define PIN_ADXL_B_INT1        26

#define PIN_RADAR_RX           16     // ESP32 RX2  <- radar TX
#define PIN_RADAR_TX           17     // ESP32 TX2  -> radar RX
#define PIN_RADAR_OUT          33     // radar digital presence output (RTC-capable for wake)
#define PIN_RADAR_POWER        25     // gate of a high-side P-MOSFET switching radar 5V; set -1 if always powered
#define RADAR_BAUD             256000 // HLK-LD2410 default. LD1125H uses 115200.

#define PIN_BATTERY_ADC        34     // ADC1_CH6 through a 100k/100k divider
#define BATTERY_DIVIDER        2.0f
#define PIN_STATUS_LED         2

// LoRa (SX1276/78) — only with -DTRANSPORT_LORA
#define PIN_LORA_SCK           18
#define PIN_LORA_MISO          19
#define PIN_LORA_MOSI          23
#define PIN_LORA_NSS           5
#define PIN_LORA_RST           14
#define PIN_LORA_DIO0          32
#define LORA_FREQUENCY         865E6  // 865-867 MHz is licence-free in India; use 868E6 (EU) / 915E6 (US) as applicable
#define LORA_SYNC_WORD         0x2C

// ---------------------------------------------------------------- sampling / DSP
#define FS_ACTIVE_HZ           100    // ADXL345 ODR while active (feature contract: 100 Hz)
#define FS_ECO_HZ              25     // ADXL345 ODR while sleeping (activity watch)
#define WINDOW_SAMPLES         128    // 1.28 s analysis window @ 100 Hz
#define HP_CUTOFF_HZ           1.5f   // removes gravity / tilt drift
#define LP_CUTOFF_HZ           40.0f
#define STA_SECONDS            0.25f
#define LTA_SECONDS            4.0f
#define STA_LTA_TRIGGER        3.0f
#define STA_LTA_RELEASE        1.6f
#define RMS_TRIGGER_G          0.030f // absolute floor so a very quiet LTA can't over-trigger

// ---------------------------------------------------------------- power profile
#define ECO_LIGHT_SLEEP_MS     1000   // sleep between activity checks in ECO
#define HEARTBEAT_ECO_S        60     // heartbeat uplink interval while quiet
#define ACTIVE_HOLD_S          20     // stay active this long after the last trigger
#define ACTIVE_TX_INTERVAL_MS  1000   // uplink rate during an event (ECO profile)
#define LIVE_TX_INTERVAL_MS    250    // uplink rate in LIVE mode (dashboard streaming)
#define LIVE_DEFAULT_S         300    // LIVE mode auto-expires after this many seconds
#define RADAR_WARMUP_MS        1500   // LD2410 needs ~1 s after power-up
#define BOOT_LIVE              0      // 1 = start in LIVE mode (bench demos), 0 = start in ECO
#define WAVE_SNAPSHOT_SAMPLES  25     // samples per probe attached to LIVE packets (250 ms @ 100 Hz)

// ---------------------------------------------------------------- tamper / deterrent
#define TAMPER_TILT_DEG        20.0f  // node body tilted/lifted this far from its calibrated rest -> TAMPER
#define TAMPER_SHOCK_G         1.8f   // raw acceleration above this (impact / being kicked) -> TAMPER
#define PIN_DETERRENT          -1     // optional buzzer/relay/strobe output driven HIGH during a deterrent burst (-1 = LED only)

// ---------------------------------------------------------------- misc
#define SERIAL_BAUD            115200
#define SERIAL_PACKET_ECHO     1      // also print every packet as ">>{json}" for tools/serial-bridge.js
