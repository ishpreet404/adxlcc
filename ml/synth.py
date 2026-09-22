"""
Cyber Chaukidaar - Synthetic seismic waveform generator.

Generates physically-motivated 100 Hz ground-vibration windows for four classes
so the classifier can be trained before any real data has been logged, and
augmented afterwards with real recordings (see train.py --real).

Classes
  0 NORMAL        ambient noise floor
  1 HUMAN         footsteps: impulsive strikes at 1.4-2.6 Hz cadence, 5-25 Hz content
  2 VEHICLE       continuous engine/chassis rumble, 15-45 Hz, slow amplitude modulation
  3 ENVIRONMENT   wind gusts / rain / distant machinery: broadband, no rhythm

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


def _footstep_pulse(t, amp, f_ring, decay):
    """Damped ring at f_ring Hz - a ground strike."""
    if t < 0:
        return 0.0
    return amp * math.exp(-t * decay) * math.sin(2 * math.pi * f_ring * t)


def gen_normal(n=WINDOW):
    sigma = random.uniform(0.003, 0.02)
    sig = _noise(n, sigma)
    # occasional very small drift
    if random.random() < 0.4:
        sig = _lowpass(sig, random.uniform(0.3, 0.9))
    return sig


def gen_human(n=WINDOW):
    noise_sigma = random.uniform(0.004, 0.02)
    sig = _noise(n, noise_sigma)
    cadence = random.uniform(1.4, 2.6)              # steps per second
    period = 1.0 / cadence
    amp = random.uniform(0.06, 0.6)                 # strike amplitude (g)
    f_ring = random.uniform(6.0, 22.0)
    decay = random.uniform(8.0, 20.0)
    phase = random.uniform(0.0, period)
    dt = 1.0 / FS
    steps = []
    t = -phase
    while t < n * dt + period:
        steps.append(t + random.gauss(0.0, 0.03 * period))
        t += period
    for i in range(n):
        ti = i * dt
        for ts in steps:
            if 0 <= ti - ts < 0.5:
                # every other step is slightly weaker (left/right foot)
                a = amp * (1.0 if int(round((ts + phase) / period)) % 2 == 0 else random.uniform(0.6, 0.95))
                sig[i] += _footstep_pulse(ti - ts, a, f_ring, decay)
    return sig


def gen_vehicle(n=WINDOW):
    noise_sigma = random.uniform(0.01, 0.04)
    sig = _noise(n, noise_sigma)
    f_engine = random.uniform(15.0, 45.0)
    amp = random.uniform(0.08, 0.7)
    mod_f = random.uniform(0.3, 2.0)
    harmonics = random.randint(1, 3)
    dt = 1.0 / FS
    for i in range(n):
        t = i * dt
        env = 0.7 + 0.3 * math.sin(2 * math.pi * mod_f * t)
        v = 0.0
        for h in range(1, harmonics + 1):
            v += (amp / h) * math.sin(2 * math.pi * f_engine * h * t + h)
        sig[i] += env * v
    return sig


def gen_environment(n=WINDOW):
    sigma = random.uniform(0.02, 0.15)
    sig = _noise(n, sigma)
    # gusty: slow random envelope, mostly low-ish frequency broadband
    alpha = random.uniform(0.15, 0.6)
    sig = _lowpass(sig, alpha)
    gain = random.uniform(1.5, 4.0)
    sig = [v * gain for v in sig]
    # sometimes add a single non-rhythmic thump (branch fall / rain drop burst)
    if random.random() < 0.5:
        k = random.randint(5, n - 30)
        a = random.uniform(0.05, 0.3)
        for i in range(k, min(n, k + 30)):
            sig[i] += _footstep_pulse((i - k) / FS, a, random.uniform(3, 30), random.uniform(5, 30))
    return sig


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
