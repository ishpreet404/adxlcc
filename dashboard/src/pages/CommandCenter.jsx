import React from 'react';
import { Map, Radar, Activity, ListTree, Eye, EyeOff, Move, Layers, X, BarChart3 } from 'lucide-react';
import useStore from '../store/useStore';
import { Card } from '../components';
import SiteMap from '../components/map/SiteMap';
import RadarScope from '../components/radar/RadarScope';
import SeismicScope from '../components/seismic/SeismicScope';
import ProbeCards from '../components/seismic/ProbeCards';
import SpectrumBars from '../components/seismic/SpectrumBars';
import EnergyHistory from '../components/seismic/EnergyHistory';
import TelemetryColumn from '../components/telemetry/TelemetryColumn';
import NodeList from '../components/telemetry/NodeList';
import FusionPanel from '../components/FusionPanel';
import SnapshotTiles from '../components/SnapshotTiles';
import AlertFeed, { AlertCard } from '../components/alerts/AlertFeed';
import EventLog from '../components/alerts/EventLog';
import StatusStrip from '../components/layout/StatusStrip';

const Toggle = ({ on, onClick, iconOn: IconOn, iconOff: IconOff, label, title }) => (
  <button onClick={onClick} title={title} className={`flex items-center gap-1 px-2 py-0.5 text-[10px] border ${on ? 'border-terminal-green text-terminal-green' : 'border-terminal-border text-terminal-muted'}`}>
    {on ? <IconOn className="w-3 h-3" /> : <IconOff className="w-3 h-3" />} {label}
  </button>
);

const LAYERS = [['beams', 'BEAMS'], ['zones', 'ZONES'], ['heat', 'HEAT'], ['trails', 'TRAILS'], ['predict', 'PREDICT'], ['labels', 'LABELS']];

const LayerBar = () => {
  const layers = useStore(s => s.layers);
  const toggleLayer = useStore(s => s.toggleLayer);
  return (
    <div className="flex items-center gap-0.5">
      <Layers className="w-3 h-3 text-terminal-muted mr-0.5" />
      {LAYERS.map(([k, label]) => (
        <button key={k} onClick={() => toggleLayer(k)} className={`px-1.5 py-0.5 text-[9px] border ${layers[k] ? 'border-terminal-cyan text-terminal-cyan' : 'border-terminal-border text-terminal-muted'}`}>{label}</button>
      ))}
    </div>
  );
};

const WallMode = () => {
  const setWallMode = useStore(s => s.setWallMode);
  const alerts = useStore(s => s.alerts);
  const active = alerts.filter(a => a.status === 'ACTIVE');
  return (
    <div className={`fixed inset-0 z-[60] bg-terminal-black flex flex-col ${active.length ? 'alert-frame' : ''}`}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-terminal-border">
        <StatusStrip />
        <button onClick={() => setWallMode(false)} className="ml-3 p-1 border border-terminal-border text-terminal-muted hover:text-white" title="Exit wall mode (Esc)"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 relative">
        <SiteMap wall />
        {active.length > 0 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 max-w-[80%] border border-terminal-red bg-terminal-black/90 px-4 py-2 text-center">
            <div className="text-terminal-red font-extrabold text-xl animate-pulse">{active[0].severity} {active[0].kind}{active[0].kind === 'INTRUSION' ? ' · ' + active[0].targetClass : ''} — {active[0].nodeName}</div>
            <div className="text-terminal-muted text-sm">{active[0].zone ? `${active[0].zone.name} · ` : ''}{active[0].position ? `range ${active[0].position.rangeM} m · bearing ${active[0].position.bearingDeg}°` : ''}{active.length > 1 ? ` · +${active.length - 1} more` : ''}</div>
          </div>
        )}
      </div>
    </div>
  );
};

