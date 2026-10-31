import React from 'react';
import useStore from '../store/useStore';
import { levelHex, titleCase } from '../lib/format';

const Chip = ({ on, label }) => (
  <div className={`rounded-md px-2 py-1 text-center text-[11px] font-medium ring-1 ring-inset truncate ${on ? 'bg-terminal-red/10 text-red-300 ring-terminal-red/30' : 'text-terminal-muted ring-terminal-border'}`}>{label}</div>
);

/** Fusion probability gauge + explainable evidence for the selected node. */
export const FusionPanel = ({ node, compact = false }) => {
  const thresholds = useStore(s => s.thresholds);
  const f = node && node.fusion;
  if (!f) return <div className="text-[13px] text-terminal-muted">Waiting for telemetry from this node.</div>;
  const pct = Math.round(f.probability * 100);
  const color = levelHex(f.level);
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[12px] text-terminal-muted">Intrusion probability</div>
          <div className="num text-3xl font-semibold leading-none mt-1" style={{ color }}>{pct}%</div>
        </div>
        <div className="text-right">
          <div className="text-[14px] font-semibold" style={{ color }}>{titleCase(f.level)}</div>
          <div className="text-[12px] text-terminal-muted">{titleCase(f.targetClass)} · {titleCase(f.severity)}</div>
        </div>
      </div>
      <div className="relative h-2 rounded-full bg-terminal-black" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Intrusion probability">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: color }} />
        <div className="absolute -top-0.5 h-3 w-0.5 rounded bg-amber-400" style={{ left: `${thresholds.alert * 100}%` }} title="Alert threshold" />
        <div className="absolute -top-0.5 h-3 w-0.5 rounded bg-red-400" style={{ left: `${thresholds.critical * 100}%` }} title="Critical threshold" />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <Chip on={f.radarActive} label="Radar" />
        <Chip on={f.dualSeismic} label="Dual seismic" />
        <Chip on={f.mlLabel === 'HUMAN' || f.mlLabel === 'VEHICLE'} label={`ML ${f.mlLabel ? titleCase(f.mlLabel) : '—'}`} />
      </div>
      {f.note && <div className="text-[12px] text-amber-300">{f.note}</div>}
      {!compact && (
        <div className="text-[12px] space-y-1.5">
          <div className="text-terminal-muted">Evidence (logit contributions)</div>
          {f.evidence.slice(0, 6).map(e => (
            <div key={e.key} className="flex items-center gap-2">
              <span className="w-32 sm:w-36 truncate text-gray-300">{e.label}</span>
              <span className="flex-1 h-1.5 rounded-full bg-terminal-black relative overflow-hidden" aria-hidden="true">
                <span className="absolute top-0 h-full w-px bg-terminal-border left-1/2" />
                <span className="absolute top-0 h-full rounded-full" style={{
                  left: e.contribution >= 0 ? '50%' : `${50 - Math.min(50, Math.abs(e.contribution) * 12)}%`,
                  width: `${Math.min(50, Math.abs(e.contribution) * 12)}%`, background: e.contribution >= 0 ? '#ef4444' : '#22c55e'
                }} />
              </span>
              <span className="w-10 text-right num">{e.contribution > 0 ? '+' : ''}{e.contribution.toFixed(1)}</span>
            </div>
          ))}
          {f.serverMl && <div className="text-terminal-muted pt-1">Server model: {titleCase(f.serverMl.label)} {Math.round(f.serverMl.confidence * 100)}% — {f.serverMl.explanation}</div>}
          {f.nodeMl && <div className="text-terminal-muted">Edge model (on ESP32): {titleCase(f.nodeMl.label)} {Math.round(f.nodeMl.confidence * 100)}%</div>}
        </div>
      )}
    </div>
  );
};

export default FusionPanel;
