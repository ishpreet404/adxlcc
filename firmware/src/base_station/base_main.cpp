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
  String arm = "?", missionId, mission; bool audible = true;
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
enum ActType : uint8_t { ACT_ACK, ACT_ARM, ACT_DISARM, ACT_DETER, ACT_MISSION, ACT_REFRESH, ACT_SILENCE, ACT_PANIC,
                         ACT_TEST, ACT_SET_MISSION, ACT_NODE_SILENCE, ACT_NODE_LIVE, ACT_NODE_CAL };
struct Action { ActType type; char arg[48]; };
static QueueHandle_t actQ;
static String actionMsg; static uint32_t actionMsgAt = 0;   // feedback line on OLED1 (UI-owned)
static volatile bool actionDone = false; static char actionResult[48] = "";
static volatile bool actionPending = false;   // one action in flight: extra presses can't stack up toggles

static void queueAction(ActType t, const String& arg, const char* pending) {
  if (actionPending) { actionMsg = "busy - one moment..."; actionMsgAt = millis(); return; }
  Action a{}; a.type = t; strncpy(a.arg, arg.c_str(), sizeof(a.arg) - 1);
  if (xQueueSend(actQ, &a, 0) == pdTRUE) { actionPending = true; actionMsg = pending; actionMsgAt = millis(); }
  else { actionMsg = "busy - one moment..."; actionMsgAt = millis(); }
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
  s.arm = (const char*)(d["arm"] | "?"); s.missionId = (const char*)(d["mid"] | ""); s.mission = (const char*)(d["mis"] | ""); s.audible = (d["aud"] | 1) != 0;
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
    case ACT_SILENCE: code = httpPost("/api/system/silence", "{\"by\":\"base-station\"}"); ok = "sirens silenced"; break;
    case ACT_PANIC:   code = httpPost("/api/system/panic", "{\"by\":\"base-station\"}"); ok = "PANIC ALARM SENT"; break;
    case ACT_TEST:    code = httpPost("/api/system/arming", "{\"mode\":\"TEST\",\"by\":\"base-station\"}"); ok = "site in TEST mode"; break;
    case ACT_SET_MISSION: code = httpPost("/api/system/profile", String("{\"id\":\"") + a.arg + "\",\"by\":\"base-station\"}"); ok = "mission changed"; break;
    case ACT_NODE_SILENCE: code = httpPost(String("/api/nodes/") + a.arg + "/command", "{\"silence\":true}"); ok = "silence sent"; break;
    case ACT_NODE_LIVE:    code = httpPost(String("/api/nodes/") + a.arg + "/command", "{\"mode\":\"LIVE\",\"liveFor\":300}"); ok = "live mode on (5 min)"; break;
    case ACT_NODE_CAL:     code = httpPost(String("/api/nodes/") + a.arg + "/command", "{\"calibrate\":true}"); ok = "calibrating"; break;
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

    if (!up) {
      Action a;
      if (xQueueReceive(actQ, &a, 0) == pdTRUE) { snprintf(actionResult, sizeof(actionResult), "no WiFi - not sent"); actionDone = true; }
    }
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
enum MenuItem { M_OVERVIEW, M_ALERTS, M_NODES, M_ARMING, M_MISSION, M_SIREN, M_SYSTEM, M_COUNT };
static const char* MENU_LABELS[M_COUNT] = { "Overview", "Alerts", "Nodes", "Arming", "Mission", "Siren", "System" };
static int menuSel = 0, menuTop = 0, pageNode = 0, pageAlert = 0;
static Snap view;                       // UI's private copy of the shared snapshot
static bool dirtyMenu = true, dirtyDetail = true, dirtyBanner = true;

// ---- screen saver: dim the OLEDs after inactivity (prevents burn-in), wake on a press or alert
static uint32_t lastInputMs = 0;
static bool dimmed = false;
static const uint32_t DIM_AFTER_MS = 60000;
static void setDim(bool d) {
  if (d == dimmed) return;
  dimmed = d; uint8_t c = d ? 1 : 207;
  oledMenu.setContrast(c); oledDetail.setContrast(c); oledBanner.setContrast(c);
}
static int realAlerts(const Snap& v) { int n = 0; for (int i = 0; i < v.alertCount; i++) if (!v.alerts[i].sim) n++; return n; }

// ---- hold-to-confirm for consequential actions (disarm, panic): a tap only shows the hint
struct Hold { bool active = false; uint32_t start = 0, need = 0; ActType act = ACT_REFRESH; String arg; String label; const char* pending = ""; };
static Hold hold;
static void startHold(uint32_t ms, ActType act, const String& arg, const String& label, const char* pending) {
  if (actionPending) { actionMsg = "busy - one moment..."; actionMsgAt = millis(); return; }
  hold.active = true; hold.start = millis(); hold.need = ms; hold.act = act; hold.arg = arg; hold.label = label; hold.pending = pending;
}

// ---- page model -------------------------------------------------------------------
// MENU   : left screen lists the pages, middle previews the highlighted one.  SELECT/RIGHT opens it.
// PAGE   : left screen lists the page's rows, middle shows the selected row's details and what
//          SELECT will do.  UP/DOWN move, SELECT/RIGHT act or open, LEFT goes back.
// NODE   : actions for one node (siren, silence, live mode, calibrate).  LEFT back to Nodes.
enum Screen { SCR_MENU, SCR_PAGE, SCR_NODE };
enum Go : uint8_t { GO_NONE, GO_PAGE, GO_NODE };
struct Row {
  String label, right, detail;
  bool hasAct = false; ActType act = ACT_REFRESH; String arg; uint16_t holdMs = 0; const char* pending = "";
  Go go = GO_NONE; int target = 0; bool enabled = true;
};
static Screen screen = SCR_MENU;
static int pageId = 0, rowSel = 0, rowTop = 0, nodeIdx = 0;
static Row rows[10]; static int rowCount = 0;

static const char* MISSION_IDS[4]    = { "nuclear", "border", "retail", "perimeter" };
static const char* MISSION_NAMES[4]  = { "Nuclear zone", "Border/tunnel", "Jewelry store", "Perimeter" };
static const char* MISSION_DETAIL[4] = {
  "Unmanned exclusion zone: tells wildlife from people by gait. People are CRITICAL. Siren on.",
  "Tunnel watch: rhythmic digging with nothing on the radar. Silent alarm, no siren.",
  "After hours: drilling, hammering and intruders. Loud siren for 15 s.",
  "General fence line: people and vehicles. Siren on HIGH alerts." };

static Row& addRow(const String& label, const String& right = "") {
  Row& r = rows[rowCount++]; r = Row(); r.label = label; r.right = right; return r;
}
static void addAct(const String& label, const String& right, ActType act, const String& arg, const char* pending, const String& detail, uint16_t holdMs = 0) {
  if (rowCount >= 10) return;
  Row& r = addRow(label, right); r.hasAct = true; r.act = act; r.arg = arg; r.pending = pending; r.detail = detail; r.holdMs = holdMs;
}
static void addGo(const String& label, const String& right, Go go, int target, const String& detail) {
  if (rowCount >= 10) return;
  Row& r = addRow(label, right); r.go = go; r.target = target; r.detail = detail;
}
static void addInfo(const String& label, const String& right, const String& detail) {
  if (rowCount >= 10) return;
  Row& r = addRow(label, right); r.detail = detail;
}

static void buildRows() {
  rowCount = 0;
  if (screen == SCR_NODE) {
    if (nodeIdx >= view.nodeCount) { addInfo("Node gone", "", "This node is no longer reported by the server. Press LEFT."); return; }
    NodeV& n = view.nodes[nodeIdx];
    String info = n.status + ", " + n.level + (n.battery == -2 ? ", USB power" : n.battery >= 0 ? ", battery " + String(n.battery) + "%" : "") + ", rssi " + String(n.rssi);
    if (n.sim) { addInfo("Simulated node", "", "Simulated nodes have no siren or sensors to command. " + info); return; }
    addAct("Sound siren", "10s", ACT_DETER, n.id, "sending siren...", "Sounds the buzzer and strobes the ring on " + n.name + " for 10 s. " + info);
    addAct("Silence siren", "", ACT_NODE_SILENCE, n.id, "silencing...", "Stops a siren running on " + n.name + " now. " + info);
    addAct("Live mode", "5m", ACT_NODE_LIVE, n.id, "starting live mode...", "Streams waveforms 4x a second for 5 minutes (dashboard scopes). " + info);
    addAct("Calibrate", "", ACT_NODE_CAL, n.id, "calibrating...", "Re-learns the rest orientation and noise floor. Keep the node still. " + info);
    return;
  }
  switch (pageId) {
    case M_OVERVIEW:
      addGo("Site", view.arm, GO_PAGE, M_ARMING, "Site is " + view.arm + ". SELECT to change arming.");
      addGo("Nodes", String(view.online) + "/" + view.total, GO_PAGE, M_NODES, String(view.online) + " of " + view.total + " nodes online. SELECT for node details and controls.");
      addGo("Alerts", String(view.activeCount), GO_PAGE, M_ALERTS, String(view.activeCount) + " open alert(s). SELECT to review and acknowledge.");
      addGo("Mission", view.mission, GO_PAGE, M_MISSION, "Active mission: " + view.mission + ". SELECT to change it.");
      addAct("Panic alarm", "hold", ACT_PANIC, "", "raising panic alarm...", "CRITICAL alarm, even when disarmed. Sounds every node unless the mission is silent.", 2000);
      break;
    case M_ALERTS:
      if (!view.alertCount) { addInfo("No open alerts", "", "Nothing to acknowledge. The site is quiet."); break; }
      for (int i = 0; i < view.alertCount && rowCount < 10; i++) {
        AlertV& a = view.alerts[i];
        addAct(a.title.length() ? a.title : a.kind, a.severity.substring(0, 4), ACT_ACK, a.id, "acknowledging...",
               a.severity + (a.sim ? " (SIM) " : " ") + a.kind + " @" + a.node + ". " + a.text);
      }
      break;
    case M_NODES:
      if (!view.nodeCount) { addInfo("No nodes", "", "No sensor nodes reported yet."); break; }
      for (int i = 0; i < view.nodeCount && rowCount < 10; i++) {
        NodeV& n = view.nodes[i];
        addGo(n.name + (n.sim ? "*" : ""), n.status == "ONLINE" ? "ON" : "OFF", GO_NODE, i,
              n.status + ", " + n.level + (n.battery == -2 ? ", USB power" : n.battery >= 0 ? ", battery " + String(n.battery) + "%" : "") +
              ", rssi " + String(n.rssi) + (n.sim ? ". Simulated." : ". SELECT for siren and controls."));
      }
      break;
    case M_ARMING: {
      const char* modes[3] = { "ARMED", "TEST", "DISARMED" };
      const ActType acts[3] = { ACT_ARM, ACT_TEST, ACT_DISARM };
      const char* hints[3] = { "Alerts sound sirens and notify.", "Walk test: alerts are flagged as test, no siren.", "Detections are only logged (tamper still alerts)." };
      for (int i = 0; i < 3; i++) {
        bool cur = view.arm == modes[i];
        addAct(modes[i], cur ? "now" : "", acts[i], "", "changing arming...", String(hints[i]) + (cur ? " (current)" : " Hold SELECT 1 s."), cur ? 0 : 1000);
        if (cur) rows[rowCount - 1].enabled = false;
      }
      break;
    }
    case M_MISSION:
      for (int i = 0; i < 4; i++) {
        bool cur = view.missionId == MISSION_IDS[i];
        addAct(MISSION_NAMES[i], cur ? "now" : "", ACT_SET_MISSION, MISSION_IDS[i], "switching mission...", String(MISSION_DETAIL[i]) + (cur ? " (active)" : ""));
        if (cur) rows[rowCount - 1].enabled = false;
      }
      break;
    case M_SIREN:
      addAct("Silence all", "", ACT_SILENCE, "", "silencing sirens...", String("Stops every node's siren. Mission is ") + (view.audible ? "audible." : "silent."));
      addAct("Panic alarm", "hold", ACT_PANIC, "", "raising panic alarm...", "CRITICAL alarm, even when disarmed. Sounds every node unless the mission is silent.", 2000);
      break;
    default:   // System
      addInfo("Link", view.link ? "up" : "down", String("Server link is ") + (view.link ? "up." : "down.") + " WiFi " + (WiFi.status() == WL_CONNECTED ? "connected." : "not connected."));
      addInfo("Server", "", view.server.length() ? view.server : String(autoMode() ? "discovering..." : serverCfg));
      addInfo("Panel IP", "", view.ip.length() ? view.ip : WiFi.localIP().toString());
      addInfo("Firmware", BASE_FW_VERSION, String("Base station firmware ") + BASE_FW_VERSION + ", server up " + String(view.up) + " s.");
      addInfo("Free heap", String(ESP.getFreeHeap() / 1024) + "k", "Free memory " + String(ESP.getFreeHeap()) + " bytes.");
      addAct("Refresh now", "", ACT_REFRESH, "", "refreshing...", "Fetch fresh status from the server.");
      break;
  }
}

static void dirtyAll() { dirtyMenu = dirtyDetail = dirtyBanner = true; }
static void openPage(int p) { screen = SCR_PAGE; pageId = p; rowSel = 0; rowTop = 0; buildRows(); dirtyAll(); }
static void clampRows() {
  if (rowSel >= rowCount) rowSel = rowCount ? rowCount - 1 : 0;
  if (rowSel < rowTop) rowTop = rowSel;
  if (rowSel > rowTop + 3) rowTop = rowSel - 3;
}

static void takeSnapshot() {
  int before = realAlerts(view);
  xSemaphoreTake(mtx, portMAX_DELAY); view = shared; xSemaphoreGive(mtx);
  if (realAlerts(view) > before) { setDim(false); lastInputMs = millis(); }
  if (screen != SCR_MENU) { buildRows(); clampRows(); }
}

static void activate(const Row& r) {
  if (r.go == GO_PAGE) { openPage(r.target); return; }
  if (r.go == GO_NODE) { screen = SCR_NODE; nodeIdx = r.target; rowSel = 0; rowTop = 0; buildRows(); dirtyAll(); return; }
  if (!r.hasAct || !r.enabled) { actionMsg = r.right == "now" ? "already active" : "info only"; actionMsgAt = millis(); dirtyDetail = true; return; }
  if (r.holdMs) startHold(r.holdMs, r.act, r.arg, String("Hold: ") + r.label, r.pending);
  else queueAction(r.act, r.arg, r.pending);
  dirtyDetail = true;
}

static void onButton(int b) {
  if (screen == SCR_MENU) {
    if (b == BUP)   { menuSel = (menuSel + M_COUNT - 1) % M_COUNT; dirtyMenu = dirtyDetail = true; }
    if (b == BDOWN) { menuSel = (menuSel + 1) % M_COUNT; dirtyMenu = dirtyDetail = true; }
    if (b == BSEL || b == BRIGHT) openPage(menuSel);
    if (menuSel < menuTop) menuTop = menuSel;
    if (menuSel > menuTop + 3) menuTop = menuSel - 3;
    return;
  }
  buildRows();
  if (b == BUP && rowCount)   { rowSel = (rowSel + rowCount - 1) % rowCount; clampRows(); dirtyMenu = dirtyDetail = true; }
  if (b == BDOWN && rowCount) { rowSel = (rowSel + 1) % rowCount; clampRows(); dirtyMenu = dirtyDetail = true; }
  if (b == BLEFT) {
    if (screen == SCR_NODE) { screen = SCR_PAGE; pageId = M_NODES; rowSel = nodeIdx; rowTop = 0; buildRows(); clampRows(); }
    else screen = SCR_MENU;
    hold.active = false; dirtyAll();
  }
  if ((b == BSEL || (b == BRIGHT && rowCount && rows[rowSel].go != GO_NONE)) && rowCount) activate(rows[rowSel]);
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

static String clipTo(U8G2& g, String s, int maxW) {
  if (g.getStrWidth(s.c_str()) <= maxW) return s;
  while (s.length() > 1 && g.getStrWidth((s + "..").c_str()) > maxW) s.remove(s.length() - 1);
  return s + "..";
}

static void drawList(U8G2& g, const String& title, bool back, int count, int sel, int top,
                     String (*label)(int), String (*right)(int)) {
  g.clearBuffer();
  g.setFont(u8g2_font_6x12_tf);
  g.drawStr(0, 10, ((back ? "< " : "") + title).c_str());
  g.setFont(u8g2_font_5x8_tf);
  if (!back) g.drawStr(view.link ? 104 : 98, 9, view.link ? "LINK" : "NO-LINK");
  g.drawHLine(0, 12, 128);
  for (int row = 0; row < 4; row++) {
    int i = top + row; if (i >= count) break;
    int y = 25 + row * 12;
    if (i == sel) { g.drawBox(0, y - 10, 122, 12); g.setDrawColor(0); }
    String r = right(i);
    g.setFont(u8g2_font_5x8_tf); int rw = r.length() ? g.getStrWidth(r.c_str()) + 4 : 0;
    if (r.length()) g.drawStr(120 - rw + 2, y - 1, r.c_str());
    g.setFont(u8g2_font_6x12_tf);
    g.drawStr(3, y, clipTo(g, label(i), 116 - rw).c_str());
    g.setDrawColor(1);
  }
  if (count > 4) { int h = 48 * 4 / count; int y = 14 + (48 - h) * top / (count - 4); g.drawFrame(124, 14, 4, 50); g.drawBox(125, y, 2, h); }
  g.sendBuffer();
}
static String menuLabel(int i) { String l = MENU_LABELS[i]; if (i == M_ALERTS && view.activeCount) l += " (" + String(view.activeCount) + ")"; return l; }
static String menuRight(int i) { (void)i; return ">"; }
static String rowLabel(int i) { return rows[i].label; }
static String rowRight(int i) { return rows[i].right.length() ? rows[i].right : (rows[i].go != GO_NONE ? String(">") : String("")); }

static void renderMenu() {
  if (screen == SCR_MENU) { drawList(oledMenu, "CHAUKIDAAR", false, M_COUNT, menuSel, menuTop, menuLabel, menuRight); return; }
  buildRows();
  String title = screen == SCR_NODE && nodeIdx < view.nodeCount ? view.nodes[nodeIdx].name : String(MENU_LABELS[pageId]);
  drawList(oledMenu, title, true, rowCount, rowSel, rowTop, rowLabel, rowRight);
}

static String menuPreview(int i) {
  switch (i) {
    case M_OVERVIEW: return "Site " + view.arm + ", " + String(view.online) + "/" + String(view.total) + " nodes online, " + String(view.activeCount) + " alert(s), mission " + view.mission + ".";
    case M_ALERTS:   return view.activeCount ? String(view.activeCount) + " open alert(s): review and acknowledge." : String("No open alerts.");
    case M_NODES:    return String(view.online) + "/" + String(view.total) + " nodes online: details, siren, live mode, calibrate.";
    case M_ARMING:   return "Site is " + view.arm + ". Arm, test or disarm the site.";
    case M_MISSION:  return "Mission " + view.mission + ". Switch the use case.";
    case M_SIREN:    return String("Silence all sirens or raise a panic alarm. Mission is ") + (view.audible ? "audible." : "silent.");
    default:         return String("Link ") + (view.link ? "up" : "down") + ", fw " + BASE_FW_VERSION + ", server and network details.";
  }
}

static void renderDetail() {
  oledDetail.clearBuffer();
  if (hold.active) {   // hold-to-confirm progress bar
    uint32_t el = millis() - hold.start;
    int w = (int)(124UL * (el > hold.need ? hold.need : el) / hold.need);
    oledDetail.setFont(u8g2_font_7x14B_tf); oledDetail.drawStr(0, 28, clipTo(oledDetail, hold.label, 128).c_str());
    oledDetail.drawFrame(0, 36, 128, 12); oledDetail.drawBox(2, 38, w, 8);
    oledDetail.setFont(u8g2_font_5x8_tf); oledDetail.drawStr(0, 62, "keep holding / release = cancel");
    oledDetail.sendBuffer();
    return;
  }
  String head, body, foot;
  if (screen == SCR_MENU) {
    head = MENU_LABELS[menuSel]; body = menuPreview(menuSel); foot = "SEL/> open page";
  } else {
    buildRows();
    if (rowCount) {
      const Row& r = rows[rowSel];
      head = r.label; body = r.detail;
      if (r.go != GO_NONE) foot = "SEL open   < back";
      else if (r.hasAct && r.enabled) foot = r.holdMs ? String("hold SEL ") + String(r.holdMs / 1000) + "s   < back" : String("SEL do it   < back");
      else foot = "< back";
    } else { head = MENU_LABELS[pageId]; body = "Empty."; foot = "< back"; }
  }
  oledDetail.setFont(u8g2_font_6x12_tf); oledDetail.drawStr(0, 10, clipTo(oledDetail, head, 128).c_str());
  oledDetail.drawHLine(0, 13, 128);
  oledDetail.setFont(u8g2_font_5x8_tf);
  drawWrapped(oledDetail, body, 0, 22, 128, 9, 4);
  oledDetail.drawHLine(0, 55, 128);
  oledDetail.drawStr(0, 63, foot.c_str());
  if (actionMsg.length() && millis() - actionMsgAt < 3000) {   // action feedback strip
    oledDetail.setDrawColor(0); oledDetail.drawBox(0, 0, 128, 12); oledDetail.setDrawColor(1);
    oledDetail.drawFrame(0, 0, 128, 12); oledDetail.drawStr(3, 9, actionMsg.c_str());
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
  if (m) {
    lastInputMs = millis();
    if (dimmed) { setDim(false); m = 0; }   // the first press only wakes the screens
  }
  for (int i = 0; i < 5; i++) if (m & (1 << i)) onButton(i);
  if (hold.active) {
    uint32_t el = millis() - hold.start;
    if (digitalRead(BTN_SELECT) == HIGH) {               // released
      hold.active = false;
      if (el < hold.need) { actionMsg = String("hold SELECT ") + String(hold.need / 1000) + " s to confirm"; actionMsgAt = millis(); }
      dirtyDetail = true;
    } else if (el >= hold.need) {
      hold.active = false; queueAction(hold.act, hold.arg, hold.pending); dirtyDetail = true;
    } else {
      static uint32_t lastHoldDraw = 0;
      if (millis() - lastHoldDraw > 90) { lastHoldDraw = millis(); dirtyDetail = true; }
    }
  }
  if (actionDone) { actionDone = false; actionPending = false; actionMsg = actionResult; actionMsgAt = millis(); dirtyMenu = dirtyDetail = true; }
  if (!dimmed && !hold.active && millis() - lastInputMs > DIM_AFTER_MS && realAlerts(view) == 0) setDim(true);
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
