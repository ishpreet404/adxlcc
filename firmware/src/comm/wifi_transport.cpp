#include "wifi_transport.h"
#include <WiFi.h>
#include <WiFiUdp.h>
#include <HTTPClient.h>
#include <esp_wifi.h>
#include "config.h"
#include "settings.h"

// survive deep sleep
RTC_DATA_ATTR static uint8_t  rtcBssid[6];
RTC_DATA_ATTR static int32_t  rtcChannel = 0;
RTC_DATA_ATTR static bool     rtcValid = false;
RTC_DATA_ATTR static char     rtcServerUrl[80] = "";   // discovered server address

static const uint16_t DISCOVERY_PORT = 8788;
static const char* DISCOVERY_REQ = "CYBERCC_DISCOVER";
static const char* DISCOVERY_RES = "CYBERCC_SERVER ";

static uint8_t consecutiveFailures = 0;

bool WiFiTransport::begin() {
    WiFi.persistent(false);
    WiFi.mode(WIFI_OFF);
    return true;
}

bool WiFiTransport::connect() {
    if (WiFi.status() == WL_CONNECTED) return true;
    if (!settings.wifiSsid.length()) return false;
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(true); // modem sleep between DTIM beacons while connected
    if (rtcValid) WiFi.begin(settings.wifiSsid.c_str(), settings.wifiPass.c_str(), rtcChannel, rtcBssid, true);
    else          WiFi.begin(settings.wifiSsid.c_str(), settings.wifiPass.c_str());

    uint32_t t0 = millis();
    uint32_t budget = rtcValid ? 2500 : 8000;
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < budget) delay(20);

    if (WiFi.status() != WL_CONNECTED && rtcValid) {
        rtcValid = false;
        WiFi.disconnect(true);
        WiFi.begin(settings.wifiSsid.c_str(), settings.wifiPass.c_str());
        t0 = millis();
        while (WiFi.status() != WL_CONNECTED && millis() - t0 < 8000) delay(20);
    }
    if (WiFi.status() == WL_CONNECTED) {
        memcpy(rtcBssid, WiFi.BSSID(), 6);
        rtcChannel = WiFi.channel();
        rtcValid = true;
        static bool announced = false;
        if (!announced) { announced = true; Serial.printf("[wifi] joined %s, ip %s\n", settings.wifiSsid.c_str(), WiFi.localIP().toString().c_str()); }
        return true;
    }
    _lastFail = millis();
    WiFi.mode(WIFI_OFF);
    return false;
}

void WiFiTransport::disconnect() {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
}

bool WiFiTransport::isConnected() { return WiFi.status() == WL_CONNECTED; }

int WiFiTransport::rssi() { return isConnected() ? WiFi.RSSI() : -100; }

/**
 * Ask the local network where the server is: broadcast CYBERCC_DISCOVER on udp/8788,
 * the Raspberry Pi answers "CYBERCC_SERVER http://<ip>:<port>".  Returns true on success
 * and stores the URL in RTC memory so it survives sleep.
 */
static bool discoverServer(uint32_t timeoutMs = 1500) {
    WiFiUDP udp;
    if (!udp.begin(DISCOVERY_PORT + 1)) return false;
    IPAddress bcast = WiFi.broadcastIP();
    bool found = false;
    for (int attempt = 0; attempt < 3 && !found; attempt++) {
        udp.beginPacket(bcast, DISCOVERY_PORT);
        udp.write((const uint8_t*)DISCOVERY_REQ, strlen(DISCOVERY_REQ));
        udp.endPacket();
        uint32_t t0 = millis();
        while (millis() - t0 < timeoutMs) {
            int n = udp.parsePacket();
            if (n > 0) {
                char buf[96];
                int len = udp.read(buf, sizeof(buf) - 1);
                if (len < 0) len = 0;
                buf[len] = 0;
                if (strncmp(buf, DISCOVERY_RES, strlen(DISCOVERY_RES)) == 0) {
                    strncpy(rtcServerUrl, buf + strlen(DISCOVERY_RES), sizeof(rtcServerUrl) - 1);
                    rtcServerUrl[sizeof(rtcServerUrl) - 1] = 0;
                    // trim trailing whitespace / slash
                    for (int i = strlen(rtcServerUrl) - 1; i >= 0 && (rtcServerUrl[i] == '\n' || rtcServerUrl[i] == '\r' || rtcServerUrl[i] == ' ' || rtcServerUrl[i] == '/'); i--) rtcServerUrl[i] = 0;
                    Serial.printf("[wifi] discovered server %s (from %s)\n", rtcServerUrl, udp.remoteIP().toString().c_str());
                    found = true;
                    break;
                }
            }
            delay(10);
        }
    }
    udp.stop();
    return found;
}

/** Effective server base URL: configured value, or the discovered one when set to "auto"/empty. */
static String serverBase() {
    String url = settings.serverUrl;
    url.trim();
    bool autoMode = url.length() == 0 || url.equalsIgnoreCase("auto");
    if (autoMode || consecutiveFailures >= 3) {
        if (!rtcServerUrl[0] || consecutiveFailures >= 3) {
            if (discoverServer()) consecutiveFailures = 0;
        }
        if (rtcServerUrl[0]) url = rtcServerUrl;
        else if (autoMode) return String();
    }
    if (url.endsWith("/")) url.remove(url.length() - 1);
    return url;
}

bool WiFiTransport::send(const String& json, String& reply) {
    if (!isConnected() && !connect()) return false;
    String base = serverBase();
    if (!base.length()) {
        Serial.println("[wifi] no server yet: discovery got no reply (is the Pi on this network?)");
        return false;
    }
    HTTPClient http;
    http.setConnectTimeout(3000);
    http.setTimeout(4000);
    http.setReuse(true);
    if (!http.begin(base + "/api/ingest")) return false;
    http.addHeader("Content-Type", "application/json");
    if (settings.nodeKey.length()) http.addHeader("X-Node-Key", settings.nodeKey);
    int code = http.POST((uint8_t*)json.c_str(), json.length());
    bool ok = code >= 200 && code < 300;
    if (ok) {
        reply = http.getString();
        consecutiveFailures = 0;
    } else {
        consecutiveFailures++;
        if (code < 0) Serial.printf("[wifi] POST %s failed: %s\n", base.c_str(), http.errorToString(code).c_str());
        else Serial.printf("[wifi] server replied %d\n", code);
    }
    http.end();
    return ok;
}
