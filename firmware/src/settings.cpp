#include "settings.h"
#include <Preferences.h>
#include "config.h"

Settings settings;
static Preferences prefs;

// Only values that differ from the compile-time defaults are stored in NVS.
// That way editing a DEFAULT_* in config.h takes effect on the next flash, unless
// that particular value was explicitly overridden on the console with `cfg ...`.
static void putOverride(const char* key, const String& v, const char* def) {
    if (v == def) { if (prefs.isKey(key)) prefs.remove(key); }
    else prefs.putString(key, v);
}

static String getOr(const char* key, const char* def) {
    return prefs.isKey(key) ? prefs.getString(key, def) : String(def);   // isKey first: getString logs an error on a missing key
}

void Settings::load() {
    prefs.begin("sentry", true);
    nodeId    = getOr("id", DEFAULT_NODE_ID);
    wifiSsid  = getOr("ssid", DEFAULT_WIFI_SSID);
    wifiPass  = getOr("pass", DEFAULT_WIFI_PASS);
    serverUrl = getOr("url", DEFAULT_SERVER_URL);
    nodeKey   = getOr("key", DEFAULT_NODE_KEY);
    bootLive  = prefs.isKey("live") ? prefs.getBool("live", BOOT_LIVE) : (bool)BOOT_LIVE;
    overrides = 0;
    if (prefs.isKey("id"))   overrides |= OV_ID;
    if (prefs.isKey("ssid") || prefs.isKey("pass")) overrides |= OV_WIFI;
    if (prefs.isKey("url"))  overrides |= OV_URL;
    if (prefs.isKey("key"))  overrides |= OV_KEY;
    if (prefs.isKey("live")) overrides |= OV_LIVE;
    prefs.end();
}

void Settings::save() {
    prefs.begin("sentry", false);
    putOverride("id",   nodeId,    DEFAULT_NODE_ID);
    putOverride("ssid", wifiSsid,  DEFAULT_WIFI_SSID);
    putOverride("pass", wifiPass,  DEFAULT_WIFI_PASS);
    putOverride("url",  serverUrl, DEFAULT_SERVER_URL);
    putOverride("key",  nodeKey,   DEFAULT_NODE_KEY);
    if (bootLive == (bool)BOOT_LIVE) { if (prefs.isKey("live")) prefs.remove("live"); }
    else prefs.putBool("live", bootLive);
    prefs.end();
    load();
}

void Settings::clear() {
    prefs.begin("sentry", false);
    prefs.clear();
    prefs.end();
    load();
}

void Settings::print(Stream& out) const {
    auto src = [&](uint8_t bit) { return (overrides & bit) ? "  [saved by `cfg`, overrides config.h]" : "  [config.h default]"; };
    out.println(F("---- node settings ----"));
    out.printf("id      : %s%s\n", nodeId.c_str(), src(OV_ID));
    out.printf("wifi    : %s / %s%s\n", wifiSsid.c_str(), wifiPass.length() ? "********" : "(none)", src(OV_WIFI));
    out.printf("server  : %s%s\n", serverUrl.c_str(), src(OV_URL));
    if ((overrides & OV_URL) && serverUrl != DEFAULT_SERVER_URL)
        out.printf("          (config.h has %s — run `cfg server %s` or `cfg clear` to use it)\n", DEFAULT_SERVER_URL, DEFAULT_SERVER_URL);
    out.printf("key     : %s%s\n", nodeKey.length() ? "(set)" : "(none)", src(OV_KEY));
    out.printf("bootlive: %d%s\n", bootLive ? 1 : 0, src(OV_LIVE));
    out.println(F("commands: cfg id <id> | cfg wifi <ssid> <pass> | cfg server <url> | cfg key <key> | cfg bootlive 0|1 | cfg show | cfg clear | reboot | live | eco"));
}

static String nextToken(String& s) {
    s.trim();
    int sp = s.indexOf(' ');
    String tok = sp < 0 ? s : s.substring(0, sp);
    s = sp < 0 ? "" : s.substring(sp + 1);
    return tok;
}

bool Settings::handleLine(const String& raw, Stream& out) {
    String line = raw;
    line.trim();
    if (!line.startsWith("cfg")) return false;
    nextToken(line);
    String cmd = nextToken(line);
    if (cmd == "show" || cmd == "") { print(out); return true; }
    if (cmd == "id")     { nodeId = nextToken(line); }
    else if (cmd == "wifi")   { wifiSsid = nextToken(line); wifiPass = line; wifiPass.trim(); }
    else if (cmd == "server") { serverUrl = nextToken(line); }
    else if (cmd == "key")    { nodeKey = nextToken(line); }
    else if (cmd == "bootlive") { bootLive = nextToken(line) == "1"; }
    else if (cmd == "clear")  { clear(); out.println(F("settings cleared")); return true; }
    else { out.println(F("unknown cfg command")); return true; }
    save();
    out.println(F("saved"));
    print(out);
    return true;
}

// Console line assembly (shared by main.cpp which handles non-cfg commands)
static String lineBuf;
String consoleReadLine() {
    while (Serial.available()) {
        char c = (char)Serial.read();
        if (c == '\r') continue;
        if (c == '\n') {
            String l = lineBuf;
            lineBuf = "";
            return l;
        }
        if (lineBuf.length() < 200) lineBuf += c;
    }
    return String();
}
