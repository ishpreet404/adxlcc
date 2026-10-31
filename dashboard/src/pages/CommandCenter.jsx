import React from 'react';
import { Map as MapIcon, Radar, Activity, ListTree, Eye, Move, BarChart3, Sparkles, Bell, Brain, ScrollText, Gauge, ChevronRight } from 'lucide-react';
import useStore from '../store/useStore';
import { Card, Button } from '../components';
import SiteMap from '../components/map/SiteMap';
import RadarScope from '../components/radar/RadarScope';
import SeismicScope from '../components/seismic/SeismicScope';
import ProbeCards from '../components/seismic/ProbeCards';
import SpectrumBars from '../components/seismic/SpectrumBars';
import EnergyHistory from '../components/seismic/EnergyHistory';
import TelemetryColumn from '../components/telemetry/TelemetryColumn';
import NodeList from '../components/telemetry/NodeList';
import { NodeControls, NodePicker } from '../components/telemetry/NodeControls';
import FusionPanel from '../components/FusionPanel';
import SnapshotTiles from '../components/SnapshotTiles';
import { AlertCard, AlertFeed } from '../components/alerts/AlertFeed';
import EventLog from '../components/alerts/EventLog';
import StatusStrip from '../components/layout/StatusStrip';
import { BriefingFeed } from '../components/ai/BriefingFeed';
import { MissionBanner } from '../components/mission/MissionCards';
import { EmergencyBar } from '../components/layout/SirenControls';
import { useMediaQuery } from '../lib/hooks';

const LAYERS = [['beams', 'Beams'], ['zones', 'Zones'], ['heat', 'Heat'], ['trails', 'Trails'], ['predict', 'Predict'], ['labels', 'Labels']];

const Chip = ({ on, onClick, children, title }) => (
  <button type="button" onClick={onClick} title={title} aria-pressed={on}
    className={`h-8 lg:h-7 px-2.5 inline-flex items-center gap-1 rounded-md text-[12px] lg:text-[11px] font-medium border whitespace-nowrap transition-colors ${on ? 'border-terminal-cyan/40 bg-terminal-cyan/10 text-sky-300' : 'border-terminal-border text-terminal-muted hover:text-gray-200'}`}>
    {children}
  </button>
);

const MapControls = () => {
  const layers = useStore(s => s.layers);
  const toggleLayer = useStore(s => s.toggleLayer);
  const editMap = useStore(s => s.editMap);
  const setEditMap = useStore(s => s.setEditMap);
  const showTruth = useStore(s => s.showGroundTruth);
  const setShowTruth = useStore(s => s.setShowGroundTruth);
  const sim = useStore(s => s.sim);
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-0.5" role="toolbar" aria-label="Map layers">
      {LAYERS.map(([k, label]) => <Chip key={k} on={layers[k]} onClick={() => toggleLayer(k)}>{label}</Chip>)}
      <span className="w-px h-5 bg-terminal-border mx-1 flex-shrink-0" aria-hidden="true" />
      {sim.actors.length > 0 && <Chip on={showTruth} onClick={() => setShowTruth(!showTruth)} title="Show simulator ground truth (G)"><Eye className="w-3.5 h-3.5" aria-hidden="true" />Truth</Chip>}
      <Chip on={editMap} onClick={() => setEditMap(!editMap)} title="Drag nodes to place them (E)"><Move className="w-3.5 h-3.5" aria-hidden="true" />{editMap ? 'Done placing' : 'Place nodes'}</Chip>
    </div>
  );
};

// ---- cards ----------------------------------------------------------------------------------
const LiveSensors = ({ node }) => (
  <Card title="Live sensors" subtitle={node ? `${node.name}${node.simulated ? ' · simulated' : ''}` : 'No node selected'} icon={Activity} headerAction={<NodePicker />}>
    <SnapshotTiles node={node} />
    {node && <NodeControls node={node} className="mt-3" />}
  </Card>
);

const ActiveAlerts = () => {
  const alerts = useStore(s => s.alerts);
  const setPage = useStore(s => s.setPage);
  return (
    <Card title="Active alerts" subtitle={alerts.length ? `${alerts.length} open` : 'Perimeter secure'} icon={Bell}
      headerAction={<Button size="xs" variant="ghost" onClick={() => setPage('alerts')}>View all<ChevronRight className="w-3.5 h-3.5" aria-hidden="true" /></Button>}>
      {alerts.length ? <div className="space-y-3">{alerts.slice(0, 3).map(a => <AlertCard key={a.id} alert={a} />)}</div> : <AlertFeed limit={0} />}
      {alerts.length > 3 && <button type="button" onClick={() => setPage('alerts')} className="mt-3 text-[13px] font-medium text-sky-300 hover:text-sky-200 self-start">+{alerts.length - 3} more alerts</button>}
    </Card>
  );
};

