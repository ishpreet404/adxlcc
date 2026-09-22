#pragma once
#include <Arduino.h>
#include <Wire.h>

/**
 * ADXL345 driver tuned for seismic sensing:
 *  - full resolution ±4 g (3.9 mg/LSB)
 *  - hardware FIFO in stream mode, burst-drained so the ESP32 can sleep between reads
 *  - low-power ODR switching (25 Hz watch / 100 Hz analysis)
 *  - optional activity interrupt for the deep-sleep profile
 */
class ADXL345 {
public:
    struct Sample { float x, y, z; };

    explicit ADXL345(uint8_t address) : _addr(address) {}

    bool begin(TwoWire& wire = Wire);
    bool isConnected();
    /** rateHz: 25 or 100 (others rounded to nearest supported). lowPower: LOW_POWER bit. */
    void setRate(uint16_t rateHz, bool lowPower);
    /** Drain up to `maxSamples` from the FIFO. Returns count. */
    uint8_t readFifo(Sample* out, uint8_t maxSamples);
    uint8_t fifoCount();
    bool readSample(Sample& s);
    void enableActivityInterrupt(float thresholdG); // for deep-sleep wake on INT1
    void disableInterrupts();
    void standby(bool on);
    uint8_t address() const { return _addr; }
    bool ok() const { return _ok; }

private:
    uint8_t _addr;
    bool _ok = false;
    TwoWire* _wire = nullptr;
    uint8_t readReg(uint8_t reg);
    void writeReg(uint8_t reg, uint8_t val);
    bool readRegs(uint8_t reg, uint8_t* buf, uint8_t len);
};
