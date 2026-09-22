#include "lora_transport.h"
#ifdef TRANSPORT_LORA
#include <SPI.h>
#include <LoRa.h>
#include <ArduinoJson.h>
#include "config.h"
#include "settings.h"

#pragma pack(push, 1)
struct LoRaFrame {
    uint8_t  magic;        // 0xC7
    uint8_t  version;      // 2
    char     id[8];        // node id, NUL padded
    uint16_t seq;
    uint32_t uptimeS;
    uint16_t batMv;
    uint8_t  batPct;
    int8_t   rssiWifiUnused;
    uint8_t  mode;         // 0 ECO 1 LIVE
    uint8_t  state;        // 0 IDLE 1 SUSPECT 2 EVENT
    uint8_t  radarFlags;   // bit0 presence, bit1 moving, bit2 ok
    uint8_t  radarDistDm;  // decimetres
    uint8_t  radarEnergy;
    uint16_t rmsA_mg10;    // RMS in 0.1 mg
    uint16_t rmsB_mg10;
    int8_t   lagMs10;      // lag in 0.1 ms
    uint8_t  corrPct;
    uint8_t  mlClass;
    uint8_t  mlConfPct;
    uint8_t  domFreqHz2;   // dominant freq * 2
    uint16_t ipiMs;
    uint8_t  crc;
};
#pragma pack(pop)

static uint8_t crc8(const uint8_t* d, size_t n) {
    uint8_t c = 0;
    for (size_t i = 0; i < n; i++) { c ^= d[i]; for (int b = 0; b < 8; b++) c = (c & 0x80) ? (c << 1) ^ 0x07 : (c << 1); }
    return c;
}

bool LoRaTransport::begin() {
    SPI.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_NSS);
    LoRa.setPins(PIN_LORA_NSS, PIN_LORA_RST, PIN_LORA_DIO0);
    _ok = LoRa.begin(LORA_FREQUENCY);
    if (_ok) {
        LoRa.setSpreadingFactor(9);
        LoRa.setSignalBandwidth(125E3);
        LoRa.setCodingRate4(5);
        LoRa.setSyncWord(LORA_SYNC_WORD);
        LoRa.enableCrc();
        LoRa.setTxPower(17);
        LoRa.sleep();
    } else {
        Serial.println("[lora] radio not found");
    }
    return _ok;
}

bool LoRaTransport::connect() { if (_ok) LoRa.idle(); return _ok; }
void LoRaTransport::disconnect() { if (_ok) LoRa.sleep(); }
bool LoRaTransport::isConnected() { return _ok; }
int LoRaTransport::rssi() { return _lastRssi; }

bool LoRaTransport::send(const String& json, String& reply) {
    if (!_ok) return false;
    JsonDocument doc;
    if (deserializeJson(doc, json)) return false;
    LoRaFrame f;
    memset(&f, 0, sizeof(f));
    f.magic = 0xC7; f.version = 2;
    strncpy(f.id, settings.nodeId.c_str(), sizeof(f.id));
    f.seq = doc["seq"] | 0;
    f.uptimeS = (uint32_t)((doc["up"] | 0UL) / 1000UL);
    f.batMv = (uint16_t)((doc["bat"]["v"] | 0.0f) * 1000);
    f.batPct = doc["bat"]["p"] | 0;
    f.mode = (strcmp(doc["mode"] | "ECO", "LIVE") == 0) ? 1 : 0;
    const char* st = doc["st"] | "IDLE";
    f.state = strcmp(st, "EVENT") == 0 ? 2 : (strcmp(st, "SUSPECT") == 0 ? 1 : 0);
    f.radarFlags = ((doc["radar"]["pres"] | false) ? 1 : 0) | (((doc["radar"]["mov"] | 0) > 0) ? 2 : 0) | ((doc["radar"]["ok"] | true) ? 4 : 0);
    f.radarDistDm = (uint8_t)constrain((doc["radar"]["dist"] | 0.0f) * 10, 0.0f, 255.0f);
    f.radarEnergy = doc["radar"]["eng"] | 0;
    f.rmsA_mg10 = (uint16_t)constrain((doc["a"]["rms"] | 0.0f) * 10000, 0.0f, 65535.0f);
    f.rmsB_mg10 = (uint16_t)constrain((doc["b"]["rms"] | 0.0f) * 10000, 0.0f, 65535.0f);
    f.lagMs10 = (int8_t)constrain((doc["seis"]["lag"] | 0.0f) * 10, -127.0f, 127.0f);
    f.corrPct = (uint8_t)constrain((doc["seis"]["corr"] | 0.0f) * 100, 0.0f, 100.0f);
    f.mlClass = doc["ml"]["c"] | 0;
    JsonArray p = doc["ml"]["p"];
    f.mlConfPct = p.isNull() ? 0 : (uint8_t)((p[f.mlClass] | 0.0f) * 100);
    JsonArray feat = doc["seis"]["f"];
    if (!feat.isNull()) { f.domFreqHz2 = (uint8_t)constrain((feat[4] | 0.0f) * 2, 0.0f, 255.0f); f.ipiMs = (uint16_t)(feat[7] | 0.0f); }
    f.crc = crc8((uint8_t*)&f, sizeof(f) - 1);

    LoRa.idle();
    LoRa.beginPacket();
    LoRa.write((uint8_t*)&f, sizeof(f));
    bool ok = LoRa.endPacket() == 1;
    // listen briefly for a downlink from the gateway ("{"mode":"LIVE"}" etc.)
    uint32_t t0 = millis();
    while (millis() - t0 < 400) {
        int n = LoRa.parsePacket();
        if (n > 0) {
            String r;
            while (LoRa.available()) r += (char)LoRa.read();
            _lastRssi = LoRa.packetRssi();
            if (r.startsWith(settings.nodeId + ":")) reply = r.substring(settings.nodeId.length() + 1);
            break;
        }
        delay(5);
    }
    LoRa.sleep();
    return ok;
}
#endif
