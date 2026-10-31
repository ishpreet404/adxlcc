'use strict';
/**
 * TigerData / TimescaleDB time-series sink.
 *
 * Every telemetry packet and every alert is written to a Tiger Cloud hypertable so the
 * dashboard and the Gemini query box can run real time-series analytics (continuous
 * aggregates, retention, compression) instead of scanning NDJSON files.
 *
 * Degrades safely: with no DATABASE_URL the whole module becomes no-ops and the server
 * keeps running on the file store, so `npm start` on a bare Raspberry Pi still works.
 *
 * Env:
 *   DATABASE_URL            postgres connection string from Tiger Cloud (service URL)
 *   DATABASE_URL_RO         optional read-only role used for Gemini text-to-SQL (falls back to DATABASE_URL)
 *   TS_TELEMETRY_SAMPLING   write 1 of every N telemetry rows (default 1 = all)
 */
const config = require('../config');

let Pool = null;
try { ({ Pool } = require('pg')); } catch { /* pg not installed — stay in no-op mode */ }

const URL = (process.env.DATABASE_URL || '').trim();
const URL_RO = (process.env.DATABASE_URL_RO || '').trim() || URL;
const SAMPLING = Math.max(1, Number(process.env.TS_TELEMETRY_SAMPLING) || 1);

const enabled = Boolean(Pool && URL);
let pool = null;      // read-write
let poolRo = null;    // read-only (text-to-SQL)
let ready = false;
let writeCount = 0;
let seenCount = 0;
let lastError = null;

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS telemetry (
  time        TIMESTAMPTZ      NOT NULL,
  node_id     TEXT             NOT NULL,
  node_name   TEXT,
  transport   TEXT,
  mode        TEXT,
  state       TEXT,
  rms_a       DOUBLE PRECISION,
  rms_b       DOUBLE PRECISION,
  radar_dist  DOUBLE PRECISION,
  radar_energy DOUBLE PRECISION,
  ml_label    TEXT,
  ml_conf     DOUBLE PRECISION,
  fusion_level TEXT,
  probability DOUBLE PRECISION,
  loiter_s    INTEGER,
  battery_v   DOUBLE PRECISION,
  rssi        INTEGER,
  pos_x       DOUBLE PRECISION,
  pos_y       DOUBLE PRECISION
);
SELECT create_hypertable('telemetry', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS telemetry_node_time ON telemetry (node_id, time DESC);

CREATE TABLE IF NOT EXISTS alerts (
  time        TIMESTAMPTZ      NOT NULL,
  alert_id    TEXT             NOT NULL,
  node_id     TEXT,
  node_name   TEXT,
  severity    TEXT,
  kind        TEXT,
  target_class TEXT,
  probability DOUBLE PRECISION,
  zone        TEXT,
  message     TEXT,
  evidence_hash TEXT
);
SELECT create_hypertable('alerts', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS alerts_id ON alerts (alert_id);
`;

// 1-second rollup the dashboard can read directly (continuous aggregate).
const CAGG = `
CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_1s
WITH (timescaledb.continuous) AS
  SELECT time_bucket('1 second', time) AS bucket,
         node_id,
         avg(rms_a) AS rms_a,
         avg(rms_b) AS rms_b,
         max(probability) AS max_p,
         avg(radar_dist) AS radar_dist
  FROM telemetry
  GROUP BY bucket, node_id
WITH NO DATA;
`;

// Keep the 1s rollup refreshed automatically so the dashboard always has recent buckets.
const CAGG_POLICY = `
SELECT add_continuous_aggregate_policy('telemetry_1s',
  start_offset => INTERVAL '15 minutes',
  end_offset   => INTERVAL '10 seconds',
  schedule_interval => INTERVAL '10 seconds',
  if_not_exists => TRUE);
`;

async function init() {
  if (!enabled) {
    console.log('[tiger] disabled (no DATABASE_URL / pg) — using file store only');
    return false;
  }
  pool = new Pool({ connectionString: stripSslmode(URL), max: 4, ssl: sslFor(URL) });
  poolRo = URL_RO === URL ? pool : new Pool({ connectionString: stripSslmode(URL_RO), max: 2, ssl: sslFor(URL_RO) });
  try {
    await pool.query(SCHEMA);
    try { await pool.query(CAGG); await pool.query(CAGG_POLICY); } catch (e) { console.warn('[tiger] continuous aggregate skipped:', e.message); }
    ready = true;
    console.log('[tiger] connected, hypertables ready');
    return true;
  } catch (err) {
    lastError = err.message;
    console.warn('[tiger] init failed, falling back to file store:', err.message);
    ready = false;
    return false;
  }
}

// Remove the sslmode param so pg doesn't build its own conflicting ssl config;
// TLS is driven entirely by the ssl object from sslFor(). Other params (e.g. the
// read-only options string) are preserved.
function stripSslmode(url) {
  return url.replace(/([?&])sslmode=[^&]*(&|$)/i, (m, pre, post) => (pre === '?' && post === '&') ? '?' : (post === '&' ? pre : '')).replace(/[?&]$/, '');
}

function sslFor(url) {
  // Follow the URL's sslmode, matching libpq semantics:
  //   disable            -> no TLS
  //   verify-ca/full     -> encrypt AND verify the CA chain (needs a trusted/pinned CA)
  //   require/prefer/...  -> encrypt but do not verify the CA (Tiger DEV uses a private CA)
  // Traffic is encrypted in every TLS case; only CA verification differs.
  const m = /sslmode=([a-z-]+)/i.exec(url);
  const mode = m ? m[1].toLowerCase() : 'require';
  if (mode === 'disable') return false;
  if ((process.env.DATABASE_SSL_INSECURE || '') === '1') return { rejectUnauthorized: false };
  if (mode === 'verify-ca' || mode === 'verify-full') return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

function recordTelemetry(node, t, fusion, position) {
  if (!ready) return;
  if (SAMPLING > 1 && (seenCount++ % SAMPLING) !== 0) return;
  writeCount++;
  const vals = [
    new Date(t.receivedAt), node.id, node.name || null, t.transport || null, t.mode || null,
    fusion && fusion.state || null,
    t.probes[0] && t.probes[0].rms, t.probes[1] && t.probes[1].rms,
    t.radar && t.radar.presence ? t.radar.distance : null, t.radar && t.radar.energy,
    fusion && fusion.serverMl ? fusion.serverMl.label : (fusion && fusion.nodeMl ? fusion.nodeMl.label : null),
    fusion && fusion.serverMl ? fusion.serverMl.confidence : null,
    fusion && fusion.level, fusion && fusion.probability, fusion && fusion.loiterS,
    t.battery && t.battery.voltage, t.rssi,
    position ? position.x : null, position ? position.y : null
  ];
  pool.query(
    `INSERT INTO telemetry
     (time,node_id,node_name,transport,mode,state,rms_a,rms_b,radar_dist,radar_energy,
      ml_label,ml_conf,fusion_level,probability,loiter_s,battery_v,rssi,pos_x,pos_y)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    vals
  ).catch(err => { lastError = err.message; });
}

