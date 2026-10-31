/**
 * CYBER CHAUKIDAAR — battery-powered perimeter sentry node (ESP32 / ESP32-S3)
 *
 *   2 × ADXL345 ground probes  → band-pass → STA/LTA picker → 10 features → random forest
 *   1 × human-presence radar   → distance / energy (LD2410 binary, LD2420 text, LD1125H text)
 *   WS2812 ring + buzzer       → state, bearing-to-target, deterrent (optional)
 *   WiFi | BLE | LoRa uplink   → central server (Raspberry Pi)
 *
 * Power profile
 *   ECO   : probes at 25 Hz low-power, ESP32 light-sleeps 1 s between FIFO drains, radar OFF
 *           (when gated), radio OFF except a heartbeat every HEARTBEAT_ECO_S.
 *   ACTIVE: probes at 100 Hz, radar ON, features + ML every second, uplink every second,
 *           drops back to ECO after ACTIVE_HOLD_S quiet seconds.
 *   LIVE  : ACTIVE but streams 4 packets/s with waveform snapshots (dashboard / ML recording).
 */
#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <math.h>
#include "config.h"
#include "settings.h"
#include "indicators.h"
#include "sensors/adxl345.h"
#include "sensors/radar.h"
#include "dsp/filters.h"
#include "dsp/features.h"
#include "ml/classifier.h"
#include "power/power.h"
#include "comm/packet.h"
#if defined(TRANSPORT_BLE)
#include "comm/ble_transport.h"
#elif defined(TRANSPORT_LORA)
#include "comm/lora_transport.h"
#else
#include "comm/wifi_transport.h"
#endif

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

String consoleReadLine(); // settings.cpp

// ------------------------------------------------------------------ peripherals
#if defined(ADXL_USE_SPI)
static ADXL345 adxlA(PIN_ADXL_A_CS, &SPI);
static ADXL345 adxlB(PIN_ADXL_B_CS, &SPI);
#else
static ADXL345 adxlA(ADXL_A_ADDR);
static ADXL345 adxlB(ADXL_B_ADDR);
#endif
#if defined(BOARD_S3)
static HardwareSerial& radarSerial = Serial1;
#else
static HardwareSerial& radarSerial = Serial2;
#endif
static Radar radar(radarSerial, PIN_RADAR_RX, PIN_RADAR_TX, PIN_RADAR_OUT, PIN_RADAR_POWER);
static Power power(PIN_BATTERY_ADC, BATTERY_DIVIDER);
#if defined(TRANSPORT_BLE)
static BleTransport transportImpl;
#elif defined(TRANSPORT_LORA)
static LoRaTransport transportImpl;
#else
static WiFiTransport transportImpl;
#endif
static Transport& transport = transportImpl;

// ------------------------------------------------------------------ DSP state
struct Probe {
    explicit Probe(ADXL345* d) : dev(d) {}
    ADXL345* dev;
    VibrationFilter filter;
    StaLta picker;
    Ring<256> ring;
    ADXL345::Sample last = {0, 0, 1};
    bool ok = false;
    uint32_t samples = 0;
};
static Probe probeA(&adxlA);
static Probe probeB(&adxlB);

// ------------------------------------------------------------------ modes
enum class Mode { ECO, LIVE };
enum class State { IDLE, SUSPECT, EVENT };
static Mode mode = Mode::ECO;
static State state = State::IDLE;
static bool active = false;
static uint16_t fs = FS_ACTIVE_HZ;

static uint32_t seq = 0;
static uint32_t lastTxMs = 0;
static uint32_t lastHeartbeatMs = 0;
static uint32_t lastAnalysisMs = 0;
static uint32_t lastActivityMs = 0;
static uint32_t liveUntilMs = 0;
static uint32_t radarOnMs = 0;
static uint32_t bootMs = 0;

static Features lastFeatures;
static bool haveFeatures = false;
static MlResult lastMl;
static bool haveMl = false;
static XCorrResult lastXcorr = {0, 0};

// ------------------------------------------------------------------ tamper state
static float gravX = 0, gravY = 0, gravZ = 1;      // slow EMA of probe A raw acceleration
static float baseX = 0, baseY = 0, baseZ = 1;      // calibrated rest orientation
static bool  baseValid = false;
static float tiltDeg = 0;
static uint32_t tamperUntilMs = 0;
static uint32_t impactUntilMs = 0;
static bool  calibratedFlag = false;

