"""
Cyber Chaukidaar - Synthetic seismic waveform generator (v2).

Generates physically-motivated 100 Hz ground-vibration windows for four classes
so the classifier can be trained before any real data has been logged, and
augmented afterwards with real recordings (see train.py --real).

v2 adds the variability that broke the v1 model in practice: soil-dependent ring
frequency and damping, heel/toe double strikes, two walkers, windows that only
partly contain steps, passing vehicles with amplitude ramps, rain (impulse trains),
gusty wind and distant machinery, and a wide range of noise floors and amplitudes.

Classes
  0 NORMAL        ambient noise floor
  1 HUMAN         footsteps: impulsive strikes at 1.3-2.9 Hz cadence
  2 VEHICLE       continuous engine/chassis rumble 12-48 Hz with harmonics
  3 ENVIRONMENT   wind / rain / distant machinery: broadband, no walking rhythm

Pure Python, no numpy.
"""

import math
import random

from features import FS, WINDOW

CLASSES = ["NORMAL", "HUMAN", "VEHICLE", "ENVIRONMENT"]


def _noise(n, sigma):
    return [random.gauss(0.0, sigma) for _ in range(n)]


def _lowpass(sig, alpha):
    out = []
    y = 0.0
    for v in sig:
        y = y + alpha * (v - y)
        out.append(y)
    return out


def _pulse(t, amp, f_ring, decay):
    if t < 0:
        return 0.0
    return amp * math.exp(-t * decay) * math.sin(2 * math.pi * f_ring * t)


def _add_drift(sig):
    """Slow tilt/thermal drift that the band-pass would not fully remove."""
    if random.random() < 0.3:
        f = random.uniform(0.2, 0.8)
        a = random.uniform(0.002, 0.01)
        ph = random.uniform(0, 6.28)
        for i in range(len(sig)):
            sig[i] += a * math.sin(2 * math.pi * f * i / FS + ph)
    return sig


def _faint_hum(sig, n):
    """Mains / fan / fridge hum at a few milli-g: tonal but far too weak to be a vehicle."""
    f = random.uniform(8.0, 48.0)
    amp = random.uniform(0.001, 0.012)
    ph = random.uniform(0, 6.28)
    for i in range(n):
        sig[i] += amp * math.sin(2 * math.pi * f * i / FS + ph)
    return sig


def gen_normal(n=WINDOW):
    sigma = random.uniform(0.001, 0.03)
    sig = _noise(n, sigma)
    if random.random() < 0.5:
        sig = _lowpass(sig, random.uniform(0.2, 0.9))
    if random.random() < 0.35:
        sig = _faint_hum(sig, n)
    return _add_drift(sig)


def _walker(sig, n, amp_scale=1.0, noise_sigma=0.01):
    cadence = random.uniform(1.3, 2.9)              # steps per second
    period = 1.0 / cadence
    # a strike the STA/LTA picker could never see is not a "human" window: keep SNR >= ~3
    amp = random.uniform(max(0.03, 3.0 * noise_sigma), 0.7) * amp_scale
    f_ring = random.uniform(4.0, 28.0)              # soil-dependent
    decay = random.uniform(5.0, 28.0)
    double = random.random() < 0.4                  # heel + toe
    dt = 1.0 / FS
    # partial window: steps only present in part of the window
    t_start = 0.0
    t_end = n * dt + period
    if random.random() < 0.25:
        if random.random() < 0.5:
            t_start = random.uniform(0.3, 0.7) * n * dt
        else:
            t_end = random.uniform(0.4, 0.8) * n * dt
    phase = random.uniform(0.0, period)
    steps = []
    t = -phase
    while t < t_end:
        if t >= t_start - 0.5:
            steps.append(t + random.gauss(0.0, 0.035 * period))
        t += period
    for i in range(n):
        ti = i * dt
        for k, ts in enumerate(steps):
            tau = ti - ts
            if 0 <= tau < 0.5:
                a = amp * (1.0 if k % 2 == 0 else random.uniform(0.55, 0.95))
                sig[i] += _pulse(tau, a, f_ring, decay)
                if double:
                    sig[i] += _pulse(tau - random.uniform(0.08, 0.14), a * 0.5, f_ring * 1.3, decay * 1.4)
    return sig


