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
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS profile TEXT;
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

// Production lifecycle on the telemetry hypertable: compress chunks older than a day
// (segment by node so per-node queries stay fast) and drop raw rows after 30 days.
// The 1 s continuous aggregate keeps the long-term picture cheaply.
const LIFECYCLE = [
  `ALTER TABLE telemetry SET (timescaledb.compress, timescaledb.compress_segmentby = 'node_id', timescaledb.compress_orderby = 'time DESC')`,
  `SELECT add_compression_policy('telemetry', INTERVAL '1 day', if_not_exists => TRUE)`,
  `SELECT add_retention_policy('telemetry', INTERVAL '30 days', if_not_exists => TRUE)`
];

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
    for (const sql of LIFECYCLE) { try { await pool.query(sql); } catch (e) { console.warn('[tiger] lifecycle policy skipped:', e.message.split('\n')[0]); } }
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
    new Date(alert.createdAt || Date.now()), alert.id, alert.nodeId || null, alert.nodeName || null,
    alert.severity || null, alert.kind || null, alert.targetClass || null, alert.probability || null,
    alert.zone && alert.zone.name || null, alert.message || null,
    extra.evidenceHash || null,
    (alert.interpretation && alert.interpretation.label) || alert.targetClass || null,
    extra.profile || null
  ];
  return pool.query(
    `INSERT INTO alerts
     (time,alert_id,node_id,node_name,severity,kind,target_class,probability,zone,message,evidence_hash,label,profile)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    vals
  ).catch(err => { lastError = err.message; });
}


// ---- analytics for the dashboard (trusted, server-authored SQL only) ------------------

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Headline numbers + which TimescaleDB features are active. Cheap: approximate_row_count. */
async function stats() {
  if (!ready) return { ok: true, enabled, ready: false, lastError };
  const q = async (sql) => { try { return (await pool.query(sql)).rows; } catch (e) { return null; } };
  const [rows, alertRows, ingest, size, chunks, cagg, span, jobs, compressed] = await Promise.all([
    q(`SELECT approximate_row_count('telemetry')::bigint AS n`),
    q(`SELECT count(*)::bigint AS n FROM alerts`),
    q(`SELECT count(*)::int AS n FROM telemetry WHERE time > now() - interval '1 minute'`),
    q(`SELECT (hypertable_size('telemetry') + hypertable_size('alerts'))::bigint AS bytes`),
    q(`SELECT count(*)::int AS n FROM timescaledb_information.chunks WHERE hypertable_name IN ('telemetry','alerts')`),
    q(`SELECT count(*)::bigint AS n FROM telemetry_1s`),
    q(`SELECT min(time) AS oldest, max(time) AS newest FROM telemetry`),
    q(`SELECT proc_name, hypertable_name, schedule_interval::text AS every FROM timescaledb_information.jobs WHERE hypertable_name IN ('telemetry','alerts','telemetry_1s') OR proc_name LIKE 'policy_refresh%'`),
    q(`SELECT count(*) FILTER (WHERE is_compressed)::int AS n FROM timescaledb_information.chunks WHERE hypertable_name = 'telemetry'`)
  ]);
  // approximate_row_count is 0 until stats exist on a young table; fall back to an exact count then
  let telemetryRows = rows ? num(rows[0].n) : null;
  if (!telemetryRows) { const exact = await q(`SELECT count(*)::bigint AS n FROM telemetry`); telemetryRows = exact ? num(exact[0].n) : null; }
  const jobNames = (jobs || []).map(j => j.proc_name);
  return {
    ok: true, enabled, ready: true,
    telemetryRows,
    alertRows: alertRows ? num(alertRows[0].n) : null,
    ingestPerMin: ingest ? num(ingest[0].n) : null,
    storageBytes: size ? num(size[0].bytes) : null,
    chunks: chunks ? num(chunks[0].n) : null,
    compressedChunks: compressed ? num(compressed[0].n) : null,
    caggRows: cagg ? num(cagg[0].n) : null,
    oldest: span && span[0].oldest, newest: span && span[0].newest,
    hypertables: ['telemetry', 'alerts'],
    continuousAggregate: 'telemetry_1s',
    policies: {
      continuousAggregateRefresh: jobNames.some(n => /refresh/.test(n)),
      compression: jobNames.some(n => /compression|columnstore/.test(n)),
      retention: jobNames.some(n => /retention/.test(n))
    },
    writes: writeCount, lastError
  };
}

/** Per-minute activity per node, read from the 1 s continuous aggregate (not raw rows). */
async function activity(minutes = 60) {
  if (!ready) return [];
  minutes = Math.max(5, Math.min(1440, Number(minutes) || 60));
  const { rows } = await pool.query(
    `SELECT time_bucket('1 minute', bucket) AS bucket, node_id,
            max(max_p)::float AS max_p, avg((rms_a + rms_b) / 2)::float AS avg_rms, count(*)::int AS samples
       FROM telemetry_1s
      WHERE bucket > now() - make_interval(mins => $1)
      GROUP BY 1, 2 ORDER BY 1`, [minutes]);
  return rows;
}

/** Alerts per 10 minutes by severity. */
async function alertsTimeline(hours = 6) {
  if (!ready) return [];
  hours = Math.max(1, Math.min(168, Number(hours) || 6));
  const bucket = hours <= 6 ? '10 minutes' : hours <= 48 ? '1 hour' : '6 hours';
  const { rows } = await pool.query(
    `SELECT time_bucket($2::interval, time) AS bucket, coalesce(severity,'UNKNOWN') AS severity, count(*)::int AS count
       FROM alerts WHERE time > now() - make_interval(hours => $1)
      GROUP BY 1, 2 ORDER BY 1`, [hours, bucket]);
  return rows;
}

/** Compact statistics for the Gemini situation report. */
async function summary(minutes = 60) {
  if (!ready) return null;
  const iv = [Math.max(5, Math.min(1440, Number(minutes) || 60))];
  const [byKind, bySev, byNode, perNode, latest] = await Promise.all([
    pool.query(`SELECT coalesce(label, kind) AS k, count(*)::int AS n FROM alerts WHERE time > now() - make_interval(mins => $1) GROUP BY 1 ORDER BY 2 DESC`, iv),
    pool.query(`SELECT severity AS k, count(*)::int AS n FROM alerts WHERE time > now() - make_interval(mins => $1) GROUP BY 1`, iv),
    pool.query(`SELECT node_name AS k, count(*)::int AS n FROM alerts WHERE time > now() - make_interval(mins => $1) GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, iv),
    pool.query(`SELECT node_id, count(*)::int AS readings, round(max(probability)::numeric, 2)::float AS max_p,
                       round(avg(battery_v)::numeric, 2)::float AS battery_v, round(avg(rssi)::numeric)::int AS rssi
                  FROM telemetry WHERE time > now() - make_interval(mins => $1) GROUP BY 1 ORDER BY 1`, iv),
    pool.query(`SELECT time, node_name, severity, coalesce(label, kind) AS what, message FROM alerts
                 WHERE time > now() - make_interval(mins => $1) ORDER BY time DESC LIMIT 8`, iv)
  ]);
  const obj = (r) => Object.fromEntries(r.rows.map(x => [x.k, x.n]));
  return {
    source: 'tigerdata', minutes: iv[0],
    alerts: byKind.rows.reduce((a, x) => a + x.n, 0),
    byKind: obj(byKind), bySeverity: obj(bySev), byNode: obj(byNode),
    telemetryRows: perNode.rows.reduce((a, x) => a + x.readings, 0),
    nodes: perNode.rows, latest: latest.rows
  };
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

module.exports = { init, recordTelemetry, recordAlert, readQuery, stats, activity, alertsTimeline, summary, status, close, get ready() { return ready; } };