function recordAlert(alert, extra = {}) {
  if (!ready) return Promise.resolve();
  const vals = [
    new Date(alert.t || Date.now()), alert.id, alert.nodeId || null, alert.nodeName || null,
    alert.severity || null, alert.kind || null, alert.targetClass || null, alert.probability || null,
    alert.zone && alert.zone.name || null, alert.message || null,
    extra.evidenceHash || null
  ];
  return pool.query(
    `INSERT INTO alerts
     (time,alert_id,node_id,node_name,severity,kind,target_class,probability,zone,message,evidence_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    vals
  ).catch(err => { lastError = err.message; });
}


/** Read-only query for the Gemini text-to-SQL box. Caller MUST pre-validate the SQL. */
async function readQuery(sql, params = []) {
  if (!ready) throw new Error('time-series database not connected');
  const client = await poolRo.connect();
  try {
    await client.query('SET statement_timeout = 5000');
    await client.query('SET default_transaction_read_only = on');
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    client.release();
  }
}

function status() {
  return { enabled, ready, writes: writeCount, sampling: SAMPLING, lastError };
}

async function close() {
  if (pool) await pool.end().catch(() => {});
  if (poolRo && poolRo !== pool) await poolRo.end().catch(() => {});
}

module.exports = { init, recordTelemetry, recordAlert, readQuery, status, close, get ready() { return ready; } };
