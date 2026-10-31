// Cyber Chaukidaar nRF base station.
//   WiFi -> discover/poll the central server -> show live status on three OLEDs:
//     screen 0  SYSTEM : armed state, nodes online, server link, uptime
//     screen 1  ALERT  : newest active alert + its Gemini narrative (or ALL CLEAR)
//     screen 2  NODES  : per-node state / battery / last-seen
//
// Build:  pio run -e base -t upload      (classic ESP32 DevKit)
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <U8g2lib.h>
#include "base_config.h"

// ---- three software-I2C SSD1306 128x64 panels ----
U8G2_SSD1306_128X64_NONAME_F_SW_I2C oled0(U8G2_R0, OLED0_SCL, OLED0_SDA, U8X8_PIN_NONE);
U8G2_SSD1306_128X64_NONAME_F_SW_I2C oled1(U8G2_R0, OLED1_SCL, OLED1_SDA, U8X8_PIN_NONE);
U8G2_SSD1306_128X64_NONAME_F_SW_I2C oled2(U8G2_R0, OLED2_SCL, OLED2_SDA, U8X8_PIN_NONE);

// ---- persisted settings (serial `cfg ...`) ----
static Preferences prefs;
static String wifiSsid, wifiPass, serverCfg, serverUrl;   // serverUrl = resolved (after discovery)

static void loadSettings() {
  prefs.begin("base", false);
  wifiSsid  = prefs.isKey("ssid") ? prefs.getString("ssid") : String(BASE_WIFI_SSID);
  wifiPass  = prefs.isKey("pass") ? prefs.getString("pass") : String(BASE_WIFI_PASS);
  serverCfg = prefs.isKey("url")  ? prefs.getString("url")  : String(BASE_SERVER_URL);
  prefs.end();
  serverUrl = serverCfg.equalsIgnoreCase("auto") ? String() : serverCfg;
}
static void saveKV(const char* k, const String& v) { prefs.begin("base", false); prefs.putString(k, v); prefs.end(); }

// ---- live state shown on the screens ----
struct NodeView { String name; String state; int battery; bool online; long lastSeenS; };
static String armMode = "?";
static int nodesOnline = 0, nodesTotal = 0;
static long serverUptimeS = -1;
static bool linkUp = false;
static String alSeverity, alKind, alNode, alNarr;
static bool haveAlert = false;
static NodeView nodes[6]; static int nodeCount = 0;
static uint32_t lastPoll = 0;

// ------------------------------------------------------------------ discovery
// Listen for the server's UDP beacon ("CYBERCC_SERVER http://ip:8787") and also actively
// ask once, so a base station set to "auto" finds the server with zero configuration.
static WiFiUDP udp;
static void discoverPoke() {
  IPAddress bcast = WiFi.broadcastIP();
  udp.beginPacket(bcast, DISCOVERY_PORT);
  udp.print("CYBERCC_DISCOVER");
  udp.endPacket();
}
static void discoveryPump() {
  int n = udp.parsePacket();
  if (n <= 0) return;
  char buf[96]; int len = udp.read(buf, sizeof(buf) - 1); if (len <= 0) return; buf[len] = 0;
  const char* p = strstr(buf, "CYBERCC_SERVER ");
  if (!p) return;
  String url = String(p + 15); url.trim();
  while (url.length() && (url.endsWith("/") || url.endsWith("\n") || url.endsWith("\r"))) url.remove(url.length() - 1);
  if (url.length() && url != serverUrl) { serverUrl = url; Serial.printf("[base] discovered server %s\n", serverUrl.c_str()); }
}

// ------------------------------------------------------------------ HTTP helpers
static bool httpGet(const String& path, JsonDocument& doc, const JsonDocument* filter = nullptr) {
  if (!serverUrl.length()) return false;
  HTTPClient http; http.setConnectTimeout(HTTP_TIMEOUT_MS); http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(serverUrl + path)) return false;
  int code = http.GET();
  bool ok = false;
  if (code == 200) {
    DeserializationError e = filter
      ? deserializeJson(doc, http.getStream(), DeserializationOption::Filter(*filter))
      : deserializeJson(doc, http.getStream());
    ok = !e;
  }
  http.end();
  return ok;
}

