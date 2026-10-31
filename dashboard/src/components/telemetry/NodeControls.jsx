import React from 'react';
import { Siren, Zap, Crosshair, BellOff } from 'lucide-react';
import useStore from '../../store/useStore';
import { Button } from '../Button';
import { Select } from '../Input';

/** Remote commands for one node (queued, delivered on the node's next uplink). */
export const NodeControls = ({ node, className = '' }) => {
  const command = useStore(s => s.command);
  if (!node) return null;
  const live = node.latest && node.latest.mode === 'LIVE';
  return (
    <div className={`grid grid-cols-1 sm:flex sm:flex-wrap gap-2 ${className}`} role="group" aria-label={`Controls for ${node.name}`}>
      <Button size="sm" variant="danger" onClick={() => command(node.id, { deter: 10 })} title="Sound the siren / deterrent on this node for 10 seconds">
        <Siren className="w-3.5 h-3.5" aria-hidden="true" />Sound alarm (10 s)
      </Button>
      <Button size="sm" variant="outline" onClick={() => command(node.id, { silence: true })} title="Stop this node's siren now">
        <BellOff className="w-3.5 h-3.5" aria-hidden="true" />Silence
      </Button>
      <Button size="sm" variant={live ? 'selected' : 'outline'} onClick={() => command(node.id, { mode: 'LIVE', liveFor: 300 })} title="Stream waveforms at 4 Hz for 5 minutes">
        <Zap className="w-3.5 h-3.5" aria-hidden="true" />{live ? 'Live mode on · extend 5 min' : 'Live mode 5 min'}
      </Button>
      <Button size="sm" variant="outline" onClick={() => command(node.id, { calibrate: true })} title="Re-learn rest orientation and noise floor">
        <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />Calibrate
      </Button>
    </div>
  );
};

/** Compact node selector (used where the full node list isn't visible). */
export const NodePicker = ({ className = '' }) => {
  const nodes = useStore(s => s.nodes);
  const selectedId = useStore(s => s.selectedNodeId);
  const selectNode = useStore(s => s.selectNode);
  const list = Object.values(nodes).sort((a, b) => a.id.localeCompare(b.id));
  if (list.length < 2) return null;
  return (
    <Select value={selectedId || ''} onChange={e => selectNode(e.target.value)} aria-label="Select node" className={`max-w-[11rem] ${className}`}>
      {list.map(n => <option key={n.id} value={n.id}>{n.name}{n.simulated ? ' (SIM)' : ''}{n.status !== 'ONLINE' ? ` · ${n.status.toLowerCase()}` : ''}</option>)}
    </Select>
  );
};

export default NodeControls;
