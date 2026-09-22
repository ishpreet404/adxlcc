import React from 'react';
import useStore from '../store/useStore';
import { levelColor, levelHex } from '../lib/format';

/** Fusion probability gauge + explainable evidence for the selected node. */
export const FusionPanel = ({ node, compact = false }) => {
  const thresholds = useStore(s => s.thresholds);
  const f = node && node.fusion;
  if (!f) return <div className="text-[11px] text-terminal-muted border border-terminal-border p-2">Fusion: waiting for telemetry</div>;
  const pct = Math.round(f.probability * 100);
  const color = levelHex(f.level);
  return (
    <div className="border border-terminal-border p-2 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] text-terminal-muted">INTRUSION PROBABILITY</div>
          <div className={`text-2xl font-extrabold leading-none tabular-nums ${levelColor(f.level)}`}>{pct}%</div>
        </div>
        <div className="text-right">
          <div className={`text-sm font-bold ${levelColor(f.level)}`}>{f.level}</div>
          <div className="text-[10px] text-terminal-muted">{f.targetClass} · {f.severity}</div>
        </div>
      </div>
      <div className="relative h-2 bg-terminal-black border border-terminal-border">
        <div className="h-full transition-all duration-300" style={{ width: `${pct}%`, background: color }} />
        <div className="absolute top-0 h-full w-px bg-terminal-amber" style={{ left: `${thresholds.alert * 100}%` }} title="alert threshold" />
        <div className="absolute top-0 h-full w-px bg-terminal-red" style={{ left: `${thresholds.critical * 100}%` }} title="critical threshold" />
      </div>
      <div className="grid grid-cols-3 gap-1 text-[10px]">
        <Chip on={f.radarActive} label="RADAR" />
        <Chip on={f.dualSeismic} label="DUAL SEISMIC" />
        <Chip on={f.mlLabel === 'HUMAN' || f.mlLabel === 'VEHICLE'} label={`ML ${f.mlLabel || '—'}`} />
      </div>
      {f.note && <div className="text-[10px] text-terminal-amber">{f.note}</div>}
      {!compact && (
        <div className="text-[10px] space-y-0.5">
          <div className="text-terminal-muted">EVIDENCE (logit contributions)</div>
          {f.evidence.slice(0, 6).map(e => (
            <div key={e.key} className="flex items-center gap-2">
              <span className="w-32 truncate text-gray-300">{e.label}</span>
              <span className="flex-1 h-1.5 bg-terminal-black border border-terminal-border relative">
                <span className="absolute top-0 h-full" style={{
                  left: e.contribution >= 0 ? '50%' : `${50 - Math.min(50, Math.abs(e.contribution) * 12)}%`,
                  width: `${Math.min(50, Math.abs(e.contribution) * 12)}%`, background: e.contribution >= 0 ? '#ff3344' : '#00ff66'
                }} />
              </span>
              <span className="w-10 text-right tabular-nums">{e.contribution > 0 ? '+' : ''}{e.contribution.toFixed(1)}</span>
            </div>
          ))}
          {f.serverMl && <div className="text-terminal-muted pt-1">server RF: {f.serverMl.label} {Math.round(f.serverMl.confidence * 100)}% — {f.serverMl.explanation}</div>}
          {f.nodeMl && <div className="text-terminal-muted">edge RF (on ESP32): {f.nodeMl.label} {Math.round(f.nodeMl.confidence * 100)}%</div>}
        </div>
      )}
    </div>
  );
};

const Chip = ({ on, label }) => (
  <div className={`border px-1 py-0.5 text-center font-bold ${on ? 'border-terminal-red text-terminal-red bg-terminal-red/10' : 'border-terminal-border text-terminal-muted'}`}>{label}</div>
);

export default FusionPanel;