// ------------------------------------------------------------------ helpers
static void led(bool on) {
    if (PIN_STATUS_LED >= 0) digitalWrite(PIN_STATUS_LED, on ? HIGH : LOW);
}

static void configureSampling(uint16_t rateHz, bool lowPower) {
    fs = rateHz;
    for (Probe* p : {&probeA, &probeB}) {
        p->filter.configure(fs, HP_CUTOFF_HZ, LP_CUTOFF_HZ);
        p->picker.configure(fs, STA_SECONDS, LTA_SECONDS, STA_LTA_TRIGGER, STA_LTA_RELEASE, RMS_TRIGGER_G);
        p->ring.clear();
        if (p->ok) p->dev->setRate(fs, lowPower);
    }
}

static void updateTamper(const ADXL345::Sample& raw) {
    if (millis() - bootMs < 3000) { gravX = raw.x; gravY = raw.y; gravZ = raw.z; return; }   // ignore power-on garbage
    const float a = fs >= 100 ? 0.02f : 0.08f;
    gravX += a * (raw.x - gravX); gravY += a * (raw.y - gravY); gravZ += a * (raw.z - gravZ);
    float mag = sqrtf(raw.x * raw.x + raw.y * raw.y + raw.z * raw.z);
    if (mag > TAMPER_SHOCK_G) { impactUntilMs = millis() + 10000; tamperUntilMs = millis() + 30000; }
    if (!baseValid) return;
    float dot = gravX * baseX + gravY * baseY + gravZ * baseZ;
    float n1 = sqrtf(gravX * gravX + gravY * gravY + gravZ * gravZ);
    float n2 = sqrtf(baseX * baseX + baseY * baseY + baseZ * baseZ);
    float c = (n1 > 1e-3f && n2 > 1e-3f) ? dot / (n1 * n2) : 1.0f;
    if (c > 1.0f) c = 1.0f;
    if (c < -1.0f) c = -1.0f;
    tiltDeg = acosf(c) * 180.0f / (float)M_PI;
    if (tiltDeg > TAMPER_TILT_DEG) tamperUntilMs = millis() + 30000;
}

static void drainProbe(Probe& p) {
    if (!p.ok) return;
    ADXL345::Sample buf[32];
    uint8_t n = p.dev->readFifo(buf, 32);
    for (uint8_t i = 0; i < n; i++) {
        float mag = sqrtf(buf[i].x * buf[i].x + buf[i].y * buf[i].y + buf[i].z * buf[i].z);
        float v = p.filter.process(mag);
        p.ring.push(v);
        p.picker.update(fabsf(v));
        p.last = buf[i];
        p.samples++;
        if (&p == &probeA) updateTamper(buf[i]);
    }
}

static ProbeSummary summarize(Probe& p) {
    ProbeSummary s;
    s.ok = p.ok;
    s.x = p.last.x; s.y = p.last.y; s.z = p.last.z;
    s.rms = p.ring.rms(fs);
    s.peak = p.ring.peak(fs);
    s.staLta = p.picker.ratio();
    return s;
}

static void calibrateRest() {
    baseX = gravX; baseY = gravY; baseZ = gravZ;
    baseValid = true;
    tiltDeg = 0;
    tamperUntilMs = 0;
    probeA.picker.reset();
    probeB.picker.reset();
    calibratedFlag = true;
    indicators.calibratedFeedback();
    Serial.printf("[node] calibrated rest orientation (%.2f, %.2f, %.2f)\n", baseX, baseY, baseZ);
}

static void startDeterrent(uint32_t seconds) {
    indicators.deterrent(seconds);
    Serial.printf("[node] deterrent burst for %lu s\n", (unsigned long)seconds);
}

static void enterActive(const char* why) {
    if (active) return;
    active = true;
    lastActivityMs = millis();
    configureSampling(FS_ACTIVE_HZ, false);
    radar.power(true);
    radarOnMs = millis();
    if (PIN_RADAR_POWER >= 0) { delay(50); radar.configureLd2410(); }
    led(true);
    indicators.setMode(Indicators::Mode::ACTIVE);
    Serial.printf("[node] ACTIVE (%s)\n", why);
}

static void leaveActive() {
    if (!active) return;
    active = false;
    state = State::IDLE;
    radar.power(false);
    transport.disconnect();
    configureSampling(FS_ECO_HZ, true);
    haveFeatures = false; haveMl = false;
    led(false);
    indicators.setMode(Indicators::Mode::ECO);
    Serial.println("[node] ECO (quiet)");
}

