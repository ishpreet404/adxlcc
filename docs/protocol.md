# Protocol

## Uplink packet v2 (`POST /api/ingest`, JSON)

```json
{
  "v": 2, "id": "N1", "seq": 412, "up": 8123456, "fw": "2.0.0", "tr": "wifi", "rssi": -61,
  "mode": "LIVE",                 "st": "EVENT",
  "bat":   { "v": 3.91, "p": 78 },
  "radar": { "ok": true, "pres": true, "mov": 1, "dist": 4.2, "eng": 63, "sdist": 0, "seng": 0 },
  "a": { "ok": true, "x": 0.012, "y": -0.004, "z": 0.991, "rms": 0.0412, "peak": 0.1630, "sl": 3.4 },
  "b": { "ok": true, "x": 0.002, "y":  0.009, "z": 0.988, "rms": 0.0297, "peak": 0.1104, "sl": 2.6 },
  "seis": { "lag": -3.2, "corr": 0.81, "ratio": 1.39,
            "f": [rms, peak, peakToPeak, variance, dominantFrequency, spectralEnergy, spectralCentroid, interPeakInterval, zeroCrossingRate, crestFactor] },
  "ml":  { "c": 1, "p": [0.03, 0.91, 0.02, 0.04] },
  "wave": { "fs": 100, "a": [12, -5, 30, ...], "b": [...] },
  "tamper": { "tilt": 1.2, "flag": false, "imp": false },
  "nf": 0.0061,
  "cal": true,
  "sys": { "heap": 178000, "tmp": 41.2 }
}
```

* `tamper.tilt` = degrees between the current gravity vector and the calibrated rest, `flag` sticky for 30 s after a tilt > 20° or a shock > 1.8 g, `imp` = shock seen in the last 10 s.
* `nf` probe-A long-term RMS (noise floor), `cal` present once after a calibration.

* `tr` transport (`wifi|ble|lora|serial`), `mode` `LIVE|ECO`, `st` `IDLE|SUSPECT|EVENT`.
* `a`/`b` = probe A (left) / probe B (right): last raw sample (g), RMS & peak of the band-passed magnitude over the last second, STA/LTA ratio.
* `seis.lag` = t_B − t_A in ms (positive → A heard the wave first), `corr` = normalised cross-correlation peak, `f` = the 10-feature vector (see `ml/README.md`).
* `ml.c` class index into `NORMAL, HUMAN, VEHICLE, ENVIRONMENT`; `p` probabilities.
* `wave` (LIVE only): integer milli-g samples; the server accumulates them into a 512-sample buffer per probe.
* Legacy v1 packets (`nodeId`, `accelerometer.sensor1…`) are still accepted at `/api/telemetry` and `/api/ingest`.
* Optional header `X-Node-Key` when `NODE_API_KEY` is set; gateways add `X-Transport`.

Reply: `{"ok":true,"t":<ms>,"level":"CLEAR|ACTIVITY|SUSPECT|INTRUSION","alert":"AL-…"|null,"cmd":{...}?}`

## Downlink commands

`{"mode":"LIVE","liveFor":300}` · `{"mode":"ECO"}` · `{"reboot":true}` · `{"sleepS":30}` · `{"calibrate":true}` · `{"deter":10}` — queued with `POST /api/nodes/:id/command`, delivered in the next reply. The server also queues `mode: LIVE` itself to pre-arm the node a track is heading for.

## LoRa frame (40 bytes, little-endian, `-e lora`)

| off | type | field |
|---|---|---|
| 0 | u8 | magic 0xC7 |
| 1 | u8 | version 2 |
| 2 | char[8] | node id |
| 10 | u16 | seq |
| 12 | u32 | uptime s |
| 16 | u16 | battery mV |
| 18 | u8 | battery % |
| 19 | i8 | (unused) |
| 20 | u8 | mode 0 ECO / 1 LIVE |
| 21 | u8 | state 0/1/2 |
| 22 | u8 | radar flags: b0 presence, b1 moving, b2 ok |
| 23 | u8 | radar distance dm |
| 24 | u8 | radar energy |
| 25 | u16 | RMS A ×10⁴ g |
| 27 | u16 | RMS B ×10⁴ g |
| 29 | i8 | lag ×0.1 ms |
| 30 | u8 | corr % |
| 31 | u8 | ML class |
| 32 | u8 | ML confidence % |
| 33 | u8 | dominant freq ×2 |
| 34 | u16 | inter-peak ms |
| 36 | u8 | CRC-8 (poly 0x07) over bytes 0–35 |

(`struct` in `gateway/lora_gateway.py` and `firmware/src/comm/lora_transport.cpp`.) Downlink: ASCII `"<id>:{json}"` sent by the gateway within 400 ms of the uplink.

## BLE (`-e ble`)

Service `0xC0DE`; uplink characteristic `0xC0D1` (notify; 180-byte chunks, packet ends with `\n`), downlink `0xC0D2` (write: the server reply). Device name `SENTRY-<id>`.

## REST

| Method & path | Purpose |
|---|---|
| `GET /api/nodes` | site, all nodes (latest telemetry, fusion, position), tracks |
| `GET /api/nodes/:id` · `/history` · `/wave` | node detail, 2-minute history, waveform buffer + spectrum |
| `PUT /api/nodes/:id` | `{name,x,y,heading,spacing}` placement |
| `DELETE /api/nodes/:id` | remove a (real) node |
| `POST /api/nodes/:id/command` | queue downlink |
| `GET /api/alerts?active=1` · `POST /api/alerts/:id/acknowledge|resolve|dismiss` | alert lifecycle |
| `GET /api/events` | event log |
| `GET /api/system/health` · `GET/PUT /api/system/site` | server health, site dimensions |
| `GET /api/system/sim` · `POST /api/system/sim/start|stop|scenario|intruder` | simulator |
| `POST /api/system/record` `{nodeId,label,seconds}` · `/record/stop` · `GET /record/:nodeId` | ML recorder |
| `GET/POST /api/system/zones` · `PUT/DELETE /api/system/zones/:id` | zone polygons `{name, type: restricted|watch|allowed, points:[[x,y]…]}` |
| `GET/POST /api/system/arming` · `PUT /api/system/arming/schedule` | `{mode: ARMED|TEST|DISARMED}` · `{enabled, armAt:"22:00", disarmAt:"06:00"}` |
| `GET /api/system/activity` · `DELETE` | heat-map cells, hour-of-day and last-24 h histograms |
| `GET /api/system/notify` · `POST /notify/test` · `POST /api/system/siren` | notification channel status, test message, Pi GPIO siren `{on, seconds}` |
| `POST /api/system/alerts/acknowledge-all` | acknowledge every ACTIVE alert |
| `GET /api/alerts/:id` | full alert incl. replay `frames` |
| `POST /api/system/sim/tamper` | simulate a tamper on a simulated node |
| `POST /api/breach-check` | **unchanged** OSINT breach checker (`{query, limit?, lang?}`) |

## WebSocket (`/ws`)

Messages `{type, data, ts}`: `hello` (full snapshot incl. `arming`, `activity`, `notify`, `site.zones`), `node` (public node + fresh `wave` snapshot), `tracks` (with `speed`, `headingDeg`, `running`, `predicted`, `eta`, `method`, `zone`), `alert` (`{action, alert}` — `kind` INTRUSION|TAMPER|LOITER, `test`, `zone`, `kinematics`), `event`, `sim`, `site`, `arming`, `nodeRemoved`.
