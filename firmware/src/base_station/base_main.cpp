// Cyber Chaukidaar base station — interactive control panel (fw 2.x).
//
//   Core 0  netTask   : WiFi, UDP discovery, polls GET /api/basestation (< 2 KB), executes queued
//                       actions (acknowledge, arm/disarm, sound node siren, change mission).
//   Core 1  loop()    : buttons (hardware interrupts), status pixel, OLED rendering, serial console.
//   The UI never waits on the network, so the keypad stays responsive even when the server is slow
//   or unreachable. (fw 1.x fetched the full /api/alerts list — hundreds of KB — on the UI thread.)
//
//   OLED0  MENU    Overview / Alerts / Nodes / Arming / Mission / System   (UP/DOWN)
//   OLED1  DETAIL  detail of the highlighted item; LEFT/RIGHT page nodes or alerts; SELECT acts
//   OLED2  BANNER  newest alert (or ALL CLEAR) + armed state + mission, always visible
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
static Adafruit_NeoPixel pixel(STATUS_PIXEL_COUNT, STATUS_PIXEL_PIN, NEO_GRB + NEO_KHZ800);

// ------------------------------------------------------------------ settings (serial `cfg ...`)
static Preferences prefs;
static String wifiSsid, wifiPass, serverCfg, panelKey;   // panelKey -> X-Panel-Key (server PANEL_KEY)
static void loadSettings() {
  prefs.begin("base", false);
  wifiSsid  = prefs.isKey("ssid") ? prefs.getString("ssid") : String(BASE_WIFI_SSID);
  wifiPass  = prefs.isKey("pass") ? prefs.getString("pass") : String(BASE_WIFI_PASS);
  serverCfg = prefs.isKey("url")  ? prefs.getString("url")  : String(BASE_SERVER_URL);
  panelKey  = prefs.isKey("key")  ? prefs.getString("key")  : String("");
  prefs.end();
}
static void saveKV(const char* k, const String& v) { prefs.begin("base", false); prefs.putString(k, v); prefs.end(); }
static bool autoMode() { return serverCfg.equalsIgnoreCase("auto") || !serverCfg.length(); }

// ------------------------------------------------------------------ shared state (net task -> UI)
struct NodeV  { String id, name, status, level; int battery, rssi; bool sim; };
struct AlertV { String id, severity, kind, title, node, text; bool sim; };
struct Snap {
  String arm = "?", missionId, mission;
  long up = -1; int online = 0, total = 0, activeCount = 0;
  NodeV nodes[6]; int nodeCount = 0;
  AlertV alerts[6]; int alertCount = 0;
  bool link = false; uint32_t lastOk = 0;
  String server; String ip;
};
static Snap shared;                         // written by netTask under `mtx`
static SemaphoreHandle_t mtx;
static volatile bool dataDirty = true;      // netTask -> UI: new snapshot available

// ------------------------------------------------------------------ actions (UI -> net task)
enum ActType : uint8_t { ACT_ACK, ACT_ARM, ACT_DISARM, ACT_DETER, ACT_MISSION, ACT_REFRESH };
struct Action { ActType type; char arg[48]; };
static QueueHandle_t actQ;
static String actionMsg; static uint32_t actionMsgAt = 0;   // feedback line on OLED1 (UI-owned)
static volatile bool actionDone = false; static char actionResult[48] = "";

static void queueAction(ActType t, const String& arg, const char* pending) {
  Action a{}; a.type = t; strncpy(a.arg, arg.c_str(), sizeof(a.arg) - 1);
  if (xQueueSend(actQ, &a, 0) == pdTRUE) { actionMsg = pending; actionMsgAt = millis(); }
  else { actionMsg = "busy, try again"; actionMsgAt = millis(); }
}

// ------------------------------------------------------------------ network task (core 0)
static WiFiUDP udp;
static String serverUrl;   // resolved base URL (net task only)

