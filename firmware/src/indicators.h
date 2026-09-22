#pragma once
#include <Arduino.h>

/**
 * Local indicators: WS2812B ring + buzzer (both optional, pins in config.h).
 *  - the ring shows node state and, during an event, lights the LED facing the target
 *    (LED 0 must be mounted pointing along the node heading / radar direction, LEDs clockwise)
 *  - the buzzer chirps on state changes and sounds during a deterrent burst
 * Everything is non-blocking: call update() from loop().
 */
class Indicators {
public:
    enum class Mode { OFF, ECO, ACTIVE, SUSPECT, EVENT, TAMPER };

    void begin();
    void setMode(Mode m);
    /** Relative bearing of the target: degrees from heading, positive = right (clockwise). */
    void setBearing(float thetaDeg, bool valid);
    void deterrent(uint32_t seconds);
    bool deterrentActive() const { return _deterUntil && (int32_t)(millis() - _deterUntil) < 0; }
    void chirp(uint16_t ms = 60, uint16_t hz = 2500);
    void calibratedFeedback();
    void update();
    void off();

private:
    Mode _mode = Mode::OFF;
    float _theta = 0;
    bool _thetaValid = false;
    uint32_t _deterUntil = 0;
    uint32_t _buzzUntil = 0;
    uint32_t _lastFrame = 0;
    uint16_t _frame = 0;
    void buzzer(bool on, uint16_t hz = 2500);
    void render();
};

extern Indicators indicators;
