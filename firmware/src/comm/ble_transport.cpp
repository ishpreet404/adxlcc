#include "ble_transport.h"
#ifdef TRANSPORT_BLE
#include <NimBLEDevice.h>
#include "config.h"
#include "settings.h"

static NimBLEServer* g_server = nullptr;
static NimBLECharacteristic* g_up = nullptr;
static NimBLECharacteristic* g_down = nullptr;
static volatile bool g_connected = false;
static String g_downlink;

class ServerCb : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer*) override { g_connected = true; }
    void onDisconnect(NimBLEServer*) override { g_connected = false; NimBLEDevice::startAdvertising(); }
};
class DownCb : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* c) override { g_downlink = String(c->getValue().c_str()); }
};

bool BleTransport::begin() {
    String name = "SENTRY-" + settings.nodeId;
    NimBLEDevice::init(name.c_str());
    NimBLEDevice::setPower(ESP_PWR_LVL_P3);
    NimBLEDevice::setMTU(247);
    g_server = NimBLEDevice::createServer();
    g_server->setCallbacks(new ServerCb());
    NimBLEService* svc = g_server->createService("C0DE");
    g_up = svc->createCharacteristic("C0D1", NIMBLE_PROPERTY::NOTIFY | NIMBLE_PROPERTY::READ);
    g_down = svc->createCharacteristic("C0D2", NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
    g_down->setCallbacks(new DownCb());
    svc->start();
    NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
    adv->addServiceUUID("C0DE");
    adv->setScanResponse(true);
    adv->setMinInterval(160); // 100 ms — low duty advertising saves power
    adv->setMaxInterval(400);
    adv->start();
    return true;
}

bool BleTransport::connect() {
    if (g_connected) return true;
    NimBLEDevice::startAdvertising();
    uint32_t t0 = millis();
    while (!g_connected && millis() - t0 < 4000) delay(50);
    return g_connected;
}

void BleTransport::disconnect() { /* keep advertising at low duty; gateway reconnects when it likes */ }
bool BleTransport::isConnected() { return g_connected; }
int BleTransport::rssi() { return g_connected ? -60 : -100; }
void BleTransport::poll() {}

bool BleTransport::send(const String& json, String& reply) {
    if (!g_connected && !connect()) return false;
    g_downlink = "";
    const size_t chunk = 180;
    String payload = json + "\n";
    for (size_t off = 0; off < payload.length(); off += chunk) {
        String part = payload.substring(off, off + chunk);
        g_up->setValue((uint8_t*)part.c_str(), part.length());
        g_up->notify();
        delay(15);
    }
    // wait briefly for the gateway to write the server reply back
    uint32_t t0 = millis();
    while (!g_downlink.length() && millis() - t0 < 600) delay(10);
    reply = g_downlink;
    return true;
}
#endif