static bool onOurSubnet(const String& url) {
  int a = url.indexOf("://"); if (a < 0) return false; a += 3;
  int b = url.indexOf(':', a); String host = b < 0 ? url.substring(a) : url.substring(a, b);
  IPAddress ip; if (!ip.fromString(host)) return false;
  IPAddress me = WiFi.localIP();
  return ip[0] == me[0] && ip[1] == me[1] && ip[2] == me[2];
}
static void discoverPoke() { IPAddress b = WiFi.broadcastIP(); udp.beginPacket(b, DISCOVERY_PORT); udp.print("CYBERCC_DISCOVER"); udp.endPacket(); }
static void discoveryPump() {
  for (int guard = 0; guard < 8; guard++) {          // drain a few packets per pass, never loop forever
    int n = udp.parsePacket(); if (n <= 0) return;
    char buf[96]; int len = udp.read(buf, sizeof(buf) - 1); if (len <= 0) return; buf[len] = 0;
    const char* p = strstr(buf, "CYBERCC_SERVER "); if (!p) continue;
    String url = String(p + 15); url.trim();
    while (url.length() && (url.endsWith("/") || url.endsWith("\n") || url.endsWith("\r"))) url.remove(url.length() - 1);
    if (!url.length() || url == serverUrl) continue;
    // the server beacons one IP per interface (WiFi, USB-LAN, VPN); only our subnet is reachable
    if (!serverUrl.length() || (onOurSubnet(url) && !onOurSubnet(serverUrl))) serverUrl = url;
  }
}

static int httpPost(const String& path, const String& body) {
  if (!serverUrl.length()) return -1;
  HTTPClient http; http.setConnectTimeout(1500); http.setTimeout(2500);
  if (!http.begin(serverUrl + path)) return -1;
  http.addHeader("Content-Type", "application/json");
  if (panelKey.length()) http.addHeader("X-Panel-Key", panelKey);
  int code = http.POST((uint8_t*)body.c_str(), body.length());
  http.end(); return code;
}

static bool pollOnce() {
  if (!serverUrl.length()) return false;
  HTTPClient http; http.setConnectTimeout(1500); http.setTimeout(2500);
  if (!http.begin(serverUrl + "/api/basestation")) return false;
  http.addHeader("X-Panel-Fw", BASE_FW_VERSION);
  if (panelKey.length()) http.addHeader("X-Panel-Key", panelKey);
  int code = http.GET();
  if (code != 200) { http.end(); return false; }
  JsonDocument d;
  DeserializationError e = deserializeJson(d, http.getStream());
  http.end();
  if (e) return false;
  Snap s;
  s.arm = (const char*)(d["arm"] | "?"); s.missionId = (const char*)(d["mid"] | ""); s.mission = (const char*)(d["mis"] | "");
  s.up = d["up"] | -1; s.online = d["on"] | 0; s.total = d["tot"] | 0; s.activeCount = d["ac"] | 0;
  for (JsonObject n : d["nodes"].as<JsonArray>()) {
    if (s.nodeCount >= 6) break;
    NodeV& v = s.nodes[s.nodeCount++];
    v.id = (const char*)(n["id"] | ""); v.name = (const char*)(n["nm"] | ""); v.status = (const char*)(n["st"] | "");
    v.level = (const char*)(n["lv"] | "-"); v.battery = n["bat"] | -1; v.rssi = n["rssi"] | 0; v.sim = (n["sim"] | 0) != 0;
  }
  for (JsonObject a : d["al"].as<JsonArray>()) {
    if (s.alertCount >= 6) break;
    AlertV& v = s.alerts[s.alertCount++];
    v.id = (const char*)(a["id"] | ""); v.severity = (const char*)(a["sv"] | ""); v.kind = (const char*)(a["k"] | "");
    v.title = (const char*)(a["t"] | ""); v.node = (const char*)(a["n"] | ""); v.text = (const char*)(a["tx"] | ""); v.sim = (a["sim"] | 0) != 0;
  }
  s.link = true; s.lastOk = millis(); s.server = serverUrl; s.ip = WiFi.localIP().toString();
  xSemaphoreTake(mtx, portMAX_DELAY); shared = s; xSemaphoreGive(mtx);
  dataDirty = true;
  return true;
}

static void markOffline() {
  xSemaphoreTake(mtx, portMAX_DELAY);
  bool was = shared.link; shared.link = false; shared.server = serverUrl; shared.ip = WiFi.localIP().toString();
  xSemaphoreGive(mtx);
  if (was) dataDirty = true;
}

