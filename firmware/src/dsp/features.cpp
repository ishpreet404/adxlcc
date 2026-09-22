#include "features.h"
#include <math.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

void fftRadix2(float* re, float* im, uint16_t n) {
    // bit reversal
    uint16_t j = 0;
    for (uint16_t i = 1; i < n; i++) {
        uint16_t bit = n >> 1;
        while (j & bit) { j ^= bit; bit >>= 1; }
        j |= bit;
        if (i < j) {
            float t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }
    for (uint16_t len = 2; len <= n; len <<= 1) {
        float ang = -2.0f * (float)M_PI / len;
        float wr = cosf(ang), wi = sinf(ang);
        for (uint16_t start = 0; start < n; start += len) {
            float cr = 1, ci = 0;
            uint16_t half = len >> 1;
            for (uint16_t k = 0; k < half; k++) {
                uint16_t a = start + k, b = a + half;
                float tr = re[b] * cr - im[b] * ci;
                float ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr; im[b] = im[a] - ti;
                re[a] += tr; im[a] += ti;
                float ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
        }
    }
}

Features extractFeatures(const float* window, uint16_t n, float fs) {
    Features f;
    memset(&f, 0, sizeof(f));
    if (n < 8) return f;
    if (n > 256) n = 256;

    static float sig[256], re[256], im[256];
    float mean = 0;
    for (uint16_t i = 0; i < n; i++) mean += window[i];
    mean /= n;

    float sumSq = 0, mn = 1e9f, mx = -1e9f, maxAbs = 0;
    for (uint16_t i = 0; i < n; i++) {
        float v = window[i] - mean;
        sig[i] = v;
        sumSq += v * v;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
        float a = fabsf(v);
        if (a > maxAbs) maxAbs = a;
    }
    f.rms = sqrtf(sumSq / n);
    f.variance = sumSq / n;
    f.peak = maxAbs;
    f.peakToPeak = mx - mn;
    f.crestFactor = f.rms > 1e-6f ? maxAbs / f.rms : 0;

    uint16_t zc = 0;
    for (uint16_t i = 1; i < n; i++)
        if ((sig[i - 1] < 0 && sig[i] >= 0) || (sig[i - 1] >= 0 && sig[i] < 0)) zc++;
    f.zeroCrossingRate = zc / (n / fs);

    uint16_t size = 1;
    while (size < n) size <<= 1;
    for (uint16_t i = 0; i < size; i++) { re[i] = i < n ? sig[i] : 0; im[i] = 0; }
    fftRadix2(re, im, size);
    float maxMag = -1, domFreq = 0, energy = 0, wsum = 0, msum = 0;
    for (uint16_t k = 1; k < size / 2; k++) {
        float m = sqrtf(re[k] * re[k] + im[k] * im[k]) / size;
        float fr = k * fs / size;
        energy += m * m;
        wsum += fr * m;
        msum += m;
        if (m > maxMag) { maxMag = m; domFreq = fr; }
    }
    f.dominantFrequency = domFreq;
    f.spectralEnergy = energy;
    f.spectralCentroid = msum > 0 ? wsum / msum : 0;

    float thr = maxAbs * 0.45f;
    int refractory = (int)(0.06f * fs);
    int last = -10000;
    float sumInt = 0;
    uint16_t cnt = 0;
    for (int i = 1; i < (int)n - 1; i++) {
        if (sig[i] > thr && sig[i] > sig[i - 1] && sig[i] >= sig[i + 1]) {
            if (i - last >= refractory) {
                if (last >= 0) { sumInt += (i - last) / fs * 1000.0f; cnt++; }
                last = i;
            }
        }
    }
    f.interPeakInterval = cnt ? sumInt / cnt : 0;
    return f;
}

XCorrResult crossCorrelate(const float* a, const float* b, uint16_t n, float fs, uint8_t maxLag) {
    XCorrResult r = {0, 0};
    if (n < 32) return r;
    float ma = 0, mb = 0;
    for (uint16_t i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    float ea = 0, eb = 0;
    for (uint16_t i = 0; i < n; i++) { ea += (a[i] - ma) * (a[i] - ma); eb += (b[i] - mb) * (b[i] - mb); }
    float norm = sqrtf(ea * eb);
    if (norm < 1e-9f) return r;
    float corrs[16];
    int count = 2 * maxLag + 1;
    if (count > 16) count = 16;
    float best = -2; int bestIdx = 0;
    for (int li = 0; li < count; li++) {
        int lag = li - maxLag;
        float s = 0;
        for (int i = 0; i < (int)n; i++) {
            int j = i + lag;
            if (j < 0 || j >= (int)n) continue;
            s += (a[i] - ma) * (b[j] - mb);
        }
        corrs[li] = s / norm;
        if (corrs[li] > best) { best = corrs[li]; bestIdx = li; }
    }
    float frac = 0;
    if (bestIdx > 0 && bestIdx < count - 1) {
        float y0 = corrs[bestIdx - 1], y1 = corrs[bestIdx], y2 = corrs[bestIdx + 1];
        float den = y0 - 2 * y1 + y2;
        if (fabsf(den) > 1e-9f) frac = 0.5f * (y0 - y2) / den;
    }
    r.lagMs = ((bestIdx - maxLag) + frac) * 1000.0f / fs;
    r.corr = best > 0 ? best : 0;
    return r;
}
