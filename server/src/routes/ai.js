'use strict';
/**
 * Gemini operator endpoints.
 *   POST /api/ai/ask        { question }  -> natural-language query over TigerData (guarded text-to-SQL)
 *   GET  /api/ai/status                   -> which sponsor integrations are live
 */
const express = require('express');
const reason = require('../services/reason');
const timeseries = require('../services/timeseries');

const router = express.Router();

router.post('/ask', express.json(), async (req, res) => {
  const question = (req.body && req.body.question || '').toString().slice(0, 500).trim();
  if (!question) return res.status(400).json({ ok: false, error: 'question required' });
  try {
    const result = await reason.answer(question);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/status', async (req, res) => {
  res.json({
    ok: true,
    tiger: timeseries.status(),
    gemini: reason.status()
  });
});

module.exports = router;
