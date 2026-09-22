#include "adxl345.h"

// registers
#define REG_DEVID          0x00
#define REG_THRESH_ACT     0x24
#define REG_ACT_INACT_CTL  0x27
#define REG_BW_RATE        0x2C
#define REG_POWER_CTL      0x2D
#define REG_INT_ENABLE     0x2E
#define REG_INT_MAP        0x2F
#define REG_INT_SOURCE     0x30
#define REG_DATA_FORMAT    0x31
#define REG_DATAX0         0x32
#define REG_FIFO_CTL       0x38
#define REG_FIFO_STATUS    0x39

#define SCALE_G            0.0039f   // full-resolution LSB

bool ADXL345::begin(TwoWire& wire) {
    _wire = &wire;
    _ok = (readReg(REG_DEVID) == 0xE5);
    if (!_ok) return false;
    writeReg(REG_POWER_CTL, 0x00);          // standby while configuring
    writeReg(REG_DATA_FORMAT, 0x09);        // FULL_RES | ±4 g
    writeReg(REG_INT_ENABLE, 0x00);
    writeReg(REG_FIFO_CTL, 0x9F);           // stream mode, watermark 31
    setRate(100, false);
    writeReg(REG_POWER_CTL, 0x08);          // measure
    delay(10);
    return true;
}

bool ADXL345::isConnected() { return readReg(REG_DEVID) == 0xE5; }

void ADXL345::setRate(uint16_t rateHz, bool lowPower) {
    uint8_t code;
    if (rateHz >= 400) code = 0x0C;
    else if (rateHz >= 200) code = 0x0B;
    else if (rateHz >= 100) code = 0x0A;
    else if (rateHz >= 50) code = 0x09;
    else if (rateHz >= 25) code = 0x08;
    else code = 0x07; // 12.5 Hz
    if (lowPower) code |= 0x10;
    writeReg(REG_BW_RATE, code);
}

uint8_t ADXL345::fifoCount() { return readReg(REG_FIFO_STATUS) & 0x3F; }

uint8_t ADXL345::readFifo(Sample* out, uint8_t maxSamples) {
    uint8_t n = fifoCount();
    if (n > maxSamples) n = maxSamples;
    uint8_t buf[6];
    uint8_t got = 0;
    for (uint8_t i = 0; i < n; i++) {
        // each 6-byte burst read of DATAX0..DATAZ1 pops one FIFO entry
        if (!readRegs(REG_DATAX0, buf, 6)) break;
        int16_t rx = (int16_t)((buf[1] << 8) | buf[0]);
        int16_t ry = (int16_t)((buf[3] << 8) | buf[2]);
        int16_t rz = (int16_t)((buf[5] << 8) | buf[4]);
        out[got].x = rx * SCALE_G;
        out[got].y = ry * SCALE_G;
        out[got].z = rz * SCALE_G;
        got++;
        delayMicroseconds(5); // ADXL345 needs 5 µs between FIFO reads
    }
    return got;
}

bool ADXL345::readSample(Sample& s) {
    uint8_t buf[6];
    if (!readRegs(REG_DATAX0, buf, 6)) return false;
    s.x = (int16_t)((buf[1] << 8) | buf[0]) * SCALE_G;
    s.y = (int16_t)((buf[3] << 8) | buf[2]) * SCALE_G;
    s.z = (int16_t)((buf[5] << 8) | buf[4]) * SCALE_G;
    return true;
}

void ADXL345::enableActivityInterrupt(float thresholdG) {
    uint8_t thr = (uint8_t)constrain(thresholdG / 0.0625f, 1.0f, 255.0f); // 62.5 mg/LSB
    writeReg(REG_THRESH_ACT, thr);
    writeReg(REG_ACT_INACT_CTL, 0xF0);      // activity: AC-coupled, X|Y|Z
    writeReg(REG_INT_MAP, 0x00);            // everything on INT1
    writeReg(REG_INT_ENABLE, 0x10);         // ACTIVITY
    readReg(REG_INT_SOURCE);                // clear
}

void ADXL345::disableInterrupts() { writeReg(REG_INT_ENABLE, 0x00); }

void ADXL345::standby(bool on) { writeReg(REG_POWER_CTL, on ? 0x00 : 0x08); }

uint8_t ADXL345::readReg(uint8_t reg) {
    uint8_t v = 0;
    readRegs(reg, &v, 1);
    return v;
}

void ADXL345::writeReg(uint8_t reg, uint8_t val) {
    _wire->beginTransmission(_addr);
    _wire->write(reg);
    _wire->write(val);
    _wire->endTransmission();
}

bool ADXL345::readRegs(uint8_t reg, uint8_t* buf, uint8_t len) {
    _wire->beginTransmission(_addr);
    _wire->write(reg);
    if (_wire->endTransmission(false) != 0) return false;
    uint8_t got = _wire->requestFrom((int)_addr, (int)len);
    if (got != len) { while (_wire->available()) _wire->read(); return false; }
    for (uint8_t i = 0; i < len; i++) buf[i] = _wire->read();
    return true;
}
