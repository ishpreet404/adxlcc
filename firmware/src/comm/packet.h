#pragma once
#include <Arduino.h>
#include "sensors/radar.h"
#include "dsp/features.h"
#include "ml/classifier.h"
#include "power/power.h"

struct ProbeSummary {
    bool ok;
    float x, y, z;      // last raw sample (g)
    float rms, peak;    // over the last second, band-passed
    float staLta;
};

struct PacketInput {
    uint32_t seq;
    const char* transport;
    int rssi;
    const char* mode;     // "LIVE" / "ECO"
    const char* state;    // "IDLE" / "SUSPECT" / "EVENT"
    Battery battery;
    const Radar::Reading* radar;
    bool radarOk;
    ProbeSummary a, b;
    float lagMs, corr, ratio;
    const Features* features;   // may be null
    const MlResult* ml;         // may be null
    const float* waveA;         // may be null
    const float* waveB;
    uint8_t waveN;
    uint16_t waveFs;
    float tempC;
    float tiltDeg;        // node body tilt from calibrated rest
    bool tamper;          // tilt or shock tamper flag (sticky for a while)
    bool impact;          // shock seen recently
    float noiseFloor;     // probe A long-term RMS (g)
    bool calibrated;      // set on the first packet after a calibration
    uint16_t offlineAlarms = 0;  // sirens sounded locally while the server was unreachable (reported once)
};

/** Build the v2 JSON uplink packet. */
String buildPacket(const PacketInput& in);

struct Downlink {
    bool hasMode = false; bool live = false;
    int liveFor = 0;
    bool reboot = false;
    int sleepS = 0;
    bool calibrate = false;   // re-learn rest orientation + noise floor
    int deterS = 0;           // flash LED / drive PIN_DETERRENT for N seconds
    bool silence = false;     // stop a running siren now
    int armed = -1;           // site arming from every reply: 1 armed, 0 disarmed, -1 unknown
    int audible = -1;         // active mission sounds sirens: 1 yes, 0 silent alarm, -1 unknown
};
/** Parse the server reply ({"ok":true,"cmd":{...}}). */
Downlink parseReply(const String& reply);