static void pollServer() {
  // armed state — filter the big health payload down to just arming.mode
  { JsonDocument filter; filter["arming"]["mode"] = true; filter["uptimeS"] = true;
    JsonDocument d;
    if (httpGet("/api/system/health", d, &filter)) {
      armMode = d["arming"]["mode"] | "?";
      serverUptimeS = d["uptimeS"] | -1;
      linkUp = true;
    } else linkUp = false;
  }
  // nodes
  { JsonDocument d;
    if (httpGet("/api/nodes", d)) {
      JsonArray arr = d["nodes"].is<JsonArray>() ? d["nodes"].as<JsonArray>() : d.as<JsonArray>();
      nodeCount = 0; nodesOnline = 0; nodesTotal = 0;
      for (JsonObject n : arr) {
        nodesTotal++;
        String status = n["status"] | n["state"] | "";
        bool online = status.equalsIgnoreCase("ONLINE");
        if (online) nodesOnline++;
        if (nodeCount < 6) {
          NodeView& v = nodes[nodeCount++];
          v.name = (const char*)(n["name"] | n["id"] | "node");
          String lvl = (const char*)(n["fusion"]["level"] | "");
          if (!lvl.length()) lvl = (const char*)(n["latest"]["state"] | "");
          if (!lvl.length()) lvl = status.length() ? status : String("-");
          v.state = lvl;
          v.battery = n["battery"]["percent"] | n["batteryPercent"] | -1;
          v.online = online;
          long ls = n["lastSeen"] | n["lastSeenAt"] | 0L;
          v.lastSeenS = ls ? (long)((millis() / 1000)) : -1; // relative display handled server-side normally
        }
      }
      linkUp = true;
    }
  }
  // newest active alert
  { JsonDocument d;
    if (httpGet("/api/alerts", d)) {
      JsonArray arr = d["alerts"].is<JsonArray>() ? d["alerts"].as<JsonArray>() : d["active"].as<JsonArray>();
      haveAlert = false;
      for (JsonObject a : arr) {
        String st = a["status"] | "";
        if (st == "ACTIVE" || st == "ACKNOWLEDGED") {
          alSeverity = (const char*)(a["severity"] | "ALERT");
          alKind     = (const char*)(a["kind"] | "");
          alNode     = (const char*)(a["nodeName"] | a["nodeId"] | "");
          alNarr     = (const char*)(a["narrative"] | a["message"] | "");
          haveAlert = true; break;
        }
      }
    }
  }
}

// ------------------------------------------------------------------ rendering
static void drawWrapped(U8G2& g, const String& s, int x, int y, int maxW, int lineH, int maxLines) {
  String word, line; int lines = 0;
  for (int i = 0; i <= (int)s.length(); i++) {
    char c = i < (int)s.length() ? s[i] : ' ';
    if (c == ' ' || c == '\n') {
      String trial = line.length() ? line + " " + word : word;
      if (g.getStrWidth(trial.c_str()) > maxW && line.length()) {
        g.drawStr(x, y + lines * lineH, line.c_str()); line = word; if (++lines >= maxLines) return;
      } else line = trial;
      word = "";
    } else word += c;
  }
  if (line.length() && lines < maxLines) g.drawStr(x, y + lines * lineH, line.c_str());
}

static void renderSystem() {
  oled0.clearBuffer();
  oled0.setFont(u8g2_font_6x12_tf);
  oled0.drawStr(0, 10, "CYBER CHAUKIDAAR");
  oled0.drawHLine(0, 13, 128);
  oled0.setFont(u8g2_font_7x14B_tf);
  oled0.drawStr(0, 32, (String("ARM: ") + armMode).c_str());
  oled0.setFont(u8g2_font_6x12_tf);
  char buf[40];
  snprintf(buf, sizeof(buf), "Nodes: %d/%d online", nodesOnline, nodesTotal);
  oled0.drawStr(0, 48, buf);
  snprintf(buf, sizeof(buf), "Server: %s", linkUp ? "LINK UP" : "no link");
  oled0.drawStr(0, 62, buf);
  oled0.sendBuffer();
}

