'use strict';
/**
 * Gemini operator endpoints.
 *   GET  /api/ai/status                    -> which sponsor integrations are live
 *   GET  /api/ai/feed?limit=50             -> live briefing feed (newest first); live via WS type 'ai'
 *   POST /api/ai/brief  { minutes }        -> situation report over TigerData for the last N minutes
 *   POST /api/ai/ask    { question }       -> natural-language query over TigerData (guarded text-to-SQL)
 */
const express = require('express');
const reason = require('../services/reason');
const timeseries = require('../services/timeseries');
const alerts = require('../services/alerts');
const profiles = require('../services/profiles');
const { rateLimit } = require('../services/ratelimit');

const router = express.Router();

router.get('/status', (req, res) => {
  res.json({ ok: true, tiger: timeseries.status(), gemini: reason.status(), mission: profiles.get().id });
});

router.get('/feed', (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
  res.json({ ok: true, items: reason.listFeed(limit) });
});

router.post('/brief', rateLimit({ max: 6, windowMs: 60000, name: 'report' }), express.json(), async (req, res) => {
  try {
    const minutes = (req.body && req.body.minutes) || 60;
    res.json(await reason.brief({ minutes, fallbackAlerts: alerts.list({ limit: 200 }) }));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/ask', rateLimit({ max: 10, windowMs: 60000, name: 'question' }), express.json(), async (req, res) => {
  const question = (req.body && req.body.question || '').toString().slice(0, 500).trim();
  if (!question) return res.status(400).json({ ok: false, error: 'question required' });
  try {
    const result = await reason.answer(question);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
