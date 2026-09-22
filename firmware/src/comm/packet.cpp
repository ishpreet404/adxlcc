#include "packet.h"
#include <ArduinoJson.h>
#include "config.h"
#include "settings.h"

static float r3(float v) { return roundf(v * 1000.0f) / 1000.0f; }
static float r4(float v) { return roundf(v * 10000.0f) / 10000.0f; }

String buildPacket(const PacketInput& in) {
    JsonDocument doc;
    doc["v"] = 2;
    doc["id"] = settings.nodeId;
    doc["seq"] = in.seq;
    doc["up"] = millis();
    doc["fw"] = FW_VERSION;
    doc["tr"] = in.transport;
    doc["rssi"] = in.rssi;
    doc["mode"] = in.mode;
    doc["st"] = in.state;

    JsonObject bat = doc["bat"].to<JsonObject>();
    bat["v"] = roundf(in.battery.voltage * 100) / 100.0f;
    bat["p"] = in.battery.percent;

    JsonObject rad = doc["radar"].to<JsonObject>();
    rad["ok"] = in.radarOk;
    if (in.radar) {
        rad["pres"] = in.radar->presence;
        rad["mov"] = in.radar->moving ? 1 : 0;
        rad["dist"] = roundf(in.radar->distanceM * 100) / 100.0f;
        rad["eng"] = in.radar->moving ? in.radar->movingEnergy : in.radar->stationaryEnergy;
        rad["sdist"] = roundf(in.radar->stationaryDistanceM * 100) / 100.0f;
        rad["seng"] = in.radar->stationaryEnergy;
    } else {
        rad["pres"] = false; rad["mov"] = 0; rad["dist"] = 0; rad["eng"] = 0;
    }

    auto probe = [&](const char* key, const ProbeSummary& p) {
        JsonObject o = doc[key].to<JsonObject>();
        o["ok"] = p.ok;
        o["x"] = r3(p.x); o["y"] = r3(p.y); o["z"] = r3(p.z);
        o["rms"] = r4(p.rms); o["peak"] = r4(p.peak);
        o["sl"] = roundf(p.staLta * 100) / 100.0f;
    };
    probe("a", in.a);
    probe("b", in.b);

    JsonObject seis = doc["seis"].to<JsonObject>();
    seis["lag"] = roundf(in.lagMs * 100) / 100.0f;
    seis["corr"] = r3(in.corr);
    seis["ratio"] = r3(in.ratio);
    if (in.features) {
        JsonArray f = seis["f"].to<JsonArray>();
        const float* arr = in.features->asArray();
        for (int i = 0; i < 10; i++) f.add(arr[i]);
    }
    if (in.ml) {
        JsonObject ml = doc["ml"].to<JsonObject>();
        ml["c"] = in.ml->classIndex;
        JsonArray p = ml["p"].to<JsonArray>();
        for (int i = 0; i < 4; i++) p.add(r3(in.ml->probs[i]));
    }
    if (in.waveA && in.waveN) {
        JsonObject w = doc["wave"].to<JsonObject>();
        w["fs"] = in.waveFs;
        JsonArray a = w["a"].to<JsonArray>();
        JsonArray b = w["b"].to<JsonArray>();
        for (uint8_t i = 0; i < in.waveN; i++) {
            a.add((int)lroundf(in.waveA[i] * 1000.0f));      // milli-g integers keep the JSON small
            b.add(in.waveB ? (int)lroundf(in.waveB[i] * 1000.0f) : 0);
        }
    }
    JsonObject tamper = doc["tamper"].to<JsonObject>();
    tamper["tilt"] = roundf(in.tiltDeg * 10) / 10.0f;
    tamper["flag"] = in.tamper;
    tamper["imp"] = in.impact;
    doc["nf"] = r4(in.noiseFloor);
    if (in.calibrated) doc["cal"] = true;

    JsonObject sys = doc["sys"].to<JsonObject>();
    sys["heap"] = ESP.getFreeHeap();
    sys["tmp"] = roundf(in.tempC * 10) / 10.0f;

    String out;
    serializeJson(doc, out);
    return out;
}

Downlink parseReply(const String& reply) {
    Downlink d;
    if (!reply.length()) return d;
    JsonDocument doc;
    if (deserializeJson(doc, reply)) return d;
    JsonObject cmd = doc["cmd"];
    if (cmd.isNull()) return d;
    if (cmd["mode"].is<const char*>()) {
        d.hasMode = true;
        d.live = strcmp(cmd["mode"], "LIVE") == 0;
    }
    d.liveFor = cmd["liveFor"] | 0;
    d.reboot = cmd["reboot"] | false;
    d.sleepS = cmd["sleepS"] | 0;
    d.calibrate = cmd["calibrate"] | false;
    d.deterS = cmd["deter"] | 0;
    return d;
}
