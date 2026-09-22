#include "indicators.h"
#include "config.h"
#if PIN_LED_RING >= 0
#include <Adafruit_NeoPixel.h>
static Adafruit_NeoPixel ring(LED_RING_COUNT, PIN_LED_RING, NEO_GRB + NEO_KHZ800);
#endif

Indicators indicators;

#define BUZZER_LEDC_CH 2

void Indicators::begin() {
#if PIN_LED_RING >= 0
    ring.begin();
    ring.setBrightness(LED_BRIGHTNESS);
    ring.clear();
    ring.show();
#endif
#if PIN_BUZZER >= 0
#if BUZZER_PASSIVE
    ledcSetup(BUZZER_LEDC_CH, 2500, 10);
    ledcAttachPin(PIN_BUZZER, BUZZER_LEDC_CH);
    ledcWrite(BUZZER_LEDC_CH, 0);
#else
    pinMode(PIN_BUZZER, OUTPUT);
    digitalWrite(PIN_BUZZER, LOW);
#endif
#endif
}

void Indicators::buzzer(bool on, uint16_t hz) {
#if PIN_BUZZER >= 0
#if BUZZER_PASSIVE
    if (on) { ledcWriteTone(BUZZER_LEDC_CH, hz); ledcWrite(BUZZER_LEDC_CH, 512); }
    else ledcWrite(BUZZER_LEDC_CH, 0);
#else
    (void)hz;
    digitalWrite(PIN_BUZZER, on ? HIGH : LOW);
#endif
#else
    (void)on; (void)hz;
#endif
}

void Indicators::chirp(uint16_t ms, uint16_t hz) {
    buzzer(true, hz);
    _buzzUntil = millis() + ms;
}

void Indicators::setMode(Mode m) {
    if (m == _mode) return;
    Mode prev = _mode;
    _mode = m;
    if (m == Mode::EVENT && prev != Mode::EVENT) chirp(120, 3000);
    else if (m == Mode::TAMPER) chirp(400, 1800);
    else if (m == Mode::SUSPECT && prev == Mode::ECO) chirp(40, 2200);
    render();
}

void Indicators::setBearing(float thetaDeg, bool valid) { _theta = thetaDeg; _thetaValid = valid; }

void Indicators::deterrent(uint32_t seconds) {
    _deterUntil = millis() + seconds * 1000UL;
    if (PIN_DETERRENT >= 0) { pinMode(PIN_DETERRENT, OUTPUT); digitalWrite(PIN_DETERRENT, HIGH); }
}

void Indicators::calibratedFeedback() {
    chirp(60, 2000);
#if PIN_LED_RING >= 0
    for (int i = 0; i < LED_RING_COUNT; i++) ring.setPixelColor(i, ring.Color(0, 60, 0));
    ring.show();
    delay(150);
#endif
}

void Indicators::off() {
    _mode = Mode::OFF;
    buzzer(false);
#if PIN_LED_RING >= 0
    ring.clear();
    ring.show();
#endif
}

void Indicators::update() {
    uint32_t now = millis();
    if (_buzzUntil && (int32_t)(now - _buzzUntil) >= 0 && !deterrentActive()) { _buzzUntil = 0; buzzer(false); }
    if (_deterUntil && (int32_t)(now - _deterUntil) >= 0) {
        _deterUntil = 0;
        buzzer(false);
        if (PIN_DETERRENT >= 0) digitalWrite(PIN_DETERRENT, LOW);
    }
    if (now - _lastFrame < 50) return;        // 20 fps animation
    _lastFrame = now;
    _frame++;
    if (deterrentActive()) buzzer((_frame / 5) % 2 == 0, 2800); // 4 beeps/s while deterring
    render();
}

void Indicators::render() {
#if PIN_LED_RING >= 0
    const int N = LED_RING_COUNT;
    ring.clear();
    if (deterrentActive()) {
        // full red strobe
        bool on = (_frame / 2) % 2 == 0;
        for (int i = 0; i < N; i++) ring.setPixelColor(i, on ? ring.Color(255, 0, 0) : 0);
        ring.show();
        return;
    }
    switch (_mode) {
        case Mode::OFF:
        case Mode::ECO:
            // a single dim breath every ~4 s so you can see it's alive without draining the cell
            if ((_frame % 80) < 6) ring.setPixelColor(0, ring.Color(0, 0, 25));
            break;
        case Mode::ACTIVE:
            ring.setPixelColor(0, ring.Color(0, 40, 60));
            break;
        case Mode::SUSPECT: {
            int k = _frame % N;                 // spinning amber
            ring.setPixelColor(k, ring.Color(200, 110, 0));
            ring.setPixelColor((k + N - 1) % N, ring.Color(60, 30, 0));
            break;
        }
        case Mode::EVENT: {
            uint8_t pulse = 120 + (uint8_t)(100.0f * fabsf(sinf(_frame * 0.25f)));
            if (_thetaValid) {
                // LED index: LED 0 at heading, clockwise = positive theta
                int idx = ((int)lroundf(_theta / (360.0f / N)) % N + N) % N;
                ring.setPixelColor(idx, ring.Color(pulse, 0, 0));
                ring.setPixelColor((idx + 1) % N, ring.Color(pulse / 4, 0, 0));
                ring.setPixelColor((idx + N - 1) % N, ring.Color(pulse / 4, 0, 0));
            } else {
                for (int i = 0; i < N; i++) ring.setPixelColor(i, ring.Color(pulse / 3, 0, 0));
            }
            break;
        }
        case Mode::TAMPER: {
            bool on = (_frame / 3) % 2 == 0;
            for (int i = 0; i < N; i++) ring.setPixelColor(i, on ? ring.Color(120, 0, 160) : 0);
            break;
        }
    }
    ring.show();
#endif
}
