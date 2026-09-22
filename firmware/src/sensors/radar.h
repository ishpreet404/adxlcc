#pragma once
#include <Arduino.h>

/**
 * Human-presence radar driver.
 *  - HLK-LD2410 / LD2410B / LD2410C binary frames (F4 F3 F2 F1 ... F8 F7 F6 F5), 256000 baud
 *  - LD1125H-style ASCII lines ("mov, dis=2.31" / "occ, dis=1.9"), 115200 baud
 *  - plain digital OUT pin fallback (presence only)
 *  - optional power gating (P-MOSFET) so the radar only draws current when needed
 */
class Radar {
public:
    struct Reading {
        bool     valid = false;      // received a frame recently
        bool     presence = false;
        bool     moving = false;
        float    movingDistanceM = 0;
        uint8_t  movingEnergy = 0;   // 0-100
        float    stationaryDistanceM = 0;
        uint8_t  stationaryEnergy = 0;
        float    distanceM = 0;      // best distance estimate
        uint32_t lastFrameMs = 0;
    };

    Radar(HardwareSerial& serial, int rxPin, int txPin, int outPin, int powerPin)
        : _serial(serial), _rx(rxPin), _tx(txPin), _out(outPin), _pwr(powerPin) {}

    void begin(uint32_t baud);
    void power(bool on);
    bool isPowered() const { return _powered; }
    /** Pump the UART parser; call often. */
    void poll();
    const Reading& reading() const { return _r; }
    bool outPinActive() const;
    bool healthy() const { return _r.valid && millis() - _r.lastFrameMs < 3000; }
    /** LD2410: put the module into normal (basic) reporting mode. */
    void configureLd2410();

private:
    HardwareSerial& _serial;
    int _rx, _tx, _out, _pwr;
    bool _powered = false;
    Reading _r;
    uint8_t _buf[64];
    uint8_t _len = 0;
    String _ascii;
    void feedBinary(uint8_t b);
    void feedAscii(char c);
    void parseBasicFrame(const uint8_t* d, uint8_t n);
    void sendLd2410Cmd(const uint8_t* cmd, uint8_t len);
};
