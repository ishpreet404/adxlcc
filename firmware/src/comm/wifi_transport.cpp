#include "wifi_transport.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <esp_wifi.h>
#include "config.h"
#include "settings.h"

// survive deep sleep
RTC_DATA_ATTR static uint8_t  rtcBssid[6];
RTC_DATA_ATTR static int32_t  rtcChannel = 0;
RTC_DATA_ATTR static bool     rtcValid = false;

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
        // cached AP gone? fall back to a full scan once
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

bool WiFiTransport::send(const String& json, String& reply) {
    if (!isConnected() && !connect()) return false;
    HTTPClient http;
    String url = settings.serverUrl;
    if (url.endsWith("/")) url.remove(url.length() - 1);
    url += "/api/ingest";
    http.setConnectTimeout(3000);
    http.setTimeout(4000);
    http.setReuse(true);
    if (!http.begin(url)) return false;
    http.addHeader("Content-Type", "application/json");
    if (settings.nodeKey.length()) http.addHeader("X-Node-Key", settings.nodeKey);
    int code = http.POST((uint8_t*)json.c_str(), json.length());
    bool ok = code >= 200 && code < 300;
    if (ok) reply = http.getString();
    else if (code < 0) Serial.printf("[wifi] POST failed: %s\n", http.errorToString(code).c_str());
    else Serial.printf("[wifi] server replied %d\n", code);
    http.end();
    return ok;
}
