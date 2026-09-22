# Hardware & wiring

## Bill of materials (one node)

| Qty | Part | Notes |
|---|---|---|
| 1 | ESP32 DevKit (WROOM-32) | any 30/38-pin devkit; ESP32-S3 works with pin edits in `config.h` |
| 2 | ADXL345 breakout (GY-291) | I²C, 3.3 V. One with SDO→GND (0x53), one with SDO→3V3 (0x1D) |
| 1 | HLK-LD2410 / LD2410B / LD2410C 24 GHz radar | 5 V, UART 256000 baud, OUT pin. LD1125H (ASCII, 115200) also supported |
| 1 | 18650 Li-ion + holder, TP4056 charger, MCP1700-3302 / HT7333 LDO | ESP32 needs a quiet 3.3 V rail; AMS1117 wastes ~5 mA idle |
| 1 | P-channel MOSFET (AO3401/IRLML6401) + 10 k pull-up | high-side switch for the radar 5 V rail (optional but recommended) |
| 1 | boost 5 V module (or 2S/USB power bank) | radar needs 5 V ≈ 80 mA when on |
| 2 | 100 kΩ resistors | battery divider |
| 2 | steel ground spikes (12–20 mm rebar/bolt, 25–35 cm) + small IP65 boxes | one per ADXL345 |
| — | SX1276/78 LoRa module | only for `-e lora` |

## Pinout (matches `firmware/include/config.h`)

| Signal | ESP32 GPIO | Notes |
|---|---|---|
| I²C SDA / SCL | 21 / 22 | 4.7 kΩ pull-ups, 400 kHz. Both ADXL345 on this bus |
| ADXL A INT1 / ADXL B INT1 | 27 / 26 | optional, only for the hardware activity-interrupt deep-sleep profile |
| Radar TX → ESP RX2 | 16 | |
| Radar RX ← ESP TX2 | 17 | |
| Radar OUT | 33 | presence digital output; wakes the ESP32 from light sleep when the radar is always powered |
| Radar power gate | 25 | drives the P-MOSFET gate; LOW = radar on. Set `PIN_RADAR_POWER -1` if hard-wired |
| Battery sense | 34 (ADC1) | 100 k / 100 k divider from the cell (max 2.1 V at 4.2 V) |
| Status LED | 2 | on-board |
| LoRa SCK/MISO/MOSI/NSS/RST/DIO0 | 18/19/23/5/14/32 | `-e lora` only |

Both accelerometers share I²C; address is selected by the **SDO/ALT pin** (GND → `0x53`, 3V3 → `0x1D`). Do not power the ADXL345 boards from 5 V.

## Mechanical coupling (this decides everything)

Seismic sensing works only if the sensor moves with the ground:

1. Bolt each ADXL345 PCB flat onto a steel spike head (M3 screws through the mounting holes into a tapped plate welded/epoxied to the spike). No foam, no tape.
2. Drive spikes 25–35 cm into firm soil, 1.5–2 m apart, **on a line perpendicular to the direction the radar faces** (probe A on the node's left, probe B on its right when looking along the heading). Enter this spacing and heading in the dashboard's SITE SETUP.
3. Keep the cable from spike to node slack and strain-relieved so the box does not tug on the spike.
4. Put the radar 0.8–1.2 m above ground, facing the approach you want to guard; keep metal out of its beam.

Sensitivity you can expect with good coupling: footsteps at 5–8 m in packed soil, 10–15 m for vehicles; much less in loose sand.

## Power budget (18650, 3000 mAh)

| State | Current | Share |
|---|---|---|
| ECO light-sleep (probes 25 Hz low-power, radar off, radio off) | ≈ 1.3 mA avg | most of the time |
| Heartbeat (WiFi fast-reconnect + POST, ~0.6 s) every 60 s | ≈ 1 mA avg | |
| ACTIVE event (100 Hz, radar on, 1 pkt/s) | ≈ 180 mA | seconds per event |
| LIVE streaming (4 pkt/s + waveforms) | ≈ 200 mA | demos only, auto-expires |

Quiet site: **3–4 weeks** per charge. Radar hard-wired on (no MOSFET): ~1.5 days — use the gate. Solar (2 W panel + TP4056) keeps it up indefinitely.

## Raspberry Pi

Any Pi (3B+/4/5/Zero 2 W). It runs the server (Node.js) and hosts the dashboard; with the built-in Bluetooth it also acts as the BLE gateway; add an SX127x HAT for LoRa. Give it a fixed IP or a hostname the nodes can reach.
