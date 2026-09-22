#include "radar.h"

static const uint8_t HDR[4]  = {0xF4, 0xF3, 0xF2, 0xF1};
static const uint8_t TAIL[4] = {0xF8, 0xF7, 0xF6, 0xF5};

void Radar::begin(uint32_t baud) {
    if (_out >= 0) pinMode(_out, INPUT_PULLDOWN);
    if (_pwr >= 0) { pinMode(_pwr, OUTPUT); }
    _serial.begin(baud, SERIAL_8N1, _rx, _tx);
    _serial.setRxBufferSize(512);
    power(true);
}

void Radar::power(bool on) {
    if (_pwr >= 0) digitalWrite(_pwr, on ? LOW : HIGH); // P-MOSFET: LOW = conducting
    _powered = on || _pwr < 0;
    if (!on) { _r = Reading(); _len = 0; _ascii = ""; }
}

bool Radar::outPinActive() const {
    return _out >= 0 && digitalRead(_out) == HIGH;
}

void Radar::poll() {
    while (_serial.available()) {
        uint8_t b = (uint8_t)_serial.read();
        feedBinary(b);
        if (b >= 0x20 && b < 0x7F) feedAscii((char)b);
        else if (b == '\n') feedAscii('\n');
    }
    // OUT pin fallback when the UART is silent (or not connected)
    if (!healthy() && _out >= 0) {
        bool p = outPinActive();
        _r.presence = p;
        _r.moving = p;
        if (!p) _r.distanceM = 0;
    }
}

// ---- LD2410 binary protocol -------------------------------------------------
void Radar::feedBinary(uint8_t b) {
    if (_len < 4) {
        if (b == HDR[_len]) _buf[_len++] = b;
        else { _len = (b == HDR[0]) ? 1 : 0; if (_len) _buf[0] = b; }
        return;
    }
    if (_len >= sizeof(_buf)) { _len = 0; return; }
    _buf[_len++] = b;
    if (_len < 6) return;
    uint16_t payloadLen = _buf[4] | (_buf[5] << 8);
    if (payloadLen > sizeof(_buf) - 10) { _len = 0; return; }
    uint16_t total = 4 + 2 + payloadLen + 4;
    if (_len == total) {
        if (memcmp(&_buf[total - 4], TAIL, 4) == 0) parseBasicFrame(&_buf[6], payloadLen);
        _len = 0;
    }
}

void Radar::parseBasicFrame(const uint8_t* d, uint8_t n) {
    // d[0]=type (0x02 basic, 0x01 engineering), d[1]=0xAA, d[2]=state,
    // d[3..4]=moving dist cm, d[5]=moving energy, d[6..7]=stationary dist cm, d[8]=stationary energy,
    // d[9..10]=detection distance cm
    if (n < 11 || d[1] != 0xAA) return;
    uint8_t state = d[2];
    _r.valid = true;
    _r.lastFrameMs = millis();
    _r.moving = (state & 0x01) != 0;
    bool stationary = (state & 0x02) != 0;
    _r.presence = _r.moving || stationary;
    _r.movingDistanceM = (d[3] | (d[4] << 8)) / 100.0f;
    _r.movingEnergy = d[5];
    _r.stationaryDistanceM = (d[6] | (d[7] << 8)) / 100.0f;
    _r.stationaryEnergy = d[8];
    float det = (d[9] | (d[10] << 8)) / 100.0f;
    if (_r.moving) _r.distanceM = _r.movingDistanceM > 0 ? _r.movingDistanceM : det;
    else if (stationary) _r.distanceM = _r.stationaryDistanceM > 0 ? _r.stationaryDistanceM : det;
    else _r.distanceM = 0;
}

// ---- LD1125H-style ASCII ----------------------------------------------------
void Radar::feedAscii(char c) {
    if (c != '\n') { if (_ascii.length() < 64) _ascii += c; return; }
    String line = _ascii; _ascii = "";
    line.trim();
    if (!line.length()) return;
    int k = line.indexOf("dis=");
    bool mov = line.startsWith("mov");
    bool occ = line.startsWith("occ");
    if (mov || occ) {
        _r.valid = true;
        _r.lastFrameMs = millis();
        _r.presence = true;
        _r.moving = mov;
        float dist = k >= 0 ? line.substring(k + 4).toFloat() : 0;
        _r.distanceM = dist;
        if (mov) { _r.movingDistanceM = dist; _r.movingEnergy = 70; }
        else { _r.stationaryDistanceM = dist; _r.stationaryEnergy = 50; }
    } else if (line.startsWith("null") || line.startsWith("no")) {
        _r.valid = true;
        _r.lastFrameMs = millis();
        _r.presence = false; _r.moving = false; _r.distanceM = 0;
        _r.movingEnergy = 0; _r.stationaryEnergy = 0;
    }
}

// ---- configuration ----------------------------------------------------------
void Radar::sendLd2410Cmd(const uint8_t* cmd, uint8_t len) {
    const uint8_t h[4] = {0xFD, 0xFC, 0xFB, 0xFA};
    const uint8_t t[4] = {0x04, 0x03, 0x02, 0x01};
    _serial.write(h, 4);
    _serial.write((uint8_t)len); _serial.write((uint8_t)0);
    _serial.write(cmd, len);
    _serial.write(t, 4);
    _serial.flush();
    delay(30);
}

void Radar::configureLd2410() {
    // enable config -> end engineering mode -> end config. Harmless on other modules.
    const uint8_t enable[] = {0xFF, 0x00, 0x01, 0x00};
    const uint8_t endEng[] = {0x63, 0x00};
    const uint8_t endCfg[] = {0xFE, 0x00};
    sendLd2410Cmd(enable, sizeof(enable));
    sendLd2410Cmd(endEng, sizeof(endEng));
    sendLd2410Cmd(endCfg, sizeof(endCfg));
    while (_serial.available()) _serial.read();
    _len = 0;
}
