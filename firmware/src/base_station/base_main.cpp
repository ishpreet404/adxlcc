// Cyber Chaukidaar nRF base station — interactive control panel.
//   WiFi -> discover/poll the central server. Three OLEDs + a 5-way keypad + status LED:
//     OLED0  MENU    : Overview / Nodes / Alerts / Arming / System  (UP/DOWN to move)
//     OLED1  DETAIL  : detail of the highlighted item (LEFT/RIGHT pages nodes or alerts)
//     OLED2  BANNER  : always-on newest alert / ALL CLEAR + arm state
//   SELECT acts on the item: acknowledge the shown alert, or toggle arm/disarm.
//   STATUS LED: solid=critical alert, fast blink=active alert, heartbeat=armed&clear, off=disarmed/no-link.
//
// Build:  pio run -e base -t upload      (classic ESP32 DevKit)
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <U8g2lib.h>
#include <Adafruit_NeoPixel.h>
#include "base_config.h"

U8G2_SSD1306_128X64_NONAME_F_SW_I2C oledMenu  (U8G2_R0, OLED0_SCL, OLED0_SDA, U8X8_PIN_NONE);
U8G2_SSD1306_128X64_NONAME_F_SW_I2C oledDetail(U8G2_R0, OLED1_SCL, OLED1_SDA, U8X8_PIN_NONE);
U8G2_SSD1306_128X64_NONAME_F_SW_I2C oledBanner(U8G2_R0, OLED2_SCL, OLED2_SDA, U8X8_PIN_NONE);

// ---- settings (serial `cfg ...`) ----
static Preferences prefs;
static String wifiSsid, wifiPass, serverCfg, serverUrl;
static void loadSettings() {
  prefs.begin("base", false);
  wifiSsid  = prefs.isKey("ssid") ? prefs.getString("ssid") : String(BASE_WIFI_SSID);
  wifiPass  = prefs.isKey("pass") ? prefs.getString("pass") : String(BASE_WIFI_PASS);
  serverCfg = prefs.isKey("url")  ? prefs.getString("url")  : String(BASE_SERVER_URL);
  prefs.end();
  serverUrl = serverCfg.equalsIgnoreCase("auto") ? String() : serverCfg;
}
static void saveKV(const char* k, const String& v) { prefs.begin("base", false); prefs.putString(k, v); prefs.end(); }

// ---- live state ----
struct NodeView { String name, state; int battery, rssi; bool online; };
struct AlertView { String id, severity, kind, node, narr; };
static String armMode = "?";
static int nodesOnline = 0, nodesTotal = 0;
static long serverUptimeS = -1;
static bool linkUp = false;
static NodeView nodes[6]; static int nodeCount = 0;
static AlertView alerts[6]; static int alertCount = 0;
static uint32_t lastPoll = 0;
static String lastActionMsg; static uint32_t lastActionMs = 0;

// ---- menu / navigation ----
enum MenuItem { M_OVERVIEW, M_NODES, M_ALERTS, M_ARMING, M_SYSTEM, M_COUNT };
static const char* MENU_LABELS[M_COUNT] = { "Overview", "Nodes", "Alerts", "Arming", "System" };
static int menuSel = 0;      // highlighted menu item
static int pageNode = 0;     // which node in the Nodes detail
static int pageAlert = 0;    // which alert in the Alerts detail
static bool dirty = true;    // force a re-render after input

