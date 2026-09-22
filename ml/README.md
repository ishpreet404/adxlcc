# Cyber Chaukidaar — ML pipeline

Two tiny, explainable models. Both train in seconds in plain Python (no numpy, no scikit-learn) and are exported for **two runtimes**: the Node.js server and the ESP32 firmware.

| Model | Type | Input | Output | Runs on |
|---|---|---|---|---|
| `vibration_rf` | Random forest, 8 trees, depth ≤ 6 (≈ 3 KB) | 10 seismic features from a 1.28 s window | `NORMAL / HUMAN / VEHICLE / ENVIRONMENT` + probabilities | ESP32 (edge) **and** server |
| `fusion_lr` | Logistic regression | radar presence/distance/energy, both probe RMS, dual corroboration, probe cross-correlation, RF probabilities | intrusion probability 0–1 | server |

## Features (contract shared by `features.py`, `firmware/src/dsp/features.cpp`, `server/src/ml/features.js`)

1. `rms` 2. `peak` 3. `peakToPeak` 4. `variance` 5. `dominantFrequency` 6. `spectralEnergy` 7. `spectralCentroid` 8. `interPeakInterval` (ms) 9. `zeroCrossingRate` (Hz) 10. `crestFactor`

Input is the band-passed (1–40 Hz) vibration magnitude at 100 Hz, DC removed.

## Train / export

```bash
python ml/train.py
```

Writes:

- `ml/models/vibration_rf.json`, `ml/models/fusion_lr.json`
- `server/src/ml/models/*.json` (copies the server loads at boot)
- `firmware/include/model_vibration.h` (flattened tree arrays, no malloc, no recursion)

## Adding real data

1. Run the server and the node.
2. Walk / drive / wait near the node while recording a labelled window set:
   ```bash
   curl -X POST http://<pi>:8787/api/system/record -H 'Content-Type: application/json' \
        -d '{"nodeId":"N1","label":"HUMAN","seconds":30}'
   ```
   The server saves `ml/data/<timestamp>_HUMAN.jsonl`.
3. Retrain with the real windows mixed in (they are weighted ×3):
   ```bash
   python ml/train.py --real ml/data
   ```
4. Rebuild the firmware so the ESP32 picks up the new header.

## Why these models

- Random forests are cheap to evaluate (a handful of comparisons per tree), need no normalisation and are robust to the heavy-tailed amplitude distributions seismic data have.
- Logistic regression for fusion keeps the final decision **auditable**: every alert shows the evidence terms and their weights in the dashboard.
