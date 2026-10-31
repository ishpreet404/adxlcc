import { useEffect, useState } from 'react';

/**
 * Progressive-web-app plumbing: service-worker registration and the install prompt.
 * `beforeinstallprompt` can fire before React mounts, so it is captured here at startup.
 */
let deferredPrompt = null;
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn());

export const isStandalone = () =>
  (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  (typeof navigator !== 'undefined' && navigator.standalone === true);

export const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export function initPwa() {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();          // show our own "Install app" button instead of the mini-infobar
    deferredPrompt = e;
    emit();
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; emit(); });

  // Service workers need a secure context: HTTPS, or localhost during development.
  const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && secure && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* non-fatal: app still works online */ });
    });
  }
}

/** React hook: { standalone, canPrompt, ios, promptInstall } */
export function useInstall() {
  const [, force] = useState(0);
  const [standalone, setStandalone] = useState(isStandalone());
  useEffect(() => {
    const fn = () => force(x => x + 1);
    listeners.add(fn);
    const mq = window.matchMedia ? window.matchMedia('(display-mode: standalone)') : null;
    const onMode = () => setStandalone(isStandalone());
    if (mq && mq.addEventListener) mq.addEventListener('change', onMode);
    return () => { listeners.delete(fn); if (mq && mq.removeEventListener) mq.removeEventListener('change', onMode); };
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) return 'unavailable';
    const e = deferredPrompt;
    deferredPrompt = null;
    emit();
    try {
      await e.prompt();
      const choice = await e.userChoice;
      return choice && choice.outcome;
    } catch {
      return 'dismissed';
    }
  };

  return { standalone, canPrompt: !!deferredPrompt, ios: isIOS(), promptInstall };
}