export const CommandCenter = () => {
  const nodes = useStore(s => s.nodes);
  const selectedId = useStore(s => s.selectedNodeId);
  const waves = useStore(s => s.waves);
  const tracks = useStore(s => s.tracks);
  const alerts = useStore(s => s.alerts);
  const editMap = useStore(s => s.editMap);
  const setEditMap = useStore(s => s.setEditMap);
  const showTruth = useStore(s => s.showGroundTruth);
  const setShowTruth = useStore(s => s.setShowGroundTruth);
  const sim = useStore(s => s.sim);
  const wallMode = useStore(s => s.wallMode);
  const node = selectedId ? nodes[selectedId] : null;
  const wave = selectedId ? waves[selectedId] : null;
  const critical = alerts.some(a => a.status === 'ACTIVE' && !a.test);
  const features = node && node.latest && node.latest.seismic ? node.latest.seismic.features : null;

  if (wallMode) return <WallMode />;

  return (
    <div className={`space-y-3 ${critical ? 'alert-frame' : ''}`}>
      <StatusStrip />

      {/* selected node at a glance */}
      <Card className="!h-auto" title={<span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> LIVE SENSORS · {node ? node.name : 'select a node'}</span>}>
        <SnapshotTiles node={node} />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <div className="xl:col-span-3 space-y-3">
          <Card className="!h-auto" title={<span className="flex items-center gap-1.5"><ListTree className="w-3.5 h-3.5" /> NODES ({Object.keys(nodes).length})</span>}><NodeList /></Card>
          <Card className="!h-auto" title={<span className="flex items-center gap-1.5"><Radar className="w-3.5 h-3.5" /> RADAR</span>}><RadarScope node={node} /></Card>
          <Card className="!h-auto" title={<span className="flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> LAST 60 SECONDS</span>}>
            {node ? <EnergyHistory nodeId={node.id} /> : <div className="text-[11px] text-terminal-muted">select a node</div>}
          </Card>
        </div>

        <div className="xl:col-span-6 space-y-3">
          <Card
            title={<span className="flex items-center gap-1.5"><Map className="w-3.5 h-3.5" /> SITE MAP · {tracks.length} TRACK{tracks.length === 1 ? '' : 'S'}</span>}
            headerAction={
              <div className="flex items-center gap-1 flex-wrap justify-end">
                <LayerBar />
                {sim.actors.length > 0 && <Toggle on={showTruth} onClick={() => setShowTruth(!showTruth)} iconOn={Eye} iconOff={EyeOff} label="TRUTH" title="Show simulator ground truth (G)" />}
                <Toggle on={editMap} onClick={() => setEditMap(!editMap)} iconOn={Move} iconOff={Move} label={editMap ? 'DONE' : 'PLACE'} title="Drag nodes to place them (E)" />
              </div>
            }
            className="min-h-[420px]"
          >
            <div className="h-[400px] xl:h-[460px]"><SiteMap /></div>
          </Card>
          <Card className="!h-auto" title={<span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> GROUND VIBRATION · PROBES A &amp; B</span>}>
            <SeismicScope wave={wave} height={170} />
            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
              <ProbeCards node={node} />
              <SpectrumBars spectrum={node ? node.spectrum : null} features={features} height={110} />
            </div>
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="!h-auto" title="WHY THE SYSTEM THINKS SO"><FusionPanel node={node} /></Card>
            <Card className="!h-auto" title={`ALERTS (${alerts.length})`}>
              {alerts.length ? <div className="space-y-2">{alerts.slice(0, 3).map(a => <AlertCard key={a.id} alert={a} />)}</div> : <AlertFeed limit={0} />}
            </Card>
          </div>
        </div>

        <div className="xl:col-span-3 space-y-3">
          <Card className="!h-auto" title="TELEMETRY"><TelemetryColumn node={node} /></Card>
          <Card className="!h-auto" title="EVENT LOG"><EventLog limit={40} height={260} /></Card>
        </div>
      </div>
    </div>
  );
};

export default CommandCenter;
