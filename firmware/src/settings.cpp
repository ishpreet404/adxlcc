#include "settings.h"
#include <Preferences.h>
#include "config.h"

Settings settings;
static Preferences prefs;

void Settings::load() {
    prefs.begin("sentry", false);   // read-write so the namespace is created on first boot
    nodeId    = prefs.isKey("id")   ? prefs.getString("id")   : String(DEFAULT_NODE_ID);
    wifiSsid  = prefs.isKey("ssid") ? prefs.getString("ssid") : String(DEFAULT_WIFI_SSID);
    wifiPass  = prefs.isKey("pass") ? prefs.getString("pass") : String(DEFAULT_WIFI_PASS);
    serverUrl = prefs.isKey("url")  ? prefs.getString("url")  : String(DEFAULT_SERVER_URL);
    nodeKey   = prefs.isKey("key")  ? prefs.getString("key")  : String(DEFAULT_NODE_KEY);
    bootLive  = prefs.isKey("live") ? prefs.getBool("live")   : (BOOT_LIVE != 0);
    prefs.end();
}

void Settings::save() {
    prefs.begin("sentry", false);
    prefs.putString("id", nodeId);
    prefs.putString("ssid", wifiSsid);
    prefs.putString("pass", wifiPass);
    prefs.putString("url", serverUrl);
    prefs.putString("key", nodeKey);
    prefs.putBool("live", bootLive);
    prefs.end();
}

void Settings::clear() {
    prefs.begin("sentry", false);
    prefs.clear();
    prefs.end();
    load();
}

void Settings::print(Stream& out) const {
    out.println(F("---- node settings ----"));
    out.printf("id      : %s\n", nodeId.c_str());
    out.printf("wifi    : %s / %s\n", wifiSsid.c_str(), wifiPass.length() ? "********" : "(none)");
    out.printf("server  : %s\n", serverUrl.c_str());
    out.printf("key     : %s\n", nodeKey.length() ? "(set)" : "(none)");
    out.printf("bootlive: %d\n", bootLive ? 1 : 0);
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
