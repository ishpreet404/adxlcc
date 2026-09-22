#pragma once
#include <Arduino.h>

/** Uplink abstraction. Exactly one implementation is compiled in (see platformio.ini). */
class Transport {
public:
    virtual ~Transport() {}
    virtual bool begin() = 0;
    /** Bring the link up (WiFi join, BLE advertise...). Returns true when ready. */
    virtual bool connect() = 0;
    /** Tear the link down to save power. */
    virtual void disconnect() = 0;
    virtual bool isConnected() = 0;
    /** Send one packet. `reply` receives the server's JSON response (may stay empty). */
    virtual bool send(const String& json, String& reply) = 0;
    virtual int rssi() = 0;
    virtual const char* name() const = 0;
    /** Called from loop() for transports that need pumping. */
    virtual void poll() {}
};
