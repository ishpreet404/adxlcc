import { useEffect, useState } from 'react';
import api from '../../services/api';

// Shared, lightly-polled /api/ai/status so several panels don't each hit the server.
let cache = null;
let inflight = null;
let lastAt = 0;
const subs = new Set();

const load = () => {
  if (inflight) return inflight;
  inflight = api.aiStatus()
    .then(r => { cache = { ...r, error: null }; })
    .catch(e => { cache = { ...(cache || {}), error: e.message }; })
    .finally(() => { inflight = null; lastAt = Date.now(); subs.forEach(fn => fn(cache)); });
  return inflight;
};

/** { tiger: {ready, writes}, gemini: {enabled, model}, error } or null while loading. */
export function useAiStatus(pollMs = 30000) {
  const [state, setState] = useState(cache);
  useEffect(() => {
    subs.add(setState);
    if (!cache || Date.now() - lastAt > pollMs) load();
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') load(); }, pollMs);
    return () => { subs.delete(setState); clearInterval(t); };
  }, [pollMs]);
  return state;
}

export default useAiStatus;
