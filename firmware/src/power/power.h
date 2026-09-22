#pragma once
#include <Arduino.h>

struct Battery {
    float   voltage;
    uint8_t percent;
    bool    low;
    bool    critical;
};

class Power {
public:
    Power(int adcPin, float divider) : _pin(adcPin), _div(divider) {}
    void begin();
    Battery read();
    /** Light sleep for `ms`; optional GPIO (active high) wakes early. Peripherals keep state. */
    void lightSleep(uint32_t ms, int wakePin = -1);
    /** Deep sleep; wakes on timer and on any of the given RTC pins going high. */
    void deepSleep(uint32_t ms, uint64_t rtcPinMask);
    static const char* wakeReason();
private:
    int _pin;
    float _div;
    static uint8_t percentFromVoltage(float v);
};
