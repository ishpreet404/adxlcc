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