// ---- discovery ----
static WiFiUDP udp;
static void discoverPoke() { IPAddress b = WiFi.broadcastIP(); udp.beginPacket(b, DISCOVERY_PORT); udp.print("CYBERCC_DISCOVER"); udp.endPacket(); }
// True if the host in a "http://A.B.C.D:port" URL is on the same /24 as the base station.
// The server beacons one IP per laptop interface (WiFi, USB-LAN, VPN); only the one on our
// own subnet is actually reachable, so we lock onto that and ignore the rest (no thrashing).
static bool onOurSubnet(const String& url) {
  int a = url.indexOf("://"); if (a < 0) return false; a += 3;
  int b = url.indexOf(':', a); String host = b < 0 ? url.substring(a) : url.substring(a, b);
  IPAddress ip; if (!ip.fromString(host)) return false;
  IPAddress me = WiFi.localIP();
  return ip[0] == me[0] && ip[1] == me[1] && ip[2] == me[2];
}
static bool autoMode() { return serverCfg.equalsIgnoreCase("auto") || !serverCfg.length(); }
static void discoveryPump() {
  if (!autoMode()) return;   // explicit server URL pinned: skip UDP discovery entirely
  int n = udp.parsePacket(); if (n <= 0) return;
  char buf[96]; int len = udp.read(buf, sizeof(buf) - 1); if (len <= 0) return; buf[len] = 0;
  const char* p = strstr(buf, "CYBERCC_SERVER "); if (!p) return;
  String url = String(p + 15); url.trim();
  while (url.length() && (url.endsWith("/") || url.endsWith("\n") || url.endsWith("\r"))) url.remove(url.length() - 1);
  if (!url.length() || url == serverUrl) return;
  // Accept a new URL only if we have none yet, or this one is on our subnet (reachable).
  // Once we hold a same-subnet URL, ignore other-interface beacons.
  bool haveSameSubnet = serverUrl.length() && onOurSubnet(serverUrl);
  if (!serverUrl.length() || (onOurSubnet(url) && !haveSameSubnet)) {
    serverUrl = url; dirty = true;
    static uint32_t lastPrint = 0;
    if (millis() - lastPrint > 5000) { lastPrint = millis(); Serial.printf("[base] server %s\n", serverUrl.c_str()); }
  }
}

// ---- HTTP ----
static bool httpGet(const String& path, JsonDocument& doc, const JsonDocument* filter = nullptr) {
  if (!serverUrl.length()) return false;
  HTTPClient http; http.setConnectTimeout(HTTP_TIMEOUT_MS); http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(serverUrl + path)) return false;
  int code = http.GET(); bool ok = false;
  if (code == 200) {
    DeserializationError e = filter ? deserializeJson(doc, http.getStream(), DeserializationOption::Filter(*filter))
                                    : deserializeJson(doc, http.getStream());
    ok = !e;
  }
  http.end(); return ok;
}
static bool httpPost(const String& path, const String& body) {
  if (!serverUrl.length()) return false;
  HTTPClient http; http.setConnectTimeout(HTTP_TIMEOUT_MS); http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(serverUrl + path)) return false;
  http.addHeader("Content-Type", "application/json");
  int code = http.POST((uint8_t*)body.c_str(), body.length());
  http.end(); return code >= 200 && code < 300;
}

static void pollServer() {
  { JsonDocument filter; filter["arming"]["mode"] = true; filter["uptimeS"] = true;
    JsonDocument d;
    if (httpGet("/api/system/health", d, &filter)) { armMode = (const char*)(d["arming"]["mode"] | "?"); serverUptimeS = d["uptimeS"] | -1; linkUp = true; }
    else linkUp = false;
  }
  { JsonDocument d;
    if (httpGet("/api/nodes", d)) {
      JsonArray arr = d["nodes"].is<JsonArray>() ? d["nodes"].as<JsonArray>() : d.as<JsonArray>();
      nodeCount = 0; nodesOnline = 0; nodesTotal = 0;
      for (JsonObject n : arr) {
        nodesTotal++;
        String status = (const char*)(n["status"] | n["state"] | "");
        bool online = status.equalsIgnoreCase("ONLINE"); if (online) nodesOnline++;
        if (nodeCount < 6) {
          NodeView& v = nodes[nodeCount++];
          v.name = (const char*)(n["name"] | n["id"] | "node");
          String lvl = (const char*)(n["fusion"]["level"] | "");
          if (!lvl.length()) lvl = (const char*)(n["latest"]["state"] | "");
          if (!lvl.length()) lvl = status.length() ? status : String("-");
          v.state = lvl;
          v.battery = n["battery"]["percent"] | n["batteryPercent"] | -1;
          v.rssi = n["rssi"] | n["latest"]["rssi"] | 0;
          v.online = online;
        }
      }
      if (pageNode >= nodeCount) pageNode = nodeCount ? nodeCount - 1 : 0;
      linkUp = true;
    }
  }
  { JsonDocument d;
    if (httpGet("/api/alerts", d)) {
      JsonArray arr = d["alerts"].is<JsonArray>() ? d["alerts"].as<JsonArray>() : d["active"].as<JsonArray>();
      alertCount = 0;
      for (JsonObject a : arr) {
        String st = (const char*)(a["status"] | "");
        if ((st == "ACTIVE" || st == "ACKNOWLEDGED") && alertCount < 6) {
          AlertView& v = alerts[alertCount++];
          v.id       = (const char*)(a["id"] | "");
          v.severity = (const char*)(a["severity"] | "ALERT");
          v.kind     = (const char*)(a["kind"] | "");
          v.node     = (const char*)(a["nodeName"] | a["nodeId"] | "");
          v.narr     = (const char*)(a["narrative"] | a["message"] | "");
        }
      }
      if (pageAlert >= alertCount) pageAlert = alertCount ? alertCount - 1 : 0;
    }
  }
}