static void runAction(const Action& a) {
  int code = -1; const char* ok = "done";
  switch (a.type) {
    case ACT_ACK:     code = httpPost(String("/api/alerts/") + a.arg + "/acknowledge", "{\"by\":\"base-station\"}"); ok = "alert acknowledged"; break;
    case ACT_ARM:     code = httpPost("/api/system/arming", "{\"mode\":\"ARMED\",\"by\":\"base-station\"}"); ok = "site ARMED"; break;
    case ACT_DISARM:  code = httpPost("/api/system/arming", "{\"mode\":\"DISARMED\",\"by\":\"base-station\"}"); ok = "site DISARMED"; break;
    case ACT_DETER:   code = httpPost(String("/api/nodes/") + a.arg + "/command", "{\"deter\":10}"); ok = "siren sent"; break;
    case ACT_MISSION: code = httpPost("/api/system/profile", "{\"next\":true,\"by\":\"base-station\"}"); ok = "mission changed"; break;
    case ACT_REFRESH: code = 200; ok = "refreshed"; break;
  }
  snprintf(actionResult, sizeof(actionResult), "%s", (code >= 200 && code < 300) ? ok : (code < 0 ? "no server link" : "server refused"));
  actionDone = true;
}

static void netTask(void*) {
  bool wasUp = false; uint32_t lastWifiTry = 0, lastPoll = 0, lastPoke = 0;
  for (;;) {
    bool up = WiFi.status() == WL_CONNECTED;
    if (!up && wifiSsid.length() && millis() - lastWifiTry > 10000) {
      lastWifiTry = millis(); WiFi.disconnect(); WiFi.mode(WIFI_STA); WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
    }
    if (up && !wasUp) {
      Serial.printf("[base] WiFi up, ip %s\n", WiFi.localIP().toString().c_str());
      if (autoMode()) { udp.stop(); udp.begin(DISCOVERY_PORT); discoverPoke(); } else serverUrl = serverCfg;
    }
    if (!up && wasUp) markOffline();
    wasUp = up;

    if (up) {
      if (autoMode()) { discoveryPump(); if (!serverUrl.length() && millis() - lastPoke > 3000) { lastPoke = millis(); discoverPoke(); } }
      Action a;
      if (xQueueReceive(actQ, &a, 0) == pdTRUE) { runAction(a); lastPoll = 0; }   // act, then refresh immediately
      if (millis() - lastPoll >= POLL_INTERVAL_MS) { lastPoll = millis(); if (!pollOnce()) markOffline(); }
    }
    vTaskDelay(pdMS_TO_TICKS(40));
  }
}

// ------------------------------------------------------------------ buttons (interrupt-driven)
static const uint8_t BTN_PINS[5] = { BTN_UP, BTN_DOWN, BTN_SELECT, BTN_LEFT, BTN_RIGHT };
enum { BUP, BDOWN, BSEL, BLEFT, BRIGHT };
static volatile uint8_t pressedMask = 0;
static volatile uint32_t lastIrq[5] = { 0 };
static void IRAM_ATTR onBtn(int i) {
  uint32_t t = millis();
  if (t - lastIrq[i] > 160) { lastIrq[i] = t; pressedMask |= (1 << i); }   // debounce in the ISR
}
static void IRAM_ATTR isrUp()    { onBtn(BUP); }
static void IRAM_ATTR isrDown()  { onBtn(BDOWN); }
static void IRAM_ATTR isrSel()   { onBtn(BSEL); }
static void IRAM_ATTR isrLeft()  { onBtn(BLEFT); }
static void IRAM_ATTR isrRight() { onBtn(BRIGHT); }

// ------------------------------------------------------------------ UI state (core 1 only)
enum MenuItem { M_OVERVIEW, M_ALERTS, M_NODES, M_ARMING, M_MISSION, M_SYSTEM, M_COUNT };
static const char* MENU_LABELS[M_COUNT] = { "Overview", "Alerts", "Nodes", "Arming", "Mission", "System" };
static int menuSel = 0, menuTop = 0, pageNode = 0, pageAlert = 0;
static Snap view;                       // UI's private copy of the shared snapshot
static bool dirtyMenu = true, dirtyDetail = true, dirtyBanner = true;

static void takeSnapshot() {
  xSemaphoreTake(mtx, portMAX_DELAY); view = shared; xSemaphoreGive(mtx);
  if (pageNode >= view.nodeCount) pageNode = view.nodeCount ? view.nodeCount - 1 : 0;
  if (pageAlert >= view.alertCount) pageAlert = view.alertCount ? view.alertCount - 1 : 0;
}

