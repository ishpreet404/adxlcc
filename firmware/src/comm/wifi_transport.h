#pragma once
#include "transport.h"

/**
 * WiFi + HTTP uplink with fast reconnect.
 * The BSSID/channel of the last successful join are cached in RTC memory so a
 * reconnect after sleep takes ~300 ms instead of 2-4 s (no scan needed).
 */
class WiFiTransport : public Transport {
public:
    bool begin() override;
    bool connect() override;
    void disconnect() override;
    bool isConnected() override;
    bool send(const String& json, String& reply) override;
    int rssi() override;
    const char* name() const override { return "wifi"; }
private:
    uint32_t _lastFail = 0;
};
