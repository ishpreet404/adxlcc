'use strict';
const express = require('express');
const alerts = require('../services/alerts');
const events = require('../services/events');

const router = express.Router();

router.get('/', (req, res) => {
  const filter = { status: req.query.status ? String(req.query.status).toUpperCase() : undefined, active: req.query.active === '1', limit: Number(req.query.limit) || 200 };
  res.json({ ok: true, alerts: alerts.list(filter) });
});

router.get('/:id', (req, res) => {
  const a = alerts.get(req.params.id);
  if (!a) return res.status(404).json({ ok: false, error: 'unknown alert' });
  res.json({ ok: true, alert: a });
});

for (const action of ['acknowledge', 'resolve', 'dismiss']) {
  router.post(`/:id/${action}`, (req, res) => {
    const a = alerts[action](req.params.id, (req.body && req.body.by) || 'operator');
    if (!a) return res.status(404).json({ ok: false, error: 'unknown alert' });
    res.json({ ok: true, alert: a });
  });
}

router.get('/events', (req, res) => {
  res.json({ ok: true, events: events.list(Number(req.query.limit) || 200) });
});

module.exports = router;
