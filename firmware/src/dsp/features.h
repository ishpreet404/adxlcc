#pragma once
#include <stdint.h>

/** The 10-feature contract shared with ml/features.py and server/src/ml/features.js. */
struct Features {
    float rms, peak, peakToPeak, variance, dominantFrequency,
          spectralEnergy, spectralCentroid, interPeakInterval, zeroCrossingRate, crestFactor;
    const float* asArray() const { return &rms; }
};

/** Extract features from a window (DC removed internally). n must be ≤ 256. */
Features extractFeatures(const float* window, uint16_t n, float fs);

/** In-place radix-2 FFT (n power of two). */
void fftRadix2(float* re, float* im, uint16_t n);

struct XCorrResult { float lagMs; float corr; };
/** Normalised cross-correlation of b vs a over ±maxLag samples with parabolic refinement.
 *  lag > 0  ⇒ b lags a ⇒ probe A heard the wave first. */
XCorrResult crossCorrelate(const float* a, const float* b, uint16_t n, float fs, uint8_t maxLag = 5);
