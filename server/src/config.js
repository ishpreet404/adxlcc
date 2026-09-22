'use strict';
const path = require('path');

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

const ROOT = path.resolve(__dirname, '..', '..');

module.exports = {
  ROOT,
  PORT: num(process.env.PORT, 8787),
  HOST: process.env.HOST || '0.0.0.0',
  DATA_DIR: process.env.DATA_DIR || path.join(ROOT, 'server', 'data'),
  ML_DATA_DIR: path.join(ROOT, 'ml', 'data'),
  DASHBOARD_DIST: path.join(ROOT, 'dashboard', 'dist'),

  SITE_WIDTH: num(process.env.SITE_WIDTH, 40),
  SITE_HEIGHT: num(process.env.SITE_HEIGHT, 30),

  SIM_NODES: num(process.env.SIM_NODES, 2),
  SIM_SCENARIO: process.env.SIM_SCENARIO || 'patrol',

  ALERT_THRESHOLD: num(process.env.ALERT_THRESHOLD, 0.70),
  CRITICAL_THRESHOLD: num(process.env.CRITICAL_THRESHOLD, 0.88),
  ALERT_COOLDOWN_MS: num(process.env.ALERT_COOLDOWN_MS, 30000),
  ALERT_DEBOUNCE_PACKETS: 2,

  NODE_WARN_MS: num(process.env.NODE_WARN_MS, 45000),
  NODE_OFFLINE_MS: num(process.env.NODE_OFFLINE_MS, 120000),
  NODE_API_KEY: (process.env.NODE_API_KEY || '').trim(),

  // physics used by the localiser
  RADAR_MAX_M: 8,
  RADAR_FOV_DEG: 120,
  SEISMIC_WAVE_SPEED_MS: 150, // Rayleigh-wave speed in packed soil (100-300 m/s)
  SEISMIC_RANGE_M: 8,
  PROBE_NOISE_FLOOR_G: 0.02,

  LOITER_SECONDS: num(process.env.LOITER_SECONDS, 15),
  PREARM_ENABLED: (process.env.PREARM_ENABLED || '1') !== '0',

  // notifications (all optional)
  WEBHOOK_URL: (process.env.WEBHOOK_URL || '').trim(),
  TELEGRAM_BOT_TOKEN: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
  TELEGRAM_CHAT_ID: (process.env.TELEGRAM_CHAT_ID || '').trim(),
  SIREN_GPIO: num(process.env.SIREN_GPIO, -1),
  SIREN_SECONDS: num(process.env.SIREN_SECONDS, 10),

  HISTORY_LEN: 240,      // telemetry points kept per node (~2 min in LIVE mode)
  WAVE_BUFFER_LEN: 512   // raw samples kept per probe for scopes/recording
};
