'use strict';
/**
 * TigerData analytics for the dashboard (all SQL is server-authored).
 *   GET /api/tiger/stats                     -> row counts, ingest rate, storage, chunks, policies
 *   GET /api/tiger/activity?minutes=60       -> per-minute activity per node (from the continuous aggregate)
 *   GET /api/tiger/alerts-timeline?hours=6   -> alert counts per time bucket by severity
 */
const express = require('express');
const timeseries = require('../services/timeseries');

const router = express.Router();
const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req)); } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
};

router.get('/stats', wrap(() => timeseries.stats()));
router.get('/activity', wrap(async (req) => ({ ok: true, ready: timeseries.ready, series: await timeseries.activity(req.query.minutes) })));
router.get('/alerts-timeline', wrap(async (req) => ({ ok: true, ready: timeseries.ready, buckets: await timeseries.alertsTimeline(req.query.hours) })));

module.exports = router;