def gen_human(n=WINDOW):
    sigma = random.uniform(0.003, 0.025)
    sig = _noise(n, sigma)
    sig = _walker(sig, n, noise_sigma=sigma)
    if random.random() < 0.2:                       # a second person
        sig = _walker(sig, n, amp_scale=random.uniform(0.4, 0.8), noise_sigma=sigma)
    return _add_drift(sig)


def gen_vehicle(n=WINDOW):
    sigma = random.uniform(0.005, 0.04)
    sig = _noise(n, sigma)
    f_engine = random.uniform(12.0, 48.0)
    amp = random.uniform(max(0.04, 3.0 * sigma), 0.8)
    mod_f = random.uniform(0.2, 2.5)
    harmonics = random.randint(1, 4)
    dt = 1.0 / FS
    # passing vehicle: amplitude ramps up and down inside the window
    passing = random.random() < 0.4
    centre = random.uniform(0.2, 0.8) * n * dt
    width = random.uniform(0.5, 1.5)
    for i in range(n):
        t = i * dt
        env = 0.7 + 0.3 * math.sin(2 * math.pi * mod_f * t)
        if passing:
            env *= math.exp(-((t - centre) / width) ** 2) + 0.15
        v = 0.0
        for h in range(1, harmonics + 1):
            v += (amp / h) * math.sin(2 * math.pi * f_engine * h * t + h + random.gauss(0, 0.05))
        sig[i] += env * v
    return _add_drift(sig)


def gen_environment(n=WINDOW):
    kind = random.random()
    if kind < 0.45:
        # gusty wind: low-passed noise with a slow envelope
        sigma = random.uniform(0.01, 0.15)
        sig = _noise(n, sigma)
        sig = _lowpass(sig, random.uniform(0.1, 0.6))
        gust_f = random.uniform(0.1, 0.6)
        gain = random.uniform(1.5, 5.0)
        for i in range(n):
            sig[i] *= gain * (0.6 + 0.4 * math.sin(2 * math.pi * gust_f * i / FS + random.random()))
    elif kind < 0.75:
        # rain / hail: random small impulses at a high rate (no walking rhythm)
        sig = _noise(n, random.uniform(0.003, 0.02))
        rate = random.uniform(3.0, 25.0)           # drops per second
        dt = 1.0 / FS
        t = 0.0
        drops = []
        while t < n * dt:
            t += random.expovariate(rate)
            drops.append(t)
        for i in range(n):
            ti = i * dt
            for td in drops:
                tau = ti - td
                if 0 <= tau < 0.12:
                    sig[i] += _pulse(tau, random.uniform(0.01, 0.12), random.uniform(20, 45), random.uniform(25, 60))
    else:
        # distant machinery / traffic: weak unstable tone plus broadband noise
        sig = _noise(n, random.uniform(0.01, 0.06))
        f = random.uniform(15.0, 45.0)
        amp = random.uniform(0.005, 0.04)
        for i in range(n):
            t = i / FS
            sig[i] += amp * math.sin(2 * math.pi * (f + random.gauss(0, 0.8)) * t) * (0.5 + 0.5 * random.random())
    # sometimes a single non-rhythmic thump (branch, door)
    if random.random() < 0.3:
        k = random.randint(5, n - 30)
        a = random.uniform(0.05, 0.3)
        for i in range(k, min(n, k + 30)):
            sig[i] += _pulse((i - k) / FS, a, random.uniform(3, 30), random.uniform(5, 30))
    return _add_drift(sig)


GENERATORS = {
    "NORMAL": gen_normal,
    "HUMAN": gen_human,
    "VEHICLE": gen_vehicle,
    "ENVIRONMENT": gen_environment,
}


def generate(per_class=400, seed=7):
    random.seed(seed)
    windows = []
    for idx, name in enumerate(CLASSES):
        gen = GENERATORS[name]
        for _ in range(per_class):
            windows.append((gen(), idx))
    random.shuffle(windows)
    return windows