static void applyDownlink(const Downlink& d) {
    if (d.reboot) { Serial.println("[node] reboot requested"); delay(100); ESP.restart(); }
    if (d.calibrate) calibrateRest();
    if (d.deterS > 0) startDeterrent((uint32_t)(d.deterS > 120 ? 120 : d.deterS));
    if (d.hasMode) {
        if (d.live) {
            mode = Mode::LIVE;
            liveUntilMs = millis() + (uint32_t)(d.liveFor > 0 ? d.liveFor : LIVE_DEFAULT_S) * 1000UL;
            enterActive("dashboard LIVE");
            Serial.printf("[node] LIVE for %lu s\n", (unsigned long)((liveUntilMs - millis()) / 1000));
        } else {
            mode = Mode::ECO;
            lastActivityMs = 0;
            Serial.println("[node] ECO requested by server");
        }
    }
}

static const char* stateName(State s) { return s == State::EVENT ? "EVENT" : (s == State::SUSPECT ? "SUSPECT" : "IDLE"); }

static bool sendPacket(bool withWave) {
    static float wa[WAVE_SNAPSHOT_SAMPLES], wb[WAVE_SNAPSHOT_SAMPLES];
    PacketInput in;
    in.seq = ++seq;
    in.transport = transport.name();
    in.rssi = transport.rssi();
    in.mode = mode == Mode::LIVE ? "LIVE" : "ECO";
    in.state = stateName(state);
    in.battery = power.read();
    in.radar = radar.isPowered() ? &radar.reading() : nullptr;
    in.radarOk = radar.isPowered() ? (radar.healthy() || PIN_RADAR_OUT >= 0) : true;
    in.a = summarize(probeA);
    in.b = summarize(probeB);
    in.lagMs = lastXcorr.lagMs;
    in.corr = lastXcorr.corr;
    in.ratio = in.b.rms > 1e-5f ? in.a.rms / in.b.rms : 0;
    in.features = haveFeatures ? &lastFeatures : nullptr;
    in.ml = haveMl ? &lastMl : nullptr;
    in.waveN = 0; in.waveA = nullptr; in.waveB = nullptr; in.waveFs = fs;
    if (withWave) {
        uint8_t n = probeA.ring.latest(wa, WAVE_SNAPSHOT_SAMPLES);
        probeB.ring.latest(wb, WAVE_SNAPSHOT_SAMPLES);
        in.waveN = n; in.waveA = wa; in.waveB = wb;
    }
    in.tempC = temperatureRead();
    in.tiltDeg = tiltDeg;
    in.tamper = (int32_t)(millis() - tamperUntilMs) < 0;
    in.impact = (int32_t)(millis() - impactUntilMs) < 0;
    in.noiseFloor = probeA.picker.ltaRms();
    in.calibrated = calibratedFlag;
    calibratedFlag = false;

    String json = buildPacket(in);
#if SERIAL_PACKET_ECHO
    Serial.print(">>"); Serial.println(json);
#endif
    String reply;
    bool ok = transport.send(json, reply);
    if (ok) applyDownlink(parseReply(reply));
    else Serial.println("[node] uplink failed");
    return ok;
}

/** Rough relative bearing of the target (deg, + = right) from probe ratio + TDOA, same maths as the server. */
static bool estimateBearing(float& thetaDeg) {
    ProbeSummary a = summarize(probeA), b = summarize(probeB);
    if (!(a.ok && b.ok && a.rms > 0.02f && b.rms > 0.02f)) return false;
    float range = radar.isPowered() && radar.reading().presence && radar.reading().distanceM > 0.1f ? radar.reading().distanceM : 3.0f;
    float bias = (b.rms - a.rms) / (a.rms + b.rms);
    float sinAmp = constrain(2.0f * bias * range / (1.2f * PROBE_SPACING_M), -1.0f, 1.0f);
    float sinTdoa = constrain(-150.0f * (lastXcorr.lagMs / 1000.0f) / PROBE_SPACING_M, -1.0f, 1.0f);
    float w = lastXcorr.corr >= 0.5f ? constrain((lastXcorr.corr - 0.5f) / 0.4f, 0.3f, 0.7f) : 0.0f;
    float s = w * sinTdoa + (1.0f - w) * sinAmp;
    thetaDeg = asinf(constrain(s, -1.0f, 1.0f)) * 180.0f / (float)M_PI;
    return true;
}

