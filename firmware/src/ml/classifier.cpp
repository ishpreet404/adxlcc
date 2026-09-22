#include "classifier.h"
#include "model_vibration.h"

MlResult classifyVibration(const Features& f) {
    const float* x = f.asArray();
    float acc[ML_NUM_CLASSES] = {0};
    for (uint8_t t = 0; t < ML_NUM_TREES; t++) {
        int16_t idx = ML_TREE_ROOTS[t];
        // bounded walk: the deepest tree is < 32 levels
        for (uint8_t depth = 0; depth < 32; depth++) {
            const MlNode& n = ML_NODES[idx];
            if (n.leaf >= 0) {
                for (uint8_t c = 0; c < ML_NUM_CLASSES; c++) acc[c] += ML_LEAF_PROBS[n.leaf][c];
                break;
            }
            idx = (x[n.feature] <= n.threshold) ? n.left : n.right;
        }
    }
    MlResult r;
    uint8_t best = 0;
    for (uint8_t c = 0; c < ML_NUM_CLASSES && c < 4; c++) {
        r.probs[c] = acc[c] / ML_NUM_TREES;
        if (r.probs[c] > r.probs[best]) best = c;
    }
    r.classIndex = best;
    r.label = ML_CLASS_NAMES[best];
    return r;
}
