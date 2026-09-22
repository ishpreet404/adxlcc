#include "power.h"
#include <esp_sleep.h>
#include <driver/gpio.h>
#include <driver/rtc_io.h>

void Power::begin() {
    pinMode(_pin, INPUT);
    analogReadResolution(12);
    analogSetPinAttenuation(_pin, ADC_11db);
}

Battery Power::read() {
    // analogReadMilliVolts applies the factory eFuse calibration (much better than raw*3.3/4095)
    uint32_t sum = 0;
    for (int i = 0; i < 16; i++) { sum += analogReadMilliVolts(_pin); delayMicroseconds(100); }
    float pinV = (sum / 16.0f) / 1000.0f;
    Battery b;
    b.voltage = pinV * _div;
    b.percent = percentFromVoltage(b.voltage);
    b.low = b.percent <= 20;
    b.critical = b.percent <= 8;
    return b;
}

uint8_t Power::percentFromVoltage(float v) {
    // Li-ion 18650 open-circuit curve (light load)
    static const float pts[][2] = {
        {4.20f, 100}, {4.10f, 92}, {4.00f, 82}, {3.90f, 70}, {3.80f, 56}, {3.75f, 48},
        {3.70f, 38}, {3.65f, 28}, {3.60f, 18}, {3.50f, 9}, {3.40f, 4}, {3.30f, 1}, {3.20f, 0}
    };
    const int n = sizeof(pts) / sizeof(pts[0]);
    if (v >= pts[0][0]) return 100;
    if (v <= pts[n - 1][0]) return 0;
    for (int i = 0; i < n - 1; i++) {
        if (v <= pts[i][0] && v > pts[i + 1][0]) {
            float t = (v - pts[i + 1][0]) / (pts[i][0] - pts[i + 1][0]);
            return (uint8_t)(pts[i + 1][1] + t * (pts[i][1] - pts[i + 1][1]) + 0.5f);
        }
    }
    return 0;
}

void Power::lightSleep(uint32_t ms, int wakePin) {
    esp_sleep_enable_timer_wakeup((uint64_t)ms * 1000ULL);
    if (wakePin >= 0) {
        gpio_wakeup_enable((gpio_num_t)wakePin, GPIO_INTR_HIGH_LEVEL);
        esp_sleep_enable_gpio_wakeup();
    }
    esp_light_sleep_start();
    if (wakePin >= 0) gpio_wakeup_disable((gpio_num_t)wakePin);
}

void Power::deepSleep(uint32_t ms, uint64_t rtcPinMask) {
    esp_sleep_enable_timer_wakeup((uint64_t)ms * 1000ULL);
    if (rtcPinMask) esp_sleep_enable_ext1_wakeup(rtcPinMask, ESP_EXT1_WAKEUP_ANY_HIGH);
    esp_deep_sleep_start();
}

const char* Power::wakeReason() {
    switch (esp_sleep_get_wakeup_cause()) {
        case ESP_SLEEP_WAKEUP_TIMER: return "timer";
        case ESP_SLEEP_WAKEUP_EXT1:  return "sensor-int";
        case ESP_SLEEP_WAKEUP_GPIO:  return "gpio";
        default: return "power-on";
    }
}
