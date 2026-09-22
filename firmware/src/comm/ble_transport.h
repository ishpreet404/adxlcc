#pragma once
#include "transport.h"

/**
 * BLE uplink (NimBLE GATT server). The Raspberry Pi gateway (gateway/ble_gateway.py)
 * subscribes to the uplink characteristic, reassembles chunks and forwards them to
 * the server over HTTP; server replies are written back to the downlink characteristic.
 *
 * Service  0xC0DE
 *   uplink   characteristic 0xC0D1  (notify, 180-byte chunks, last chunk ends with '\n')
 *   downlink characteristic 0xC0D2  (write)
 */
class BleTransport : public Transport {
public:
    bool begin() override;
    bool connect() override;
    void disconnect() override;
    bool isConnected() override;
    bool send(const String& json, String& reply) override;
    int rssi() override;
    const char* name() const override { return "ble"; }
    void poll() override;
};