static void onButton(int b) {
  if (b == BUP)   { menuSel = (menuSel + M_COUNT - 1) % M_COUNT; dirtyMenu = dirtyDetail = true; }
  if (b == BDOWN) { menuSel = (menuSel + 1) % M_COUNT; dirtyMenu = dirtyDetail = true; }
  if (b == BLEFT || b == BRIGHT) {
    int d = b == BLEFT ? -1 : 1;
    if (menuSel == M_NODES && view.nodeCount)   pageNode  = (pageNode + d + view.nodeCount) % view.nodeCount;
    if (menuSel == M_ALERTS && view.alertCount) pageAlert = (pageAlert + d + view.alertCount) % view.alertCount;
    dirtyDetail = true;
  }
  if (b == BSEL) {
    if (menuSel == M_ALERTS && view.alertCount) queueAction(ACT_ACK, view.alerts[pageAlert].id, "acknowledging...");
    else if (menuSel == M_NODES && view.nodeCount) {
      if (view.nodes[pageNode].sim) { actionMsg = "simulated node"; actionMsgAt = millis(); }
      else queueAction(ACT_DETER, view.nodes[pageNode].id, "sounding siren...");
    }
    else if (menuSel == M_ARMING) queueAction(view.arm.equalsIgnoreCase("DISARMED") ? ACT_ARM : ACT_DISARM, "", "changing arming...");
    else if (menuSel == M_MISSION) queueAction(ACT_MISSION, "", "switching mission...");
    else queueAction(ACT_REFRESH, "", "refreshing...");
    dirtyDetail = true;
  }
  if (menuSel < menuTop) menuTop = menuSel;
  if (menuSel > menuTop + 3) menuTop = menuSel - 3;
}

// ------------------------------------------------------------------ status pixel
static void setPix(uint8_t r, uint8_t g, uint8_t b) { pixel.setPixelColor(0, pixel.Color(r, g, b)); pixel.show(); }
static void updateLed() {
  static uint32_t last = 0; uint32_t t = millis();
  if (t - last < 40) return; last = t;
  bool critical = false;
  for (int i = 0; i < view.alertCount; i++) if (!view.alerts[i].sim && view.alerts[i].severity == "CRITICAL") critical = true;
  bool active = false; for (int i = 0; i < view.alertCount; i++) if (!view.alerts[i].sim) active = true;
  if (!view.link)                 setPix(0, 0, (t / 600) % 2 ? 8 : 2);                        // no server: slow dim blue
  else if (critical)              setPix(90, 0, 0);                                            // critical: solid red
  else if (active)                setPix((t / 150) % 2 ? 90 : 0, (t / 150) % 2 ? 25 : 0, 0);  // active: blink orange
  else if (view.arm == "DISARMED") setPix(0, 0, 0);                                            // disarmed: off
  else                            setPix(0, (t % 2000) < 70 ? 45 : 0, 0);                      // armed & clear: green pulse
}

// ------------------------------------------------------------------ rendering
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
  oledMenu.setFont(u8g2_font_6x12_tf); oledMenu.drawStr(0, 10, "CHAUKIDAAR");
  oledMenu.setFont(u8g2_font_5x8_tf);  oledMenu.drawStr(view.link ? 104 : 98, 9, view.link ? "LINK" : "NO-LINK");
  oledMenu.drawHLine(0, 12, 128);
  oledMenu.setFont(u8g2_font_6x12_tf);
  for (int row = 0; row < 4; row++) {
    int i = menuTop + row; if (i >= M_COUNT) break;
    int y = 25 + row * 12;
    if (i == menuSel) { oledMenu.drawBox(0, y - 10, 122, 12); oledMenu.setDrawColor(0); }
    String label = String(MENU_LABELS[i]);
    if (i == M_ALERTS && view.activeCount) label += " (" + String(view.activeCount) + ")";
    oledMenu.drawStr(4, y, label.c_str());
    oledMenu.setDrawColor(1);
  }
  int barH = 48 * 4 / M_COUNT, barY = 14 + 48 * menuTop / M_COUNT;   // scroll indicator
  oledMenu.drawFrame(124, 14, 4, 50); oledMenu.drawBox(125, barY, 2, barH);
  oledMenu.sendBuffer();
}

