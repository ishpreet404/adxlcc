import React, { useEffect, useRef } from 'react';
import { Volume2, VolumeX, BellRing } from 'lucide-react';
import useStore from '../../store/useStore';

/**
 * Web-Audio siren: two-tone while any real (non-test) alert is ACTIVE; tamper gets a faster pattern.
 * Renders the mute toggle (`compact` = icon only).
 */
export const AudioAlarm = ({ compact = false }) => {
  const alerts = useStore(s => s.alerts);
  const muted = useStore(s => s.muted);
  const setMuted = useStore(s => s.setMuted);
  const ctxRef = useRef(null);
  const timerRef = useRef(null);
  const unacked = alerts.filter(a => a.status === 'ACTIVE' && !a.test);
  const count = unacked.length;
  const tamper = unacked.some(a => a.kind === 'TAMPER');

  useEffect(() => {
    const stop = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
    if (muted || count === 0) { stop(); return undefined; }
    const beep = () => {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!ctxRef.current) ctxRef.current = new AC();
        const ctx = ctxRef.current;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(tamper ? 1200 : 920, ctx.currentTime);
        osc.frequency.setValueAtTime(tamper ? 800 : 620, ctx.currentTime + 0.22);
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + 0.45);
      } catch { /* autoplay blocked until the user interacts */ }
    };
    beep();
    timerRef.current = setInterval(beep, tamper ? 900 : 1500);
    return stop;
  }, [muted, count, tamper]);

  const label = muted ? 'Alarm sound muted — click to unmute (M)' : count > 0 ? `Alarm sounding for ${count} alert${count > 1 ? 's' : ''} — click to mute (M)` : 'Alarm sound on — click to mute (M)';
  const Icon = muted ? VolumeX : count > 0 ? BellRing : Volume2;
  const tone = muted ? 'text-terminal-muted border-terminal-border' : count > 0 ? 'text-red-300 border-terminal-red/40 bg-terminal-red/10' : 'text-gray-300 border-terminal-border';
  return (
    <button type="button" onClick={() => setMuted(!muted)} aria-label={label} title={label} aria-pressed={muted}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border transition-colors hover:bg-white/5 ${compact ? 'w-10 h-10' : 'h-8 px-3 text-xs font-medium'} ${tone}`}>
      <Icon className="w-4 h-4" aria-hidden="true" />
      {!compact && <span>{muted ? 'Muted' : count > 0 ? `Alarm ×${count}` : 'Sound on'}</span>}
    </button>
  );
};

export default AudioAlarm;