// ---- actions (SELECT) ----
static void flashAction(const String& m) { lastActionMsg = m; lastActionMs = millis(); dirty = true; }
static void doSelect() {
  if (menuSel == M_ALERTS && alertCount && alerts[pageAlert].id.length()) {
    bool ok = httpPost("/api/alerts/" + alerts[pageAlert].id + "/acknowledge", "{}");
    flashAction(ok ? "alert acknowledged" : "ack failed");
  } else if (menuSel == M_ARMING) {
    String next = armMode.equalsIgnoreCase("DISARMED") ? "ARMED" : "DISARMED";
    bool ok = httpPost("/api/system/arming", String("{\"mode\":\"") + next + "\",\"by\":\"base-station\"}");
    flashAction(ok ? (next + " requested") : "arming failed");
  } else {
    flashAction("refresh");
  }
  lastPoll = 0;   // force an immediate re-poll so the screens reflect the action
}

// ---- status LED ----
enum LedMode { LED_OFF, LED_HEARTBEAT, LED_FAST, LED_SOLID };
static Adafruit_NeoPixel pixel(STATUS_PIXEL_COUNT, STATUS_PIXEL_PIN, NEO_GRB + NEO_KHZ800);
static void setPix(uint8_t r, uint8_t g, uint8_t b) { pixel.setPixelColor(0, pixel.Color(r, g, b)); pixel.show(); }
static LedMode ledMode() {
  if (!linkUp) return LED_OFF;
  bool critical = false, active = alertCount > 0;
  for (int i = 0; i < alertCount; i++) if (alerts[i].severity == "CRITICAL") critical = true;
  if (critical) return LED_SOLID;
  if (active)   return LED_FAST;
  if (!armMode.equalsIgnoreCase("DISARMED") && armMode != "?") return LED_HEARTBEAT;
  return LED_OFF;
}
static void updateLed() {
  uint32_t t = millis();
  switch (ledMode()) {
    case LED_OFF:       setPix(0, 0, linkUp ? 0 : 6); break;              // off (dim blue when no link)
    case LED_SOLID:     setPix(90, 0, 0); break;                          // critical alert: solid red
    case LED_FAST:      setPix((t / 150) % 2 ? 90 : 0, (t / 150) % 2 ? 25 : 0, 0); break; // active: blink orange
    case LED_HEARTBEAT: { bool on = (t % 2000) < 70; setPix(0, on ? 45 : 0, 0); } break;  // armed & clear: green pulse
  }
}

// ---- rendering ----
static void drawWrapped(U8G2& g, const String& s, int x, int y, int maxW, int lineH, int maxLines) {
  String word, line; int lines = 0;
  for (int i = 0; i <= (int)s.length(); i++) {
    char c = i < (int)s.length() ? s[i] : ' ';
    if (c == ' ' || c == '\n') {
      String trial = line.length() ? line + " " + word : word;
      if (g.getStrWidth(trial.c_str()) > maxW && line.length()) { g.drawStr(x, y + lines * lineH, line.c_str()); line = word; if (++lines >= maxLines) return; }
      else line = trial;
      word = "";
    } else word += c;
  }
  if (line.length() && lines < maxLines) g.drawStr(x, y + lines * lineH, line.c_str());
}

static void renderMenu() {
  oledMenu.clearBuffer();
  oledMenu.setFont(u8g2_font_6x12_tf);
  oledMenu.drawStr(0, 10, "CHAUKIDAAR");
  oledMenu.setFont(u8g2_font_5x8_tf);
  oledMenu.drawStr(78, 9, linkUp ? "LINK" : "----");
  oledMenu.drawHLine(0, 12, 128);
  oledMenu.setFont(u8g2_font_6x12_tf);
  for (int i = 0; i < M_COUNT; i++) {
    int y = 25 + i * 11;
    if (i == menuSel) { oledMenu.drawBox(0, y - 9, 128, 11); oledMenu.setDrawColor(0); }
    oledMenu.drawStr(3, y, (String(i == menuSel ? ">" : " ") + " " + MENU_LABELS[i]).c_str());
    if (i == menuSel) oledMenu.setDrawColor(1);
  }
  oledMenu.sendBuffer();
}