static void renderDetail() {
  oledDetail.clearBuffer();
  oledDetail.setFont(u8g2_font_6x12_tf); oledDetail.drawStr(0, 10, MENU_LABELS[menuSel]);
  oledDetail.drawHLine(0, 13, 128);
  oledDetail.setFont(u8g2_font_6x10_tf);
  char b[64];
  if (menuSel == M_OVERVIEW) {
    snprintf(b, sizeof(b), "Site   %s", view.arm.c_str());                         oledDetail.drawStr(0, 25, b);
    snprintf(b, sizeof(b), "Nodes  %d/%d online", view.online, view.total);         oledDetail.drawStr(0, 36, b);
    snprintf(b, sizeof(b), "Alerts %d active", view.activeCount);                  oledDetail.drawStr(0, 47, b);
    snprintf(b, sizeof(b), "Mission %s", view.mission.c_str());                    oledDetail.drawStr(0, 58, b);
  } else if (menuSel == M_ALERTS) {
    if (!view.alertCount) oledDetail.drawStr(0, 34, "No active alerts");
    else {
      AlertV& a = view.alerts[pageAlert];
      snprintf(b, sizeof(b), "%d/%d %s%s", pageAlert + 1, view.alertCount, a.severity.c_str(), a.sim ? " SIM" : ""); oledDetail.drawStr(0, 24, b);
      oledDetail.drawStr(0, 34, a.title.c_str());
      oledDetail.setFont(u8g2_font_5x8_tf);
      drawWrapped(oledDetail, String("@") + a.node + " " + a.text, 0, 43, 128, 8, 2);
      oledDetail.drawStr(0, 63, "SEL=ack  </>=page");
    }
  } else if (menuSel == M_NODES) {
    if (!view.nodeCount) oledDetail.drawStr(0, 34, "No nodes");
    else {
      NodeV& n = view.nodes[pageNode];
      snprintf(b, sizeof(b), "%d/%d %s%s", pageNode + 1, view.nodeCount, n.name.c_str(), n.sim ? " SIM" : ""); oledDetail.drawStr(0, 24, b);
      snprintf(b, sizeof(b), "%s  %s", n.status.c_str(), n.level.c_str());           oledDetail.drawStr(0, 35, b);
      if (n.battery >= 0) snprintf(b, sizeof(b), "bat %d%%  rssi %d", n.battery, n.rssi); else snprintf(b, sizeof(b), "no telemetry yet");
      oledDetail.drawStr(0, 46, b);
      oledDetail.setFont(u8g2_font_5x8_tf); oledDetail.drawStr(0, 63, n.sim ? "</>=page" : "SEL=siren 10s  </>=page");
    }
  } else if (menuSel == M_ARMING) {
    oledDetail.setFont(u8g2_font_9x15B_tf); oledDetail.drawStr(0, 36, view.arm.c_str());
    oledDetail.setFont(u8g2_font_5x8_tf);
    oledDetail.drawStr(0, 63, view.arm.equalsIgnoreCase("DISARMED") ? "SEL=arm site" : "SEL=disarm site");
  } else if (menuSel == M_MISSION) {
    oledDetail.setFont(u8g2_font_7x14B_tf); oledDetail.drawStr(0, 34, view.mission.length() ? view.mission.c_str() : "-");
    oledDetail.setFont(u8g2_font_5x8_tf);
    oledDetail.drawStr(0, 48, view.missionId == "nuclear" ? "wildlife vs people" : view.missionId == "border" ? "tunnels, silent alarm" :
                              view.missionId == "retail" ? "drilling, intruders" : "people & vehicles");
    oledDetail.drawStr(0, 63, "SEL=next mission");
  } else {
    oledDetail.setFont(u8g2_font_5x8_tf);
    oledDetail.drawStr(0, 24, ("srv " + (view.server.length() ? view.server : String(autoMode() ? "(discovering)" : serverCfg))).c_str());
    oledDetail.drawStr(0, 34, ("ip  " + (view.ip.length() ? view.ip : WiFi.localIP().toString())).c_str());
    snprintf(b, sizeof(b), "fw %s  up %lds", BASE_FW_VERSION, view.up);          oledDetail.drawStr(0, 44, b);
    snprintf(b, sizeof(b), "link %s  heap %u", view.link ? "up" : "down", (unsigned)ESP.getFreeHeap()); oledDetail.drawStr(0, 54, b);
  }
  if (actionMsg.length() && millis() - actionMsgAt < 3000) {   // action feedback strip
    oledDetail.setDrawColor(0); oledDetail.drawBox(0, 0, 128, 12); oledDetail.setDrawColor(1);
    oledDetail.drawFrame(0, 0, 128, 12); oledDetail.setFont(u8g2_font_5x8_tf); oledDetail.drawStr(3, 9, actionMsg.c_str());
  }
  oledDetail.sendBuffer();
}

