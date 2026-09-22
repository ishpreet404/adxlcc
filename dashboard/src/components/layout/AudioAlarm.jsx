import React, { useEffect, useRef } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import useStore from '../../store/useStore';

/** Web-Audio siren: two-tone while any real (non-test) alert is ACTIVE; tamper gets a faster pattern. */
export const AudioAlarm = () => {
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
        if (ctx.state === 'suspended') ctx.resume();
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

  return (
    <button onClick={() => setMuted(!muted)} title={muted ? 'Unmute siren (M)' : 'Mute siren (M)'}
      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-bold uppercase border transition-colors ${
        muted ? 'border-gray-700 text-gray-500 bg-black/40' : count > 0 ? 'border-terminal-red text-terminal-red bg-terminal-red/10 animate-pulse' : 'border-terminal-green text-terminal-green bg-terminal-green/10'
      }`}>
      {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
      <span className="hidden sm:inline">{muted ? 'SIREN OFF' : count > 0 ? `SIREN ×${count}` : 'SIREN ARMED'}</span>
    </button>
  );
};

export default AudioAlarm;