static void renderDetail() {
  oledDetail.clearBuffer();
  oledDetail.setFont(u8g2_font_6x12_tf);
  oledDetail.drawStr(0, 10, MENU_LABELS[menuSel]);
  oledDetail.drawHLine(0, 13, 128);
  oledDetail.setFont(u8g2_font_6x10_tf);
  char b[48];
  if (menuSel == M_OVERVIEW) {
    snprintf(b, sizeof(b), "Arm   : %s", armMode.c_str());           oledDetail.drawStr(0, 26, b);
    snprintf(b, sizeof(b), "Nodes : %d/%d online", nodesOnline, nodesTotal); oledDetail.drawStr(0, 38, b);
    snprintf(b, sizeof(b), "Alerts: %d active", alertCount);         oledDetail.drawStr(0, 50, b);
    snprintf(b, sizeof(b), "Up    : %lds", serverUptimeS);           oledDetail.drawStr(0, 62, b);
  } else if (menuSel == M_NODES) {
    if (!nodeCount) oledDetail.drawStr(0, 32, "(no nodes)");
    else {
      NodeView& v = nodes[pageNode];
      snprintf(b, sizeof(b), "%d/%d  %s", pageNode + 1, nodeCount, v.online ? "ONLINE" : "offline"); oledDetail.drawStr(0, 26, b);
      oledDetail.drawStr(0, 38, v.name.c_str());
      snprintf(b, sizeof(b), "state: %s", v.state.c_str());          oledDetail.drawStr(0, 50, b);
      snprintf(b, sizeof(b), "bat %d%%  rssi %d", v.battery, v.rssi); oledDetail.drawStr(0, 62, b);
    }
  } else if (menuSel == M_ALERTS) {
    if (!alertCount) oledDetail.drawStr(0, 32, "no active alerts");
    else {
      AlertView& a = alerts[pageAlert];
      snprintf(b, sizeof(b), "%d/%d  %s", pageAlert + 1, alertCount, a.severity.c_str()); oledDetail.drawStr(0, 26, b);
      oledDetail.drawStr(0, 38, (a.kind + " @ " + a.node).c_str());
      drawWrapped(oledDetail, a.narr, 0, 50, 128, 10, 1);
      oledDetail.drawStr(0, 62, "SELECT = acknowledge");
    }
  } else if (menuSel == M_ARMING) {
    oledDetail.setFont(u8g2_font_9x15B_tf);
    oledDetail.drawStr(0, 36, armMode.c_str());
    oledDetail.setFont(u8g2_font_6x10_tf);
    oledDetail.drawStr(0, 56, "SELECT = toggle arm");
  } else { // SYSTEM
    oledDetail.drawStr(0, 26, ("srv " + (serverUrl.length() ? serverUrl : String("(discovering)"))).c_str());
    oledDetail.drawStr(0, 38, ("base " + WiFi.localIP().toString()).c_str());
    snprintf(b, sizeof(b), "fw %s  up %lds", BASE_FW_VERSION, serverUptimeS); oledDetail.drawStr(0, 50, b);
  }
  if (lastActionMsg.length() && millis() - lastActionMs < 2500) { oledDetail.setFont(u8g2_font_5x8_tf); oledDetail.drawStr(0, 8, lastActionMsg.c_str()); }
  oledDetail.sendBuffer();
}

static void renderBanner() {
  oledBanner.clearBuffer();
  if (alertCount == 0) {
    oledBanner.setFont(u8g2_font_9x15B_tf); oledBanner.drawStr(18, 30, "ALL CLEAR");
    oledBanner.setFont(u8g2_font_6x10_tf);  oledBanner.drawStr(0, 50, (String("Site: ") + armMode).c_str());
  } else {
    AlertView& a = alerts[0];
    oledBanner.setFont(u8g2_font_7x14B_tf); oledBanner.drawStr(0, 13, (a.severity + " " + a.kind).c_str());
    oledBanner.setFont(u8g2_font_6x10_tf);  oledBanner.drawStr(0, 25, (String("@ ") + a.node).c_str());
    oledBanner.drawHLine(0, 28, 128);
    drawWrapped(oledBanner, a.narr, 0, 39, 128, 11, 3);
  }
  oledBanner.sendBuffer();
}

