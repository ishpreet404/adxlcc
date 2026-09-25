"""
Cyber Chaukidaar - Seismic feature extraction (reference implementation, v2).

This is the *reference* definition of the 15 features used by the vibration
classifier.  The same maths is implemented in:
  - firmware/src/dsp/features.cpp   (ESP32, C++)
  - server/src/ml/features.js       (Node.js)

Keep all three in sync.  Feature order is part of the model contract.

Input: a window of band-passed vibration samples (g units) sampled at FS Hz.
Output: dict of features.  Pure Python, no numpy required.
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
    # v2 additions
    "kurtosis",          # impulsiveness: footsteps are spiky (high), engines/wind are not
    "spectralFlatness",  # 0 = tonal (engine), 1 = white noise (wind / rain)
    "lowBandRatio",      # share of spectral energy in 1-8 Hz
    "highBandRatio",     # share of spectral energy in 20-50 Hz
    "cadenceStrength",   # autocorrelation of the envelope at walking lags (0.3-0.9 s)
]


def _fft_magnitudes(signal):
    """Radix-2 FFT magnitudes for bins 0 .. N/2-1 (pure python)."""
    n = len(signal)
    size = 1
    while size < n:
        size <<= 1
    re = list(signal) + [0.0] * (size - n)
    im = [0.0] * size

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
    sum_4 = 0.0
    mn = sig[0]
    mx = sig[0]
    max_abs = 0.0
    for v in sig:
        v2 = v * v
        sum_sq += v2
        sum_4 += v2 * v2
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
    kurtosis = (sum_4 / n) / (variance * variance) if variance > 1e-12 else 0.0
    if kurtosis > 50.0:
        kurtosis = 50.0

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
    low = 0.0
    high = 0.0
    log_sum = 0.0
    bins = 0
    for k in range(1, len(mags)):
        m = mags[k]
        f = k * fs / size
        e = m * m
        energy += e
        wsum += f * m
        msum += m
        if 1.0 <= f <= 8.0:
            low += e
        if 20.0 <= f <= 50.0:
            high += e
        log_sum += math.log(e + 1e-12)
        bins += 1
        if m > max_mag:
            max_mag = m
            dom_freq = f
    centroid = wsum / msum if msum > 0 else 0.0
    low_ratio = low / energy if energy > 1e-12 else 0.0
    high_ratio = high / energy if energy > 1e-12 else 0.0
    arith = energy / bins if bins else 0.0
    flatness = math.exp(log_sum / bins) / arith if bins and arith > 1e-12 else 0.0

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

    # cadence strength: normalised autocorrelation of the smoothed |signal| envelope
    env = []
    for i in range(n):
        lo = max(0, i - 2)
        hi = min(n, i + 3)
        env.append(sum(abs(sig[j]) for j in range(lo, hi)) / (hi - lo))
    emean = sum(env) / n
    env = [v - emean for v in env]
    e0 = sum(v * v for v in env)
    cadence = 0.0
    if e0 > 1e-12:
        lag_min = int(0.3 * fs)
        lag_max = min(int(0.9 * fs), n - 8)
        for lag in range(lag_min, lag_max + 1):
            s = 0.0
            for i in range(n - lag):
                s += env[i] * env[i + lag]
            r = s / e0
            if r > cadence:
                cadence = r
    if cadence > 1.0:
        cadence = 1.0

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
        "kurtosis": kurtosis,
        "spectralFlatness": flatness,
        "lowBandRatio": low_ratio,
        "highBandRatio": high_ratio,
        "cadenceStrength": cadence,
    }


def as_vector(features):
    return [float(features[k]) for k in FEATURE_ORDER]
