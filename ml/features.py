"""
Cyber Chaukidaar - Seismic feature extraction (reference implementation).

This is the *reference* definition of the 10 features used by the vibration
classifier.  The same maths is implemented in:
  - firmware/src/dsp/features.cpp   (ESP32, C++)
  - server/src/ml/features.js       (Node.js)

Keep all three in sync.  Feature order is part of the model contract.

Input: a window of high-pass filtered vibration samples (g units, DC removed)
sampled at FS Hz.  Output: dict of features.

Pure Python, no numpy required.
"""

import math

FS = 100.0            # ADXL345 output data rate used by the nodes
WINDOW = 128          # samples per analysis window (1.28 s)

FEATURE_ORDER = [
    "rms",
    "peak",
    "peakToPeak",
    "variance",
    "dominantFrequency",
    "spectralEnergy",
    "spectralCentroid",
    "interPeakInterval",
    "zeroCrossingRate",
    "crestFactor",
]


def _fft_magnitudes(signal):
    """Radix-2 FFT magnitudes for bins 1 .. N/2-1 (pure python)."""
    n = len(signal)
    # pad to power of two
    size = 1
    while size < n:
        size <<= 1
    re = list(signal) + [0.0] * (size - n)
    im = [0.0] * size

    # bit reversal
    j = 0
    for i in range(1, size):
        bit = size >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j |= bit
        if i < j:
            re[i], re[j] = re[j], re[i]
            im[i], im[j] = im[j], im[i]

    length = 2
    while length <= size:
        ang = -2.0 * math.pi / length
        wr, wi = math.cos(ang), math.sin(ang)
        for start in range(0, size, length):
            cr, ci = 1.0, 0.0
            half = length // 2
            for k in range(half):
                a = start + k
                b = a + half
                tr = re[b] * cr - im[b] * ci
                ti = re[b] * ci + im[b] * cr
                re[b] = re[a] - tr
                im[b] = im[a] - ti
                re[a] += tr
                im[a] += ti
                cr, ci = cr * wr - ci * wi, cr * wi + ci * wr
        length <<= 1

    half = size // 2
    mags = [math.sqrt(re[k] ** 2 + im[k] ** 2) / size for k in range(half)]
    return mags, size


def extract(signal, fs=FS):
    n = len(signal)
    if n < 8:
        return {k: 0.0 for k in FEATURE_ORDER}

    mean = sum(signal) / n
    sig = [v - mean for v in signal]

    sum_sq = 0.0
    mn = sig[0]
    mx = sig[0]
    max_abs = 0.0
    for v in sig:
        sum_sq += v * v
        if v < mn:
            mn = v
        if v > mx:
            mx = v
        a = abs(v)
        if a > max_abs:
            max_abs = a

    rms = math.sqrt(sum_sq / n)
    variance = sum_sq / n
    peak = max_abs
    p2p = mx - mn
    crest = peak / rms if rms > 1e-6 else 0.0

    # zero crossing rate (crossings per second)
    zc = 0
    for i in range(1, n):
        if (sig[i - 1] < 0 <= sig[i]) or (sig[i - 1] >= 0 > sig[i]):
            zc += 1
    zcr = zc / (n / fs)

    # spectral
    mags, size = _fft_magnitudes(sig)
    dom_freq = 0.0
    max_mag = -1.0
    energy = 0.0
    wsum = 0.0
    msum = 0.0
    for k in range(1, len(mags)):
        m = mags[k]
        f = k * fs / size
        energy += m * m
        wsum += f * m
        msum += m
        if m > max_mag:
            max_mag = m
            dom_freq = f
    centroid = wsum / msum if msum > 0 else 0.0

    # inter-peak interval (ms) between prominent peaks with a 60 ms refractory
    thr = max_abs * 0.45
    refractory = int(0.06 * fs)
    last = -10_000
    intervals = []
    for i in range(1, n - 1):
        if sig[i] > thr and sig[i] > sig[i - 1] and sig[i] >= sig[i + 1]:
            if i - last >= refractory:
                if last >= 0:
                    intervals.append((i - last) / fs * 1000.0)
                last = i
    ipi = sum(intervals) / len(intervals) if intervals else 0.0

    return {
        "rms": rms,
        "peak": peak,
        "peakToPeak": p2p,
        "variance": variance,
        "dominantFrequency": dom_freq,
        "spectralEnergy": energy,
        "spectralCentroid": centroid,
        "interPeakInterval": ipi,
        "zeroCrossingRate": zcr,
        "crestFactor": crest,
    }


def as_vector(features):
    return [float(features[k]) for k in FEATURE_ORDER]