static void renderAll() { renderMenu(); renderDetail(); renderBanner(); }
static void splash(const char* msg) {
  for (U8G2* g : { &oledMenu, &oledDetail, &oledBanner }) { g->clearBuffer(); g->setFont(u8g2_font_6x12_tf); g->drawStr(0, 24, "CYBER CHAUKIDAAR"); g->drawStr(0, 40, msg); g->sendBuffer(); }
}

// ---- buttons (active-low, debounced edge detect) ----
struct Button { uint8_t pin; bool last; uint32_t tChange; };
static Button btns[5] = { {BTN_UP,1,0}, {BTN_DOWN,1,0}, {BTN_SELECT,1,0}, {BTN_LEFT,1,0}, {BTN_RIGHT,1,0} };
enum { BUP, BDOWN, BSEL, BLEFT, BRIGHT };
static int pollButtons() { // returns index of a freshly-pressed button, or -1
  int hit = -1; uint32_t t = millis();
  for (int i = 0; i < 5; i++) {
    bool raw = digitalRead(btns[i].pin);   // HIGH idle, LOW pressed
    if (raw != btns[i].last && t - btns[i].tChange > 25) {
      btns[i].tChange = t;
      if (btns[i].last == 1 && raw == 0) hit = i;   // falling edge = press
      btns[i].last = raw;
    }
  }
  return hit;
}
static void onButton(int b) {
  if (b == BUP)    menuSel = (menuSel + M_COUNT - 1) % M_COUNT;
  if (b == BDOWN)  menuSel = (menuSel + 1) % M_COUNT;
  if (b == BLEFT)  { if (menuSel == M_NODES && nodeCount) pageNode = (pageNode + nodeCount - 1) % nodeCount;
                     if (menuSel == M_ALERTS && alertCount) pageAlert = (pageAlert + alertCount - 1) % alertCount; }
  if (b == BRIGHT) { if (menuSel == M_NODES && nodeCount) pageNode = (pageNode + 1) % nodeCount;
                     if (menuSel == M_ALERTS && alertCount) pageAlert = (pageAlert + 1) % alertCount; }
  if (b == BSEL)   doSelect();
  dirty = true;
}

// ---- guided button mapping (results shown on OLED0, no serial needed) ----
static void runBtnScan() {
  const int pins[] = { 0, 2, 5, 13, 14, 15, 23, 25, 26, 27, 32, 33 };
  const int N = sizeof(pins) / sizeof(pins[0]);
  for (int i = 0; i < N; i++) pinMode(pins[i], INPUT_PULLUP);
  const char* names[5] = { "UP", "DOWN", "LEFT", "RIGHT", "SELECT" };
  int mapped[5] = { -1, -1, -1, -1, -1 };
  for (int b = 0; b < 5; b++) {
    oledMenu.clearBuffer(); oledMenu.setFont(u8g2_font_6x12_tf); oledMenu.drawStr(0, 12, "BUTTON SETUP");
    oledMenu.setFont(u8g2_font_9x15B_tf); oledMenu.drawStr(0, 40, (String("Press ") + names[b]).c_str());
    oledMenu.setFont(u8g2_font_5x8_tf); oledMenu.drawStr(0, 60, "waiting..."); oledMenu.sendBuffer();
    int got = -1; uint32_t t0 = millis();
    while (millis() - t0 < 25000) { for (int i = 0; i < N; i++) if (digitalRead(pins[i]) == 0) { got = pins[i]; break; } if (got >= 0) break; delay(5); }
    mapped[b] = got;
    delay(60);
    if (got >= 0) { uint32_t r = millis(); while (digitalRead(got) == 0 && millis() - r < 6000) delay(5); }  // wait release
    oledMenu.clearBuffer(); oledMenu.setFont(u8g2_font_7x14B_tf);
    oledMenu.drawStr(0, 36, got >= 0 ? (String(names[b]) + " = GPIO " + got).c_str() : (String(names[b]) + " = none").c_str());
    oledMenu.sendBuffer(); Serial.printf("[btnscan] %s = GPIO %d\n", names[b], got); delay(800);
  }
  oledMenu.clearBuffer(); oledMenu.setFont(u8g2_font_5x8_tf); oledMenu.drawStr(0, 8, "BUTTON MAP - tell Claude:");
  for (int b = 0; b < 5; b++) { char buf[28]; snprintf(buf, sizeof(buf), "%-7s GPIO %d", names[b], mapped[b]); oledMenu.drawStr(0, 22 + b * 9, buf); }
  oledMenu.sendBuffer();
  Serial.printf("[btnscan] MAP UP=%d DOWN=%d LEFT=%d RIGHT=%d SELECT=%d\n", mapped[0], mapped[1], mapped[2], mapped[3], mapped[4]);
}

