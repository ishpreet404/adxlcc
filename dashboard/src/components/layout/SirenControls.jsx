import React, { useEffect, useRef, useState } from 'react';
import { BellOff, Siren } from 'lucide-react';
import useStore from '../../store/useStore';
import api from '../../services/api';

/** Stop every node's siren (delivered on each node's next check-in, ~5 s on mains power). */
export const SilenceButton = ({ compact = false, large = false, className = '' }) => {
  const toast = useStore(s => s.toast);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.silence();
      toast({ kind: 'CMD', severity: 'INFO', title: 'Sirens silenced', message: `${r.nodes.length} node${r.nodes.length === 1 ? '' : 's'} · stops at each node's next check-in`, ttl: 3500 });
    } catch (e) { toast({ kind: 'ERR', severity: 'HIGH', title: 'Silence failed', message: e.message }); }
    finally { setBusy(false); }
  };
  return (
    <button type="button" onClick={run} disabled={busy} aria-label="Silence all sirens" title="Silence all sirens"
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-terminal-border text-gray-200 hover:bg-white/5 disabled:opacity-50 ${compact ? 'w-9 h-9' : large ? 'h-11 px-4 text-sm font-medium' : 'h-8 px-3 text-xs font-medium'} ${className}`}>
      <BellOff className="w-4 h-4" aria-hidden="true" />{!compact && <span>Silence</span>}
    </button>
  );
};

const HOLD_MS = 1500;

/**
 * Panic / duress alarm. Press and HOLD for 1.5 s (mouse, touch or Enter/Space) so it can't
 * fire by accident. Raises a CRITICAL alert and, on audible missions, sounds every node.
 */
export const PanicButton = ({ wide = false, className = '' }) => {
  const toast = useStore(s => s.toast);
  const [progress, setProgress] = useState(0);
  const [sent, setSent] = useState(false);
  const start = useRef(0), raf = useRef(0), fired = useRef(false);

  const stop = () => {
    cancelAnimationFrame(raf.current);
    if (!fired.current && start.current && Date.now() - start.current < HOLD_MS) {
      toast({ kind: 'INFO', severity: 'LOW', title: 'Hold to send a panic alarm', message: 'Press and hold for 1.5 seconds', ttl: 2500 });
    }
    start.current = 0; setProgress(0);
  };
  const fire = async () => {
    fired.current = true; setSent(true);
    try {
      const r = await api.panic();
      toast({ kind: 'PANIC', severity: 'CRITICAL', title: 'Panic alarm raised', message: r.sirens.length ? `Sirens sounding on ${r.sirens.join(', ')}` : 'Silent alarm (mission policy)' });
    } catch (e) { toast({ kind: 'ERR', severity: 'HIGH', title: 'Panic alarm failed', message: e.message }); }
    setTimeout(() => setSent(false), 4000);
  };
  const tick = () => {
    const p = Math.min(1, (Date.now() - start.current) / HOLD_MS);
    setProgress(p);
    if (p >= 1) { start.current = 0; setProgress(0); fire(); return; }
    raf.current = requestAnimationFrame(tick);
  };
  const begin = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (start.current || sent) return;
    fired.current = false; start.current = Date.now(); raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <button type="button"
      onPointerDown={begin} onPointerUp={stop} onPointerLeave={() => start.current && stop()} onPointerCancel={stop}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) begin(e); }}
      onKeyUp={e => { if (e.key === 'Enter' || e.key === ' ') stop(); }}
      onContextMenu={e => e.preventDefault()}
      aria-label="Panic alarm: press and hold for 1.5 seconds" title="Panic alarm — press and hold 1.5 s"
      className={`relative overflow-hidden select-none touch-none inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold border border-terminal-red/50 text-red-100 bg-terminal-red/15 hover:bg-terminal-red/25 ${wide ? 'h-11 px-4 text-sm w-full' : 'h-8 px-3 text-xs'} ${className}`}>
      <span className="absolute inset-y-0 left-0 bg-terminal-red/60" style={{ width: `${progress * 100}%` }} aria-hidden="true" />
      <Siren className="relative w-4 h-4" aria-hidden="true" />
      <span className="relative">{sent ? 'Panic sent' : progress > 0 ? 'Keep holding…' : wide ? 'Hold for panic alarm' : 'Panic'}</span>
    </button>
  );
};

/** Emergency strip for the Overview page (phones see it without opening a menu). */
export const EmergencyBar = () => (
  <div className="grid grid-cols-[1fr_auto] gap-2 lg:hidden" role="group" aria-label="Emergency controls">
    <PanicButton wide />
    <SilenceButton large />
  </div>
);

export default PanicButton;
