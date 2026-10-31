import React, { useEffect, useRef, useState } from 'react';
import { BatteryCharging, Wifi, Radio, Bluetooth, Cpu, Gauge, ShieldAlert, Compass, Volume2, VolumeX, Leaf } from 'lucide-react';
import useStore from '../../store/useStore';
import { fmt, ago, uptime, rssiBars, batteryColor, statusColor, hours, titleCase } from '../../lib/format';
import { Button } from '../Button';
import { Tag } from '../StatusBadge';
import { sonifier } from '../../lib/sonify';

const TransportIcon = ({ tr }) => (tr === 'ble' ? <Bluetooth className="w-3.5 h-3.5" aria-hidden="true" /> : tr === 'lora' ? <Radio className="w-3.5 h-3.5" aria-hidden="true" /> : <Wifi className="w-3.5 h-3.5" aria-hidden="true" />);
const Row = ({ k, v, cls = '' }) => (<><dt>{k}</dt><dd className={cls}>{v}</dd></>);
const Section = ({ icon: Icon, title, children }) => (
  <div className="rounded-lg border border-terminal-border p-3">
    <div className="flex items-center gap-1.5 text-[12px] font-medium text-gray-400 mb-2">{Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}{title}</div>
    {children}
  </div>
);

/** Everything the operator wants to know about one node's health. */
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

  if (!node) return <div className="text-[13px] text-terminal-muted">Select a node.</div>;
  const t = node.latest;
  const bat = t ? t.battery : null;
  const bars = t ? rssiBars(t.rssi) : 0;
  const live = t && t.mode === 'LIVE';
  const tamper = t && t.tamper;
  const fc = node.batteryForecast;

  return (
    <div className="space-y-3 text-[12px]">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold text-[14px] text-gray-50 truncate">{node.name}</div>
          <span className={`text-[12px] font-medium ${statusColor(node.status)}`}>{titleCase(node.status)}</span>
        </div>
        <div className="text-terminal-muted mt-0.5 flex items-center gap-1.5 flex-wrap"><span className="num">{node.id}</span>{node.simulated && <Tag tone="violet">SIM</Tag>}<span>· firmware <span className="num">{t ? t.firmware : '—'}</span></span></div>
      </div>

      {tamper && tamper.flag && (
        <div className="rounded-lg border border-terminal-violet/40 bg-terminal-violet/10 text-violet-200 p-3 flex items-center gap-2" role="alert">
          <ShieldAlert className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <div><div className="font-semibold">Tamper — node {tamper.impact ? 'struck' : 'moved'}</div><div className="text-[11px] text-violet-300/80">Tilt {fmt(tamper.tilt, 1)}° from calibrated rest</div></div>
        </div>
      )}

      <Section icon={BatteryCharging} title="Battery">
        <div className="flex items-center gap-3">
          <div className="relative w-12 h-6 border-2 border-gray-500 rounded-[5px] p-0.5" aria-hidden="true">
            <div className="absolute -right-1.5 top-1.5 w-1 h-2 bg-gray-500 rounded-r-sm" />
            <div className="h-full rounded-[2px] transition-all" style={{ width: `${bat ? (bat.external ? 100 : bat.percent) : 0}%`, background: bat ? (bat.external ? '#38bdf8' : batteryColor(bat.percent)) : '#243142' }} />
          </div>
          <div>
            <div className="num text-lg font-semibold leading-none text-gray-50">{bat ? (bat.external ? 'External' : `${bat.percent}%`) : '—'}</div>
            <div className="text-terminal-muted num mt-0.5">{bat ? (bat.external ? 'USB / mains power · no battery fitted' : `${fmt(bat.voltage, 2)} V`) : ''}{bat && bat.low ? ' · low' : ''}{bat && bat.critical ? ' · critical' : ''}</div>
          </div>
        </div>
        <dl className="kv mt-2">
          <Row k="Forecast" v={fc && fc.hoursLeft !== null ? `≈ ${hours(fc.hoursLeft)} left` : fc ? 'Stable / charging' : 'Learning (≥ 5 min)'} cls={fc && fc.hoursLeft !== null && fc.hoursLeft < 24 ? 'text-amber-300' : ''} />
          <Row k="Drain" v={fc ? `${fc.slopeMvPerHour} mV/h over ${fc.spanH} h` : '—'} />
        </dl>
      </Section>

      <Section icon={() => <TransportIcon tr={t && t.transport} />} title={`Link · ${t ? t.transport.toUpperCase() : '—'}`}>
        <div className="flex items-center gap-2">
          <div className="flex items-end gap-0.5 h-4" aria-hidden="true">{[1, 2, 3, 4].map(i => <div key={i} className="w-1.5 rounded-[1px]" style={{ height: `${i * 25}%`, background: i <= bars ? '#22c55e' : '#243142' }} />)}</div>
          <span className="num text-gray-200">{t ? `${t.rssi} dBm` : '—'}</span>
          <span className="text-terminal-muted">· <span className="num">{node.rate}</span> pkt/s</span>
        </div>
        <dl className="kv mt-2">
          <Row k="Last packet" v={ago(node.lastSeen)} />
          <Row k="Sequence" v={t ? t.seq : '—'} />
          <Row k="Packet loss" v={`${fmt(node.packetLoss, 1)} %`} cls={node.packetLoss > 5 ? 'text-amber-300' : ''} />
          <Row k="Reboots seen" v={node.reboots || 0} />
        </dl>
      </Section>

      <Section icon={Cpu} title="Node state">
        <dl className="kv">
          <Row k="Power mode" v={t ? titleCase(t.mode) : '—'} cls={live ? 'text-sky-300' : 'text-green-300'} />
          <Row k="Edge state" v={t ? titleCase(t.state) : '—'} cls={t && t.state === 'EVENT' ? 'text-red-300' : t && t.state === 'SUSPECT' ? 'text-amber-300' : ''} />
          <Row k="Uptime" v={t ? uptime(t.uptimeMs) : '—'} />
          <Row k="Free heap" v={t && t.sys && t.sys.heap ? `${Math.round(t.sys.heap / 1024).toLocaleString()} kB` : '—'} />
          <Row k="Core temp" v={t && t.sys && t.sys.temp ? `${fmt(t.sys.temp, 1)} °C` : '—'} />
          <Row k="Edge ML" v={t && t.ml ? `${titleCase(t.ml.label)} ${Math.round(t.ml.confidence * 100)}%` : 'n/a'} />
        </dl>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <Button size="sm" variant={live ? 'warning' : 'outline'} onClick={() => command(node.id, { mode: 'ECO' })} title="Back to battery-saving mode" disabled={!live}>
            <Leaf className="w-3.5 h-3.5" aria-hidden="true" />Eco mode
          </Button>
          <Button size="sm" variant={listening ? 'selected' : 'outline'} onClick={toggleListen} title="Hear the ground probe (needs live waveforms)" aria-pressed={listening}>
            {listening ? <VolumeX className="w-3.5 h-3.5" aria-hidden="true" /> : <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />}{listening ? 'Stop' : 'Listen'}
          </Button>
        </div>
      </Section>

      <Section icon={Gauge} title="Sensor health">
        <dl className="kv">
          <Row k="Radar" v={!t ? '—' : !t.radar.ok ? 'No data' : t.radar.presence ? `Target ${fmt(t.radar.distance, 1)} m` : 'Clear'} cls={t && t.radar.presence ? 'text-red-300' : t && !t.radar.ok ? 'text-amber-300' : 'text-green-300'} />
          <Row k="Probe A" v={!t ? '—' : t.probes[0].ok ? `${fmt(t.probes[0].rms, 4)} g` : 'Fault'} cls={t && !t.probes[0].ok ? 'text-red-300' : ''} />
          <Row k="Probe B" v={!t ? '—' : t.probes[1].ok ? `${fmt(t.probes[1].rms, 4)} g` : 'Fault'} cls={t && !t.probes[1].ok ? 'text-red-300' : ''} />
          <Row k="Noise floor" v={t && t.noiseFloor !== null && t.noiseFloor !== undefined ? `${fmt(t.noiseFloor, 4)} g` : '—'} />
          <Row k="Body tilt" v={tamper ? `${fmt(tamper.tilt, 1)}°` : '—'} cls={tamper && tamper.tilt > 20 ? 'text-violet-300' : ''} />
          <Row k="Calibrated" v={node.calibratedAt ? ago(node.calibratedAt) : 'At boot'} />
          <Row k="Placement" v={`${node.x}, ${node.y} m · ${node.heading}°`} />
          <Row k="Probe spacing" v={`${node.spacing} m`} />
        </dl>
        {tamper && (
          <div className="mt-2 flex items-center gap-2">
            <Compass className="w-3.5 h-3.5 text-terminal-muted" aria-hidden="true" />
            <div className="flex-1 h-1.5 rounded-full bg-terminal-black overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, (tamper.tilt / 45) * 100)}%`, background: tamper.tilt > 20 ? '#a78bfa' : '#22c55e' }} /></div>
            <span className="text-[11px] text-terminal-muted">tilt / 45°</span>
          </div>
        )}
      </Section>
    </div>
  );
};

export default TelemetryColumn;