static void renderAlert() {
  oled1.clearBuffer();
  if (!haveAlert) {
    oled1.setFont(u8g2_font_9x15B_tf);
    oled1.drawStr(18, 38, "ALL CLEAR");
  } else {
    oled1.setFont(u8g2_font_7x14B_tf);
    oled1.drawStr(0, 12, (alSeverity + " " + alKind).c_str());
    oled1.setFont(u8g2_font_6x10_tf);
    oled1.drawStr(0, 24, (String("@ ") + alNode).c_str());
    oled1.drawHLine(0, 27, 128);
    drawWrapped(oled1, alNarr, 0, 38, 128, 11, 3);
  }
  oled1.sendBuffer();
}

static void renderNodes() {
  oled2.clearBuffer();
  oled2.setFont(u8g2_font_6x12_tf);
  oled2.drawStr(0, 10, "NODES");
  oled2.drawHLine(0, 13, 128);
  oled2.setFont(u8g2_font_5x8_tf);
  int y = 24;
  for (int i = 0; i < nodeCount && i < 4; i++) {
    char buf[40];
    snprintf(buf, sizeof(buf), "%c %-8.8s %-6.6s %d%%",
             nodes[i].online ? '>' : 'x', nodes[i].name.c_str(), nodes[i].state.c_str(),
             nodes[i].battery >= 0 ? nodes[i].battery : 0);
    oled2.drawStr(0, y, buf); y += 11;
  }
  if (nodeCount == 0) oled2.drawStr(0, 30, "(waiting for data)");
  oled2.sendBuffer();
}

static void splash(const char* msg) {
  for (U8G2* g : { &oled0, &oled1, &oled2 }) {
    g->clearBuffer(); g->setFont(u8g2_font_6x12_tf); g->drawStr(0, 24, "CYBER CHAUKIDAAR"); g->drawStr(0, 40, msg); g->sendBuffer();
  }
}

// ------------------------------------------------------------------ serial console
static void handleConsole() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') { if (line.length() < 120) line += c; continue; }
    line.trim();
    if (line.startsWith("cfg wifi ")) { int sp = line.indexOf(' ', 9); if (sp > 0) { wifiSsid = line.substring(9, sp); wifiPass = line.substring(sp + 1); saveKV("ssid", wifiSsid); saveKV("pass", wifiPass); Serial.println("saved; reboot to apply"); } }
    else if (line.startsWith("cfg server ")) { serverCfg = line.substring(11); serverCfg.trim(); saveKV("url", serverCfg); serverUrl = serverCfg.equalsIgnoreCase("auto") ? String() : serverCfg; Serial.println("saved"); }
    else if (line == "cfg show" || line == "cfg") { Serial.printf("ssid:%s server:%s resolved:%s link:%s\n", wifiSsid.c_str(), serverCfg.c_str(), serverUrl.length() ? serverUrl.c_str() : "(discovering)", linkUp ? "up" : "down"); }
    else if (line == "reboot") ESP.restart();
    line = "";
  }
}

// ------------------------------------------------------------------ arduino
void setup() {
  Serial.begin(SERIAL_BAUD); delay(200);
  Serial.printf("\nCYBER CHAUKIDAAR base station fw %s\n", BASE_FW_VERSION);
  oled0.begin(); oled1.begin(); oled2.begin();
  loadSettings();
  splash("connecting WiFi...");
  WiFi.mode(WIFI_STA); WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) { delay(200); }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[base] WiFi %s  ip %s\n", wifiSsid.c_str(), WiFi.localIP().toString().c_str());
    udp.begin(DISCOVERY_PORT);          // listen for server beacons
    discoverPoke();                     // and ask once
    splash("finding server...");
  } else {
    Serial.println("[base] WiFi join failed — check `cfg show`");
    splash("WiFi FAILED");
  }
}

void loop() {
  handleConsole();
  if (WiFi.status() == WL_CONNECTED) discoveryPump();
  uint32_t now = millis();
  if (now - lastPoll >= POLL_INTERVAL_MS) {
    lastPoll = now;
    if (WiFi.status() == WL_CONNECTED) {
      if (!serverUrl.length()) discoverPoke();   // still hunting for the server
      pollServer();
      renderSystem(); renderAlert(); renderNodes();
    }
  }
  delay(20);
}
