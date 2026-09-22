#pragma once
#include <stdint.h>
#include "dsp/features.h"

/** Edge inference of the random forest exported to include/model_vibration.h. */
struct MlResult {
    uint8_t classIndex;        // 0 NORMAL, 1 HUMAN, 2 VEHICLE, 3 ENVIRONMENT
    float   probs[4];
    const char* label;
};

MlResult classifyVibration(const Features& f);