static void renderBanner() {
  oledBanner.clearBuffer();
  int real = -1; for (int i = 0; i < view.alertCount; i++) if (!view.alerts[i].sim) { real = i; break; }
  if (!view.link) {
    oledBanner.setFont(u8g2_font_7x14B_tf); oledBanner.drawStr(8, 30, "NO SERVER LINK");
    oledBanner.setFont(u8g2_font_5x8_tf);   oledBanner.drawStr(0, 50, WiFi.status() == WL_CONNECTED ? "WiFi ok, finding server..." : "joining WiFi...");
  } else if (real < 0) {
    oledBanner.setFont(u8g2_font_9x15B_tf); oledBanner.drawStr(20, 30, "ALL CLEAR");
    oledBanner.setFont(u8g2_font_5x8_tf);
    oledBanner.drawStr(0, 50, (String("Site ") + view.arm + "  " + view.mission).c_str());
    oledBanner.drawStr(0, 60, (String(view.online) + "/" + view.total + " nodes online").c_str());
  } else {
    AlertV& a = view.alerts[real];
    oledBanner.setFont(u8g2_font_7x14B_tf); oledBanner.drawStr(0, 13, a.severity.c_str());
    oledBanner.setFont(u8g2_font_6x10_tf);  oledBanner.drawStr(0, 25, a.title.c_str());
    oledBanner.drawHLine(0, 28, 128);
    oledBanner.setFont(u8g2_font_5x8_tf);
    drawWrapped(oledBanner, String("@") + a.node + " " + a.text, 0, 38, 128, 9, 3);
  }
  oledBanner.sendBuffer();
}

static void splash(const char* msg) {
  for (U8G2* g : { &oledMenu, &oledDetail, &oledBanner }) { g->clearBuffer(); g->setFont(u8g2_font_6x12_tf); g->drawStr(0, 24, "CYBER CHAUKIDAAR"); g->drawStr(0, 40, msg); g->sendBuffer(); }
}

// ------------------------------------------------------------------ diagnostics
static void runBtnScan() {
  const int pins[] = { 0, 2, 5, 13, 14, 15, 23, 25, 26, 27, 32, 33 };
  const int N = sizeof(pins) / sizeof(pins[0]);
  for (int i = 0; i < 5; i++) detachInterrupt(digitalPinToInterrupt(BTN_PINS[i]));
  for (int i = 0; i < N; i++) if (pins[i] != STATUS_PIXEL_PIN) pinMode(pins[i], INPUT_PULLUP);
  const char* names[5] = { "UP", "DOWN", "LEFT", "RIGHT", "SELECT" };
  int mapped[5] = { -1, -1, -1, -1, -1 };
  for (int b = 0; b < 5; b++) {
    oledMenu.clearBuffer(); oledMenu.setFont(u8g2_font_6x12_tf); oledMenu.drawStr(0, 12, "BUTTON SETUP");
    oledMenu.setFont(u8g2_font_9x15B_tf); oledMenu.drawStr(0, 40, (String("Press ") + names[b]).c_str()); oledMenu.sendBuffer();
    int got = -1; uint32_t t0 = millis();
    while (millis() - t0 < 25000) { for (int i = 0; i < N; i++) if (pins[i] != STATUS_PIXEL_PIN && digitalRead(pins[i]) == 0) { got = pins[i]; break; } if (got >= 0) break; delay(5); }
    mapped[b] = got; delay(60);
    if (got >= 0) { uint32_t r = millis(); while (digitalRead(got) == 0 && millis() - r < 6000) delay(5); }
    Serial.printf("[btnscan] %s = GPIO %d\n", names[b], got); delay(400);
  }
  Serial.printf("[btnscan] MAP UP=%d DOWN=%d LEFT=%d RIGHT=%d SELECT=%d (reboot to resume)\n", mapped[0], mapped[1], mapped[2], mapped[3], mapped[4]);
}

