#pragma once
#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>

/**
 * ADXL345 driver tuned for seismic sensing, usable over I2C (address) or 4-wire SPI (chip select):
 *  - full resolution ±4 g (3.9 mg/LSB)
 *  - hardware FIFO in stream mode, burst-drained so the ESP32 can sleep between reads
 *  - low-power ODR switching (25 Hz watch / 100 Hz analysis)
 *  - optional activity interrupt for the deep-sleep profile
 */
class ADXL345 {
public:
    struct Sample { float x, y, z; };

    /** I2C variant (SDO low → 0x53, SDO high → 0x1D). */
    explicit ADXL345(uint8_t address) : _addr(address), _cs(-1) {}
    /** SPI variant: chip-select pin on a shared SPI bus (SPI mode 3, ≤ 5 MHz). */
    ADXL345(int csPin, SPIClass* spi) : _addr(0), _cs(csPin), _spi(spi) {}

    bool begin(TwoWire& wire = Wire);
    bool isConnected();
    void setRate(uint16_t rateHz, bool lowPower);
    uint8_t readFifo(Sample* out, uint8_t maxSamples);
    uint8_t fifoCount();
    bool readSample(Sample& s);
    void enableActivityInterrupt(float thresholdG);
    void disableInterrupts();
    void standby(bool on);
    bool ok() const { return _ok; }
    bool usesSpi() const { return _cs >= 0; }

private:
    uint8_t _addr;
    int _cs;
    bool _ok = false;
    TwoWire* _wire = nullptr;
    SPIClass* _spi = nullptr;
    bool init();
    uint8_t readReg(uint8_t reg);
    void writeReg(uint8_t reg, uint8_t val);
    bool readRegs(uint8_t reg, uint8_t* buf, uint8_t len);
};