// ---- serial console ----
static void handleConsole() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read(); if (c == '\r') continue;
    if (c != '\n') { if (line.length() < 120) line += c; continue; }
    line.trim();
    if (line.startsWith("cfg wifi ")) { int sp = line.indexOf(' ', 9); if (sp > 0) { wifiSsid = line.substring(9, sp); wifiPass = line.substring(sp + 1); saveKV("ssid", wifiSsid); saveKV("pass", wifiPass); Serial.println("saved"); } }
    else if (line.startsWith("cfg server ")) { serverCfg = line.substring(11); serverCfg.trim(); saveKV("url", serverCfg); serverUrl = serverCfg.equalsIgnoreCase("auto") ? String() : serverCfg; Serial.println("saved"); }
    else if (line == "cfg show" || line == "cfg") { Serial.printf("ssid:%s server:%s resolved:%s link:%s\n", wifiSsid.c_str(), serverCfg.c_str(), serverUrl.length() ? serverUrl.c_str() : "(discovering)", linkUp ? "up" : "down"); }
    else if (line == "scan") { int n = WiFi.scanNetworks(); for (int i = 0; i < n; i++) Serial.printf("  %2d) rssi %4d ch %2d %s\n", i, WiFi.RSSI(i), WiFi.channel(i), WiFi.SSID(i).c_str()); if (!n) Serial.println("  (none)"); WiFi.scanDelete(); }
    else if (line == "btnscan") { runBtnScan(); }
    else if (line == "reboot") ESP.restart();
    line = "";
  }
}

// ---- arduino ----
void setup() {
  Serial.begin(SERIAL_BAUD); delay(200);
  Serial.printf("\nCYBER CHAUKIDAAR base station fw %s\n", BASE_FW_VERSION);
  pinMode(BTN_UP, INPUT_PULLUP); pinMode(BTN_DOWN, INPUT_PULLUP); pinMode(BTN_SELECT, INPUT_PULLUP);
  pinMode(BTN_LEFT, INPUT_PULLUP); pinMode(BTN_RIGHT, INPUT_PULLUP);
  pixel.begin(); pixel.setBrightness(STATUS_PIXEL_BRIGHT); setPix(0, 0, 10); // blue during boot
  oledMenu.begin(); oledDetail.begin(); oledBanner.begin();
  loadSettings();
  splash("connecting WiFi...");
  WiFi.mode(WIFI_STA); WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
  uint32_t t0 = millis(); while (WiFi.status() != WL_CONNECTED && millis() - t0 < 12000) delay(100);
  if (WiFi.status() == WL_CONNECTED) { Serial.printf("[base] WiFi %s ip %s\n", wifiSsid.c_str(), WiFi.localIP().toString().c_str()); splash("finding server..."); }
  else { Serial.println("[base] WiFi join failed — cfg wifi <ssid> <pass>"); splash("WiFi FAILED"); }
}

static uint32_t lastWifiTry = 0; static bool wasConnected = false;
void loop() {
  handleConsole();
  int b = pollButtons(); if (b >= 0) onButton(b);
  updateLed();

  bool conn = WiFi.status() == WL_CONNECTED;
  if (!conn && millis() - lastWifiTry > 10000 && wifiSsid.length()) { lastWifiTry = millis(); WiFi.disconnect(); WiFi.mode(WIFI_STA); WiFi.begin(wifiSsid.c_str(), wifiPass.c_str()); }
  if (conn && !wasConnected) { Serial.printf("[base] WiFi up, ip %s\n", WiFi.localIP().toString().c_str()); udp.stop(); udp.begin(DISCOVERY_PORT); discoverPoke(); dirty = true; }
  wasConnected = conn;
  if (conn) discoveryPump();

  uint32_t now = millis();
  if (now - lastPoll >= POLL_INTERVAL_MS) {
    lastPoll = now;
    if (conn) { if (!serverUrl.length()) discoverPoke(); pollServer(); dirty = true; }
  }
  if (dirty) { renderAll(); dirty = false; }
  delay(10);
}
