#pragma once
#include <math.h>
#include <stdint.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

/** RBJ biquad (Direct Form I). */
class Biquad {
public:
    void setHighPass(float fs, float fc, float q = 0.7071f) {
        float w0 = 2.0f * (float)M_PI * fc / fs;
        float c = cosf(w0), s = sinf(w0);
        float alpha = s / (2.0f * q);
        float a0 = 1.0f + alpha;
        b0 = (1.0f + c) / 2.0f / a0; b1 = -(1.0f + c) / a0; b2 = b0;
        a1 = -2.0f * c / a0; a2 = (1.0f - alpha) / a0;
        reset();
    }
    void setLowPass(float fs, float fc, float q = 0.7071f) {
        float w0 = 2.0f * (float)M_PI * fc / fs;
        float c = cosf(w0), s = sinf(w0);
        float alpha = s / (2.0f * q);
        float a0 = 1.0f + alpha;
        b0 = (1.0f - c) / 2.0f / a0; b1 = (1.0f - c) / a0; b2 = b0;
        a1 = -2.0f * c / a0; a2 = (1.0f - alpha) / a0;
        reset();
    }
    inline float process(float x) {
        float y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        return y;
    }
    void reset() { x1 = x2 = y1 = y2 = 0; }
private:
    float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    float x1 = 0, x2 = 0, y1 = 0, y2 = 0;
};

/** Band-pass = HP → LP, for the vibration magnitude channel. */
class VibrationFilter {
public:
    void configure(float fs, float hpHz, float lpHz) {
        _hp.setHighPass(fs, hpHz);
        _lp.setLowPass(fs, lpHz < fs * 0.45f ? lpHz : fs * 0.45f);
    }
    inline float process(float x) { return _lp.process(_hp.process(x)); }
    void reset() { _hp.reset(); _lp.reset(); }
private:
    Biquad _hp, _lp;
};

/** Short-term / long-term average trigger with hysteresis (classic seismic picker). */
class StaLta {
public:
    void configure(float fs, float staS, float ltaS, float trig, float release, float floorG) {
        _aS = 1.0f / (fs * staS);
        _aL = 1.0f / (fs * ltaS);
        _trig = trig; _rel = release; _floor = floorG;
        reset();
    }
    /** feed |x|; returns true while triggered. */
    inline bool update(float absX) {
        float e = absX * absX;
        _sta += _aS * (e - _sta);
        // LTA freezes while triggered so the event doesn't inflate the reference
        if (!_on) _lta += _aL * (e - _lta);
        if (_lta < 1e-7f) _lta = 1e-7f;
        float ratio = _sta / _lta;
        float staRms = sqrtf(_sta);
        if (!_on && ratio > _trig && staRms > _floor) _on = true;
        else if (_on && (ratio < _rel || staRms < _floor * 0.6f)) _on = false;
        _ratio = ratio;
        return _on;
    }
    float ratio() const { return _ratio; }
    float staRms() const { return sqrtf(_sta); }
    float ltaRms() const { return sqrtf(_lta); }
    bool triggered() const { return _on; }
    void reset() { _sta = 1e-5f; _lta = 1e-4f; _on = false; _ratio = 0; }
private:
    float _aS = 0, _aL = 0, _trig = 3, _rel = 1.5f, _floor = 0.02f;
    float _sta = 0, _lta = 0, _ratio = 0;
    bool _on = false;
};

/** Fixed-size float ring buffer. */
template <uint16_t N>
class Ring {
public:
    inline void push(float v) { _buf[_head] = v; _head = (_head + 1) % N; if (_count < N) _count++; }
    uint16_t count() const { return _count; }
    /** Copy the newest `n` samples (oldest first) into out. Returns copied count. */
    uint16_t latest(float* out, uint16_t n) const {
        if (n > _count) n = _count;
        uint16_t start = (_head + N - n) % N;
        for (uint16_t i = 0; i < n; i++) out[i] = _buf[(start + i) % N];
        return n;
    }
    float rms(uint16_t n) const {
        if (n > _count) n = _count;
        if (!n) return 0;
        uint16_t start = (_head + N - n) % N;
        float ss = 0;
        for (uint16_t i = 0; i < n; i++) { float v = _buf[(start + i) % N]; ss += v * v; }
        return sqrtf(ss / n);
    }
    float peak(uint16_t n) const {
        if (n > _count) n = _count;
        uint16_t start = (_head + N - n) % N;
        float p = 0;
        for (uint16_t i = 0; i < n; i++) { float v = fabsf(_buf[(start + i) % N]); if (v > p) p = v; }
        return p;
    }
    void clear() { _head = 0; _count = 0; }
private:
    float _buf[N] = {0};
    uint16_t _head = 0, _count = 0;
};