static void analyse() {
    static float winA[WINDOW_SAMPLES], winB[WINDOW_SAMPLES];
    if (probeA.ring.count() < WINDOW_SAMPLES) return;
    uint16_t n = probeA.ring.latest(winA, WINDOW_SAMPLES);
    lastFeatures = extractFeatures(winA, n, fs);
    haveFeatures = true;
    lastMl = classifyVibration(lastFeatures);
    haveMl = true;
    if (probeB.ok && probeB.ring.count() >= WINDOW_SAMPLES) {
        probeB.ring.latest(winB, WINDOW_SAMPLES);
        lastXcorr = crossCorrelate(winA, winB, n, fs, 5);
    } else {
        lastXcorr = {0, 0};
    }

    bool seismic = probeA.picker.triggered() || probeB.picker.triggered() ||
                   ((lastMl.classIndex == 1 || lastMl.classIndex == 2) && lastFeatures.rms > RMS_TRIGGER_G * 0.7f);
    bool radarSees = radar.isPowered() && (radar.reading().presence || radar.outPinActive());
    bool tamperNow = (int32_t)(millis() - tamperUntilMs) < 0;
    State next = State::IDLE;
    if (seismic && radarSees) next = State::EVENT;
    else if (seismic || radarSees) next = State::SUSPECT;
    if (next != state) Serial.printf("[node] %s -> %s  (ml=%s %.2f, rmsA=%.4f, radar=%s %.2fm)\n",
        stateName(state), stateName(next), lastMl.label, lastMl.probs[lastMl.classIndex],
        lastFeatures.rms, radarSees ? "yes" : "no", radar.reading().distanceM);
    state = next;
    if (seismic || radarSees || tamperNow) lastActivityMs = millis();

    // local indicators
    float theta;
    bool haveTheta = estimateBearing(theta);
    indicators.setBearing(theta, haveTheta);
    if (tamperNow) indicators.setMode(Indicators::Mode::TAMPER);
    else if (state == State::EVENT) indicators.setMode(Indicators::Mode::EVENT);
    else if (state == State::SUSPECT) indicators.setMode(Indicators::Mode::SUSPECT);
    else indicators.setMode(Indicators::Mode::ACTIVE);
}

static void handleConsole() {
    String line = consoleReadLine();
    if (!line.length()) return;
    if (settings.handleLine(line, Serial)) return;
    line.trim();
    if (line == "live") { Downlink d; d.hasMode = true; d.live = true; d.liveFor = LIVE_DEFAULT_S; applyDownlink(d); }
    else if (line == "eco") { Downlink d; d.hasMode = true; d.live = false; applyDownlink(d); }
    else if (line == "reboot") ESP.restart();
    else if (line == "calibrate") calibrateRest();
    else if (line == "deter") startDeterrent(10);
    else if (line == "status") {
        Battery b = power.read();
        Serial.printf("mode=%s active=%d state=%s fs=%u bat=%.2fV(%u%%) A=%s B=%s radar=%s(%s %.2fm) link=%s rssi=%d tilt=%.1f heap=%u\n",
            mode == Mode::LIVE ? "LIVE" : "ECO", active, stateName(state), fs, b.voltage, b.percent,
            probeA.ok ? "ok" : "MISSING", probeB.ok ? "ok" : "MISSING",
            radar.isPowered() ? "on" : "off", radar.reading().presence ? "presence" : "clear", radar.reading().distanceM,
            transport.isConnected() ? "up" : "down", transport.rssi(), tiltDeg, ESP.getFreeHeap());
    } else if (line == "help") {
        settings.print(Serial);
        Serial.println(F("extra: calibrate | deter | status | live | eco | reboot"));
    }
}

// ------------------------------------------------------------------ arduino
void setup() {
    bootMs = millis();
    Serial.begin(SERIAL_BAUD);
    delay(300);
    if (PIN_STATUS_LED >= 0) pinMode(PIN_STATUS_LED, OUTPUT);
    led(true);
    settings.load();
    indicators.begin();
    indicators.setMode(Indicators::Mode::ACTIVE);
    Serial.println();
    Serial.println(F("=========================================================="));
    Serial.printf("  CYBER CHAUKIDAAR SENTRY NODE  fw %s  id %s  wake=%s\n", FW_VERSION, settings.nodeId.c_str(), Power::wakeReason());
    Serial.println(F("=========================================================="));

    power.begin();
    Battery b = power.read();
    Serial.printf("[pwr] battery %.2f V (%u%%)\n", b.voltage, b.percent);

#if defined(ADXL_USE_SPI)
    SPI.begin(PIN_SPI_SCK, PIN_SPI_MISO, PIN_SPI_MOSI);
    probeA.ok = adxlA.begin();
    probeB.ok = adxlB.begin();
    Serial.printf("[adxl] SPI probe A (CS %d) %s, probe B (CS %d) %s\n", PIN_ADXL_A_CS, probeA.ok ? "OK" : "MISSING", PIN_ADXL_B_CS, probeB.ok ? "OK" : "MISSING");
#else
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 400000);
    probeA.ok = adxlA.begin(Wire);
    probeB.ok = adxlB.begin(Wire);
    Serial.printf("[adxl] I2C probe A @0x%02X %s, probe B @0x%02X %s\n", ADXL_A_ADDR, probeA.ok ? "OK" : "MISSING", ADXL_B_ADDR, probeB.ok ? "OK" : "MISSING");
