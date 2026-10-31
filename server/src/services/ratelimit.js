'use strict';
/** Tiny fixed-window rate limiter (per client IP) for endpoints that spend Gemini quota. */
function rateLimit({ max = 10, windowMs = 60000, name = 'rate' } = {}) {
  const hits = new Map();   // ip -> { start, count }
  setInterval(() => {
    const now = Date.now();
    for (const [ip, h] of hits) if (now - h.start > windowMs) hits.delete(ip);
  }, windowMs).unref();
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let h = hits.get(ip);
    if (!h || now - h.start > windowMs) { h = { start: now, count: 0 }; hits.set(ip, h); }
    if (++h.count > max) {
      const retry = Math.ceil((h.start + windowMs - now) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ ok: false, error: `Too many ${name} requests, try again in ${retry}s` });
    }
    next();
  };
}

module.exports = { rateLimit };