const MapCard = () => {
  const tracks = useStore(s => s.tracks);
  return (
    <Card title="Site map" subtitle={`${tracks.length} tracked target${tracks.length === 1 ? '' : 's'}`} icon={MapIcon}>
      <MapControls />
      <div className="mt-3 h-[300px] sm:h-[400px] xl:h-[460px] rounded-lg overflow-hidden"><SiteMap /></div>
    </Card>
  );
};

const Vibration = ({ node, wave }) => {
  const features = node && node.latest && node.latest.seismic ? node.latest.seismic.features : null;
  return (
    <Card title="Ground vibration" subtitle="Seismic probes A and B" icon={Activity}>
      <SeismicScope wave={wave} height={170} />
      <div className="mt-3 grid grid-cols-1 2xl:grid-cols-2 gap-3">
        <ProbeCards node={node} />
        <SpectrumBars spectrum={node ? node.spectrum : null} features={features} height={110} />
      </div>
    </Card>
  );
};

const RadarCard = ({ node }) => <Card title="Radar" subtitle="Presence, range and bearing" icon={Radar}><RadarScope node={node} /></Card>;
const FusionCard = ({ node }) => <Card title="Why the system thinks so" subtitle="Sensor fusion and evidence" icon={Brain}><FusionPanel node={node} /></Card>;

const BriefingPreview = () => {
  const setPage = useStore(s => s.setPage);
  return (
    <Card title="Gemini Live Briefing" subtitle="Latest AI incident narration" icon={Sparkles}
      headerAction={<Button size="xs" variant="ghost" onClick={() => setPage('intel')}>Open<ChevronRight className="w-3.5 h-3.5" aria-hidden="true" /></Button>}>
      <BriefingFeed compact limit={3} maxHeight={360} />
    </Card>
  );
};

const NodesCard = () => {
  const nodes = useStore(s => s.nodes);
  return <Card title="Nodes" subtitle={`${Object.keys(nodes).length} on this site`} icon={ListTree}><NodeList /></Card>;
};
const HistoryCard = ({ node }) => (
  <Card title="Last 60 seconds" subtitle={node ? node.name : undefined} icon={BarChart3}>
    {node ? <EnergyHistory nodeId={node.id} /> : <div className="text-[13px] text-terminal-muted">Select a node.</div>}
  </Card>
);
const TelemetryCard = ({ node }) => <Card title="Telemetry" icon={Gauge}><TelemetryColumn node={node} /></Card>;
const EventsCard = () => <Card title="Event log" icon={ScrollText}><EventLog limit={40} height={300} /></Card>;

export const CommandCenter = () => {
  const nodes = useStore(s => s.nodes);
  const selectedId = useStore(s => s.selectedNodeId);
  const waves = useStore(s => s.waves);
  const wide = useMediaQuery('(min-width: 1280px)');
  const node = selectedId ? nodes[selectedId] : null;
  const wave = selectedId ? waves[selectedId] : null;

  if (wide) {
    return (
      <div className="space-y-4">
        <MissionBanner />
        <StatusStrip />
        <div className="grid grid-cols-12 gap-4 items-start">
          <div className="col-span-8 space-y-4 min-w-0">
            <LiveSensors node={node} />
            <MapCard />
            <Vibration node={node} wave={wave} />
            <div className="grid grid-cols-2 gap-4 items-start">
              <RadarCard node={node} />
              <FusionCard node={node} />
            </div>
          </div>
          <div className="col-span-4 space-y-4 min-w-0">
            <ActiveAlerts />
            <BriefingPreview />
            <NodesCard />
            <HistoryCard node={node} />
            <TelemetryCard node={node} />
            <EventsCard />
          </div>
        </div>
      </div>
    );
  }

  // Phones / tablets: KPIs, alerts, the selected node, the map, then everything else.
  return (
    <div className="space-y-4">
      <MissionBanner />
      <EmergencyBar />
      <StatusStrip />
      <ActiveAlerts />
      <LiveSensors node={node} />
      <MapCard />
      <Vibration node={node} wave={wave} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <RadarCard node={node} />
        <FusionCard node={node} />
      </div>
      <BriefingPreview />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <NodesCard />
        <HistoryCard node={node} />
      </div>
      <TelemetryCard node={node} />
      <EventsCard />
    </div>
  );
};

export default CommandCenter;
