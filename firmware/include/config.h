// Cyber Chaukidaar sentry node — compile-time configuration.
// Anything marked [NVS] can be overridden at runtime over the serial console
// (`cfg id N1`, `cfg wifi <ssid> <pass>`, `cfg server http://192.168.1.50:8787`, `cfg show`).
// NOTE: values saved over the console take precedence over the defaults below; `cfg clear` resets.
#pragma once

#define FW_VERSION "2.1.0"

// ---------------------------------------------------------------- identity / network
#define DEFAULT_NODE_ID        "N1"                       // [NVS]
#define DEFAULT_WIFI_SSID      "Excitel_Demon"            // [NVS] laptop hotspot (or "CyberChaukidaar" for the Pi hotspot, gateway/hotspot.sh)
#define DEFAULT_WIFI_PASS      "Vansh2309%"               // [NVS]
#define DEFAULT_SERVER_URL     "http://192.168.1.11:8787" // [NVS] Pi LAN address (`hostname -I` on the Pi). "auto" = UDP discovery, only works when node and Pi share one subnet (Pi hotspot)
#define DEFAULT_NODE_KEY       ""                         // [NVS] must match NODE_API_KEY on the server (optional)

// ================================================================ BOARD: ESP32-S3 build (-DBOARD_S3)
#if defined(BOARD_S3)
// ADXL345 ×2 on the SPI bus (4-wire, mode 3)
#define ADXL_USE_SPI           1
#define PIN_SPI_SCK            12     // -> SCL on both ADXL345
#define PIN_SPI_MOSI           11     // -> SDA on both ADXL345
#define PIN_SPI_MISO           13     // -> SDO on both ADXL345
#define PIN_ADXL_A_CS          10     // probe A chip select (LEFT of heading)
#define PIN_ADXL_B_CS          9      // probe B chip select (RIGHT of heading)

// LD2420 radar: 3.3 V logic, plain-text output at 115200 baud ("ON", "OFF", "Range 187")
#define RADAR_MODEL_LD2420     1
#define PIN_RADAR_RX           16     // ESP32 RX  <- radar OT1/TX
#define PIN_RADAR_TX           17     // ESP32 TX  -> radar RX
#define PIN_RADAR_OUT          -1     // OT2 not wired
#define PIN_RADAR_POWER        -1     // radar hard-wired to 3V3 (no MOSFET gate)
#define RADAR_BAUD             115200

// WS2812B ring + buzzer (indicators / deterrent)
#define PIN_LED_RING           14
#define LED_RING_COUNT         8      // LED 0 must point along the node heading (radar direction)
#define LED_BRIGHTNESS         60     // 0-255; keep low on battery
#define PIN_BUZZER             5
#define BUZZER_PASSIVE         0      // 0 = active buzzer module (HIGH = sound), 1 = passive (PWM tone)
#define PIN_STATUS_LED         -1     // no plain LED on the S3 board; the ring is used instead

#define PIN_BATTERY_ADC        8      // ADC1_CH7 through a 100k/100k divider (+0.1 µF)
#define BATTERY_DIVIDER        2.0f

// ================================================================ BOARD: classic ESP32 DevKit (default)
#else
#define PIN_I2C_SDA            21
#define PIN_I2C_SCL            22
#define ADXL_A_ADDR            0x53   // probe A: SDO/ALT pin -> GND   (LEFT of heading)
#define ADXL_B_ADDR            0x1D   // probe B: SDO/ALT pin -> 3V3   (RIGHT of heading)
#define PIN_ADXL_A_INT1        27
#define PIN_ADXL_B_INT1        26

#define RADAR_MODEL_LD2410     1
#define PIN_RADAR_RX           16     // ESP32 RX2  <- radar TX
#define PIN_RADAR_TX           17     // ESP32 TX2  -> radar RX
#define PIN_RADAR_OUT          33     // radar digital presence output (RTC-capable for wake)
#define PIN_RADAR_POWER        25     // gate of a high-side P-MOSFET switching radar 5V; -1 if always powered
#define RADAR_BAUD             256000 // HLK-LD2410 default

#define PIN_LED_RING           -1
#define LED_RING_COUNT         0
#define LED_BRIGHTNESS         40
#define PIN_BUZZER             -1
#define BUZZER_PASSIVE         0
#define PIN_STATUS_LED         2

#define PIN_BATTERY_ADC        34     // ADC1_CH6 through a 100k/100k divider
#define BATTERY_DIVIDER        2.0f

// LoRa (SX1276/78) — only with -DTRANSPORT_LORA
#define PIN_LORA_SCK           18
#define PIN_LORA_MISO          19
#define PIN_LORA_MOSI          23
#define PIN_LORA_NSS           5
#define PIN_LORA_RST           14
#define PIN_LORA_DIO0          32
#define LORA_FREQUENCY         865E6
#define LORA_SYNC_WORD         0x2C
#endif

// ---------------------------------------------------------------- geometry
#define PROBE_SPACING_M        1.5f   // distance between the two ground spikes (also set in the dashboard)

// ---------------------------------------------------------------- sampling / DSP
#define FS_ACTIVE_HZ           100    // ADXL345 ODR while active (feature contract: 100 Hz)
#define FS_ECO_HZ              25     // ADXL345 ODR while sleeping (activity watch)
#define WINDOW_SAMPLES         128    // 1.28 s analysis window @ 100 Hz
#define HP_CUTOFF_HZ           1.5f
#define LP_CUTOFF_HZ           40.0f
#define STA_SECONDS            0.25f
#define LTA_SECONDS            4.0f
#define STA_LTA_TRIGGER        3.0f
#define STA_LTA_RELEASE        1.6f
#define RMS_TRIGGER_G          0.030f

// ---------------------------------------------------------------- power profile
#define ECO_LIGHT_SLEEP_MS     1000
#define HEARTBEAT_ECO_S        60
#define ACTIVE_HOLD_S          20
#define ACTIVE_TX_INTERVAL_MS  1000
#define LIVE_TX_INTERVAL_MS    250
#define LIVE_DEFAULT_S         300
#define RADAR_WARMUP_MS        1500
#define BOOT_LIVE              0      // 1 = start in LIVE mode (bench demos), 0 = start in ECO
#define WAVE_SNAPSHOT_SAMPLES  25

// ---------------------------------------------------------------- tamper / deterrent
#define TAMPER_TILT_DEG        20.0f
#define TAMPER_SHOCK_G         1.8f
#define PIN_DETERRENT          -1     // extra relay/strobe output during a deterrent burst (the ring + buzzer are always used)

// ---------------------------------------------------------------- misc
#define SERIAL_BAUD            115200
#define SERIAL_PACKET_ECHO     1
