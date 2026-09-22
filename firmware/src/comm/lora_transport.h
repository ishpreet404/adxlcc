#pragma once
#include "transport.h"

/**
 * LoRa (SX1276/78) uplink. JSON is far too big for LoRa airtime, so the packet is
 * re-encoded into a fixed 40-byte binary frame (see docs/protocol.md) that the
 * Raspberry Pi gateway (gateway/lora_gateway.py) expands back into the v2 JSON.
 * Waveform snapshots are never sent over LoRa.
 */
class LoRaTransport : public Transport {
public:
    bool begin() override;
    bool connect() override;
    void disconnect() override;
    bool isConnected() override;
    bool send(const String& json, String& reply) override;
    int rssi() override;
    const char* name() const override { return "lora"; }
private:
    bool _ok = false;
    int _lastRssi = -100;
};
