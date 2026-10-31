import { useEffect, useRef, useState } from 'react';

/** Tracks a CSS media query (SSR-safe, updates on change). */
export function useMediaQuery(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on));
  }, [query]);
  return matches;
}

/** Content width of an element, kept current with ResizeObserver (for canvases / SVG charts). */
export function useElementWidth(ref, fallback = 300) {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.max(1, Math.round(el.clientWidth || fallback)));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fallback]);
  return width;
}

/** Re-render every `ms` (for clocks and relative timestamps). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * Poll an async loader every `ms` while the tab is visible. Returns { data, error, loading, reload }.
 * `loader` should be stable or listed in `deps`.
 */
export function usePolling(loader, ms, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const alive = useRef(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useRef(async () => {});
  run.current = async () => {
    try {
      const data = await loaderRef.current();
      if (alive.current) setState({ data, error: null, loading: false });
    } catch (e) {
      if (alive.current) setState(s => ({ data: s.data, error: e.message || String(e), loading: false }));
    }
  };

  useEffect(() => {
    alive.current = true;
    setState(s => ({ ...s, loading: true }));
    run.current();
    const tick = () => { if (document.visibilityState !== 'hidden') run.current(); };
    const t = ms ? setInterval(tick, ms) : null;
    const onVis = () => { if (document.visibilityState === 'visible') run.current(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive.current = false; if (t) clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);

  return { ...state, reload: () => run.current() };
}
