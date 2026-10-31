#pragma once
#include <Arduino.h>

/** Runtime settings persisted in NVS, editable over the serial console. */
struct Settings {
    String nodeId;
    String wifiSsid;
    String wifiPass;
    String serverUrl;
    String nodeKey;
    bool bootLive;

    // Which values came from NVS (a `cfg ...` override) rather than config.h defaults.
    enum : uint8_t { OV_ID = 1, OV_WIFI = 2, OV_URL = 4, OV_KEY = 8, OV_LIVE = 16 };
    uint8_t overrides = 0;

    void load();
    void save();
    void clear();
    void print(Stream& out) const;
    /** Parse one console line ("cfg ..."). Returns true if it was a config command. */
    bool handleLine(const String& line, Stream& out);
};

extern Settings settings;

/** Poll the serial port for console commands (non-blocking). */
void settingsPollSerial();