#endif
    if (!probeA.ok && probeB.ok) { Serial.println("[adxl] probe A missing — using probe B as A"); probeA.dev = &adxlB; probeA.ok = true; probeB.ok = false; }

    radar.begin(RADAR_BAUD);
    radar.configureLd2410();
    Serial.printf("[radar] UART up @ %lu baud\n", (unsigned long)RADAR_BAUD);

    transport.begin();
    Serial.printf("[link] transport: %s  ssid: %s  server: %s\n", transport.name(), settings.wifiSsid.c_str(), settings.serverUrl.c_str());

    mode = settings.bootLive ? Mode::LIVE : Mode::ECO;
    configureSampling(FS_ACTIVE_HZ, false);
    if (mode == Mode::LIVE) { liveUntilMs = millis() + (uint32_t)LIVE_DEFAULT_S * 1000UL; enterActive("boot"); }
    else { active = true; leaveActive(); }

    delay(400);
    drainProbe(probeA); drainProbe(probeB);
    if (transport.connect()) { sendPacket(false); if (mode == Mode::ECO) transport.disconnect(); }
    else Serial.println("[link] could not join WiFi — check `cfg show` (ssid/password) and 2.4 GHz coverage");
    lastHeartbeatMs = millis();
    led(active);
}

void loop() {
    uint32_t now = millis();
    handleConsole();
    transport.poll();
    if (radar.isPowered()) radar.poll();
    drainProbe(probeA);
    drainProbe(probeB);
    indicators.update();
    if (!baseValid && now - bootMs > 3000) calibrateRest();
    bool tamperNow = (int32_t)(now - tamperUntilMs) < 0;

    if (!active) {
        // ---------------- ECO watch ----------------
        bool trig = probeA.picker.triggered() || probeB.picker.triggered() || radar.outPinActive() || tamperNow
                    || (radar.isPowered() && radar.reading().presence);   // hard-wired radar: its text output wakes us too
        if (trig) {
            enterActive(tamperNow ? "TAMPER" : radar.outPinActive() || radar.reading().presence ? "radar" : "seismic trigger");
            return;
        }
        if (now - lastHeartbeatMs >= (uint32_t)HEARTBEAT_ECO_S * 1000UL) {
            lastHeartbeatMs = now;
            led(true);
            if (transport.connect()) sendPacket(false);
            transport.disconnect();
            led(false);
            if (active) return;
        }
        if (indicators.deterrentActive()) { delay(20); return; }   // keep the strobe/buzzer animating
        power.lightSleep(ECO_LIGHT_SLEEP_MS, radar.isPowered() && PIN_RADAR_OUT >= 0 ? PIN_RADAR_OUT : -1);
        return;
    }

    // ---------------- ACTIVE / LIVE ----------------
    if (now - lastAnalysisMs >= 1000) {
        lastAnalysisMs = now;
        analyse();
    }
    bool live = mode == Mode::LIVE;
    uint32_t txInterval = live ? LIVE_TX_INTERVAL_MS : ACTIVE_TX_INTERVAL_MS;
    if (now - lastTxMs >= txInterval && now - radarOnMs >= (uint32_t)RADAR_WARMUP_MS / 3) {
        lastTxMs = now;
        sendPacket(live);
        lastHeartbeatMs = now;
    }
    if (live && (int32_t)(now - liveUntilMs) >= 0) {
        mode = Mode::ECO;
        Serial.println("[node] LIVE expired");
    }
    if (mode == Mode::ECO && (int32_t)(millis() - lastActivityMs) >= (int32_t)ACTIVE_HOLD_S * 1000) {   // signed: lastActivityMs may be newer than `now`
        leaveActive();
        return;
    }
    delay(20);
}
