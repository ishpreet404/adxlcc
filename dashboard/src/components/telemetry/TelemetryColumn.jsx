import React, { useEffect, useRef, useState } from 'react';
import { BatteryCharging, Wifi, Radio, Bluetooth, Cpu, Gauge, Zap, ShieldAlert, Compass, Volume2, VolumeX, Siren, Crosshair } from 'lucide-react';
import useStore from '../../store/useStore';
import { fmt, ago, uptime, rssiBars, batteryColor, statusColor, hours } from '../../lib/format';
import { Button } from '../Button';
import { sonifier } from '../../lib/sonify';

const TransportIcon = ({ tr }) => (tr === 'ble' ? <Bluetooth className="w-3.5 h-3.5" /> : tr === 'lora' ? <Radio className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />);
const Row = ({ k, v, cls = '' }) => (<><dt>{k}</dt><dd className={cls}>{v}</dd></>);

/** Everything the operator wants to know about one node's health, plus node controls. */
export const TelemetryColumn = ({ node }) => {
  const command = useStore(s => s.command);
  const waves = useStore(s => s.waves);
  const [listening, setListening] = useState(false);
  const lastLen = useRef(0);

  // sonification: feed each new chunk of probe A
  const wave = node ? waves[node.id] : null;
  useEffect(() => {
    if (!listening || !wave) return;
    const n = wave.a.length;
    const added = Math.min(100, Math.max(0, n - lastLen.current));
    lastLen.current = n;
    if (added) sonifier.push(wave.a.slice(-added), wave.fs);
  }, [wave, listening]);
  useEffect(() => () => sonifier.stop(), []);
  const toggleListen = () => {
    if (listening) { sonifier.stop(); setListening(false); } else { sonifier.start(); lastLen.current = wave ? wave.a.length : 0; setListening(true); }
  };

  if (!node) return <div className="text-[11px] text-terminal-muted">Select a node.</div>;
  const t = node.latest;
  const bat = t ? t.battery : null;
  const bars = t ? rssiBars(t.rssi) : 0;
  const live = t && t.mode === 'LIVE';
  const tamper = t && t.tamper;
  const fc = node.batteryForecast;

  return (
    <div className="space-y-3 text-[11px]">
      <div>
        <div className="flex items-center justify-between">
          <div className="font-bold text-sm text-gray-100">{node.name}</div>
          <span className={`font-bold ${statusColor(node.status)}`}>{node.status}</span>
        </div>
        <div className="text-terminal-muted">{node.id}{node.simulated ? ' · SIMULATED' : ''} · fw {t ? t.firmware : '—'}</div>
      </div>

      {tamper && tamper.flag && (
        <div className="border border-terminal-violet bg-terminal-violet/10 text-terminal-violet p-2 flex items-center gap-2 animate-pulse">
          <ShieldAlert className="w-4 h-4" /><div><div className="font-bold">TAMPER — node {tamper.impact ? 'struck' : 'moved'}</div><div className="text-[10px]">tilt {fmt(tamper.tilt, 1)}° from calibrated rest</div></div>
        </div>
      )}

      <div className="border border-terminal-border p-2">
        <div className="flex items-center gap-1.5 text-terminal-muted mb-1"><BatteryCharging className="w-3.5 h-3.5" /> BATTERY</div>
        <div className="flex items-center gap-2">
          <div className="relative w-14 h-6 border-2 border-gray-400 rounded-sm">
            <div className="absolute -right-1.5 top-1.5 w-1 h-2.5 bg-gray-400" />
            <div className="h-full transition-all" style={{ width: `${bat ? bat.percent : 0}%`, background: bat ? batteryColor(bat.percent) : '#374151' }} />
          </div>
          <div>
            <div className="text-lg font-bold leading-none tabular-nums" style={{ color: bat ? batteryColor(bat.percent) : '#6b7280' }}>{bat ? `${bat.percent}%` : '—'}</div>
            <div className="text-terminal-muted tabular-nums">{bat ? `${fmt(bat.voltage, 2)} V` : ''}{bat && bat.low ? ' · LOW' : ''}{bat && bat.critical ? ' · CRITICAL' : ''}</div>
          </div>
        </div>
        <dl className="kv mt-1">
          <Row k="forecast" v={fc && fc.hoursLeft !== null ? `≈ ${hours(fc.hoursLeft)} left` : fc ? 'stable / charging' : 'learning (≥5 min)'} cls={fc && fc.hoursLeft !== null && fc.hoursLeft < 24 ? 'text-terminal-amber' : ''} />
          <Row k="drain" v={fc ? `${fc.slopeMvPerHour} mV/h over ${fc.spanH} h` : '—'} />
        </dl>
      </div>

      <div className="border border-terminal-border p-2">
        <div className="flex items-center gap-1.5 text-terminal-muted mb-1"><TransportIcon tr={t && t.transport} /> LINK · {t ? t.transport.toUpperCase() : '—'}</div>
        <div className="flex items-center gap-2">
          <div className="flex items-end gap-0.5 h-4">{[1, 2, 3, 4].map(i => <div key={i} className="w-1.5" style={{ height: `${i * 25}%`, background: i <= bars ? '#00ff66' : '#1f2937' }} />)}</div>
          <span className="tabular-nums">{t ? `${t.rssi} dBm` : '—'}</span>
          <span className="text-terminal-muted">· {node.rate} pkt/s</span>
        </div>
        <dl className="kv mt-1">
          <Row k="last packet" v={ago(node.lastSeen)} />
          <Row k="sequence" v={t ? t.seq : '—'} />
          <Row k="packet loss" v={`${fmt(node.packetLoss, 1)} %`} cls={node.packetLoss > 5 ? 'text-terminal-amber' : ''} />
          <Row k="reboots seen" v={node.reboots || 0} />
        </dl>
      </div>

      <div className="border border-terminal-border p-2">
        <div className="flex items-center gap-1.5 text-terminal-muted mb-1"><Cpu className="w-3.5 h-3.5" /> NODE STATE</div>
        <dl className="kv">
          <Row k="power mode" v={t ? t.mode : '—'} cls={live ? 'text-terminal-cyan' : 'text-terminal-green'} />
          <Row k="edge state" v={t ? t.state : '—'} cls={t && t.state === 'EVENT' ? 'text-terminal-red' : t && t.state === 'SUSPECT' ? 'text-terminal-amber' : ''} />
          <Row k="uptime" v={t ? uptime(t.uptimeMs) : '—'} />
          <Row k="free heap" v={t && t.sys && t.sys.heap ? `${Math.round(t.sys.heap / 1024)} kB` : '—'} />
          <Row k="core temp" v={t && t.sys && t.sys.temp ? `${fmt(t.sys.temp, 1)} °C` : '—'} />
          <Row k="edge ML" v={t && t.ml ? `${t.ml.label} ${Math.round(t.ml.confidence * 100)}%` : 'n/a'} />
        </dl>
        <div className="grid grid-cols-2 gap-1 mt-2">
          <Button size="sm" variant={live ? 'outline' : 'primary'} onClick={() => command(node.id, { mode: 'LIVE', liveFor: 300 })} title="Stream waveforms at 4 Hz for 5 minutes"><Zap className="w-3 h-3 mr-1" /> LIVE</Button>
          <Button size="sm" variant={live ? 'warning' : 'outline'} onClick={() => command(node.id, { mode: 'ECO' })} title="Back to battery-saving mode">ECO</Button>
          <Button size="sm" variant="outline" onClick={() => command(node.id, { calibrate: true })} title="Re-learn rest orientation and noise floor"><Crosshair className="w-3 h-3 mr-1" /> CALIBRATE</Button>
          <Button size="sm" variant="danger" onClick={() => command(node.id, { deter: 10 })} title="Strobe the node LED / deterrent output for 10 s"><Siren className="w-3 h-3 mr-1" /> DETER</Button>
        </div>
        <Button size="sm" variant={listening ? 'warning' : 'ghost'} className="w-full mt-1" onClick={toggleListen} title="Hear the ground probe (needs LIVE waveforms)">
          {listening ? <VolumeX className="w-3 h-3 mr-1" /> : <Volume2 className="w-3 h-3 mr-1" />} {listening ? 'STOP LISTENING' : 'LISTEN TO PROBE A'}
        </Button>
      </div>

      <div className="border border-terminal-border p-2">
        <div className="flex items-center gap-1.5 text-terminal-muted mb-1"><Gauge className="w-3.5 h-3.5" /> SENSOR HEALTH</div>
        <dl className="kv">
          <Row k="radar" v={!t ? '—' : !t.radar.ok ? 'NO DATA' : t.radar.presence ? `TARGET ${fmt(t.radar.distance, 1)} m` : 'clear'} cls={t && t.radar.presence ? 'text-terminal-red' : t && !t.radar.ok ? 'text-terminal-amber' : 'text-terminal-green'} />
          <Row k="probe A" v={!t ? '—' : t.probes[0].ok ? `${fmt(t.probes[0].rms, 4)} g` : 'FAULT'} cls={t && !t.probes[0].ok ? 'text-terminal-red' : ''} />
          <Row k="probe B" v={!t ? '—' : t.probes[1].ok ? `${fmt(t.probes[1].rms, 4)} g` : 'FAULT'} cls={t && !t.probes[1].ok ? 'text-terminal-red' : ''} />
          <Row k="noise floor" v={t && t.noiseFloor !== null && t.noiseFloor !== undefined ? `${fmt(t.noiseFloor, 4)} g` : '—'} />
          <Row k="body tilt" v={tamper ? `${fmt(tamper.tilt, 1)}°` : '—'} cls={tamper && tamper.tilt > 20 ? 'text-terminal-violet' : ''} />
          <Row k="calibrated" v={node.calibratedAt ? ago(node.calibratedAt) : 'at boot'} />
          <Row k="placement" v={`${node.x}, ${node.y} m · ${node.heading}°`} />
          <Row k="probe spacing" v={`${node.spacing} m`} />
        </dl>
        {tamper && (
          <div className="mt-1.5 flex items-center gap-2">
            <Compass className="w-3.5 h-3.5 text-terminal-muted" />
            <div className="flex-1 h-1.5 bg-terminal-black border border-terminal-border"><div className="h-full" style={{ width: `${Math.min(100, (tamper.tilt / 45) * 100)}%`, background: tamper.tilt > 20 ? '#a78bfa' : '#00ff66' }} /></div>
            <span className="text-[10px] text-terminal-muted">tilt / 45°</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default TelemetryColumn;