static void handleConsole() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read(); if (c == '\r') continue;
    if (c != '\n') { if (line.length() < 120) line += c; continue; }
    line.trim();
    if (line.startsWith("cfg wifi ")) { int sp = line.indexOf(' ', 9); if (sp > 0) { wifiSsid = line.substring(9, sp); wifiPass = line.substring(sp + 1); saveKV("ssid", wifiSsid); saveKV("pass", wifiPass); Serial.println("saved; reconnecting"); WiFi.disconnect(); } }
    else if (line.startsWith("cfg server ")) { serverCfg = line.substring(11); serverCfg.trim(); saveKV("url", serverCfg); Serial.println("saved; reboot to apply"); }
    else if (line.startsWith("cfg key ")) { panelKey = line.substring(8); panelKey.trim(); saveKV("key", panelKey); Serial.println("panel key saved"); }
    else if (line == "cfg show" || line == "cfg") {
      xSemaphoreTake(mtx, portMAX_DELAY); Snap s = shared; xSemaphoreGive(mtx);
      Serial.printf("fw:%s ssid:%s server:%s resolved:%s key:%s link:%s heap:%u\n", BASE_FW_VERSION, wifiSsid.c_str(), serverCfg.c_str(), s.server.c_str(), panelKey.length() ? "set" : "none", s.link ? "up" : "down", (unsigned)ESP.getFreeHeap());
    }
    else if (line == "scan") { int n = WiFi.scanNetworks(); for (int i = 0; i < n; i++) Serial.printf("  %2d) rssi %4d ch %2d %s\n", i, WiFi.RSSI(i), WiFi.channel(i), WiFi.SSID(i).c_str()); if (!n) Serial.println("  (none)"); WiFi.scanDelete(); }
    else if (line == "btnscan") runBtnScan();
    else if (line == "reboot") ESP.restart();
    line = "";
  }
}

// ------------------------------------------------------------------ arduino
void setup() {
  Serial.begin(SERIAL_BAUD); delay(200);
  Serial.printf("\nCYBER CHAUKIDAAR base station fw %s\n", BASE_FW_VERSION);
  pixel.begin(); pixel.setBrightness(STATUS_PIXEL_BRIGHT); setPix(0, 0, 10);
  for (int i = 0; i < 5; i++) pinMode(BTN_PINS[i], INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(BTN_UP), isrUp, FALLING);
  attachInterrupt(digitalPinToInterrupt(BTN_DOWN), isrDown, FALLING);
  attachInterrupt(digitalPinToInterrupt(BTN_SELECT), isrSel, FALLING);
  attachInterrupt(digitalPinToInterrupt(BTN_LEFT), isrLeft, FALLING);
  attachInterrupt(digitalPinToInterrupt(BTN_RIGHT), isrRight, FALLING);
  oledMenu.begin(); oledDetail.begin(); oledBanner.begin();
  loadSettings();
  splash(wifiSsid.length() ? "connecting WiFi..." : "set WiFi: cfg wifi");
  mtx = xSemaphoreCreateMutex();
  actQ = xQueueCreate(6, sizeof(Action));
  WiFi.mode(WIFI_STA);
  if (wifiSsid.length()) WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
  xTaskCreatePinnedToCore(netTask, "net", 12288, nullptr, 1, nullptr, 0);   // networking on core 0
}

void loop() {
  handleConsole();
  uint8_t m; noInterrupts(); m = pressedMask; pressedMask = 0; interrupts();
  for (int i = 0; i < 5; i++) if (m & (1 << i)) onButton(i);
  if (actionDone) { actionDone = false; actionMsg = actionResult; actionMsgAt = millis(); dirtyDetail = true; }
  if (dataDirty) { dataDirty = false; takeSnapshot(); dirtyMenu = dirtyDetail = dirtyBanner = true; }
  static uint32_t msgShown = 0;   // clear the feedback strip after it expires
  if (actionMsg.length() && millis() - actionMsgAt >= 3000 && msgShown != actionMsgAt) { msgShown = actionMsgAt; dirtyDetail = true; }
  updateLed();
  // render only what changed; a fresh button press is handled before each (slow, bit-banged) screen
  if (dirtyMenu)   { dirtyMenu = false;   renderMenu(); }
  if (pressedMask) return;
  if (dirtyDetail) { dirtyDetail = false; renderDetail(); }
  if (pressedMask) return;
  if (dirtyBanner) { dirtyBanner = false; renderBanner(); }
  delay(5);
}
