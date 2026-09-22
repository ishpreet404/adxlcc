import React, { useEffect, useState } from 'react';
import { Play, Square, UserRoundSearch, Car, Trash2, Save, PenTool, Check, X, ShieldAlert, Send, Siren, Lock, Unlock, FlaskConical } from 'lucide-react';
import useStore from '../store/useStore';
import api from '../services/api';
import { Card, Button, Input, Separator } from '../components';
import SiteMap from '../components/map/SiteMap';
import { zoneHex } from '../lib/format';

const NodeRow = ({ node }) => {
  const [form, setForm] = useState({ name: node.name, x: node.x, y: node.y, heading: node.heading, spacing: node.spacing });
  useEffect(() => { setForm({ name: node.name, x: node.x, y: node.y, heading: node.heading, spacing: node.spacing }); }, [node.name, node.x, node.y, node.heading, node.spacing]);
  const save = () => api.updateNode(node.id, { ...form, x: Number(form.x), y: Number(form.y), heading: Number(form.heading), spacing: Number(form.spacing) }).catch(e => alert(e.message));
  const remove = () => { if (window.confirm(`Remove ${node.id} from the site?`)) api.removeNode(node.id).catch(e => alert(e.message)); };
  const field = (k, w = 'w-16', step = '0.1') => (
    <input value={form[k]} type={k === 'name' ? 'text' : 'number'} step={step} onChange={e => setForm({ ...form, [k]: e.target.value })}
      className={`${w} bg-terminal-black border border-terminal-border px-1 py-0.5 text-[11px] focus:border-terminal-green outline-none`} />
  );
  return (
    <tr className="border-b border-terminal-border/50">
      <td className="py-1 pr-2 text-[11px]"><span className="font-bold">{node.id}</span>{node.simulated && <span className="ml-1 text-[9px] text-terminal-violet">SIM</span>}<div className="text-terminal-muted text-[9px]">{node.status}</div></td>
      <td className="py-1 pr-2">{field('name', 'w-32')}</td>
      <td className="py-1 pr-2">{field('x')}</td>
      <td className="py-1 pr-2">{field('y')}</td>
      <td className="py-1 pr-2">{field('heading', 'w-16', '1')}</td>
      <td className="py-1 pr-2">{field('spacing')}</td>
      <td className="py-1 flex gap-1">
        <Button size="sm" onClick={save} title="save"><Save className="w-3 h-3" /></Button>
        {!node.simulated && <Button size="sm" variant="danger" onClick={remove} title="remove"><Trash2 className="w-3 h-3" /></Button>}
      </td>
    </tr>
  );
};

const ZoneEditor = () => {
  const site = useStore(s => s.site);
  const zoneDraft = useStore(s => s.zoneDraft);
  const setZoneDraft = useStore(s => s.setZoneDraft);
  const setEditMap = useStore(s => s.setEditMap);
  const [name, setName] = useState('Restricted area');
  const [type, setType] = useState('restricted');
  const start = () => { setEditMap(false); setZoneDraft({ points: [] }); };
  const finish = () => {
    if (!zoneDraft || zoneDraft.points.length < 3) return;
    api.createZone({ name, type, points: zoneDraft.points }).then(() => setZoneDraft(null)).catch(e => alert(e.message));
  };
  const cancel = () => { setZoneDraft(null); setEditMap(true); };
  return (
    <div className="space-y-2 text-[11px]">
      <div className="text-terminal-muted text-[10px]">Zones change what an alert means: <span className="text-terminal-red">restricted</span> escalates anything inside to CRITICAL, <span className="text-terminal-amber">watch</span> just tags the alert, <span className="text-terminal-green">allowed</span> lets vehicles pass (driveways).</div>
      {!zoneDraft ? (
        <div className="flex gap-2 items-center flex-wrap">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="zone name" className="flex-1 min-w-[140px]" />
          <select value={type} onChange={e => setType(e.target.value)} className="bg-terminal-black border border-terminal-border px-1 py-1.5">
            <option value="restricted">restricted</option><option value="watch">watch</option><option value="allowed">allowed</option>
          </select>
          <Button size="sm" onClick={start}><PenTool className="w-3 h-3 mr-1" /> DRAW ON MAP</Button>
        </div>
      ) : (
        <div className="flex gap-2 items-center flex-wrap border border-terminal-amber p-2">
          <span className="text-terminal-amber">Click the map to add vertices ({zoneDraft.points.length}/3 min)</span>
          <Button size="sm" onClick={finish} disabled={zoneDraft.points.length < 3}><Check className="w-3 h-3 mr-1" /> SAVE ZONE</Button>
          <Button size="sm" variant="ghost" onClick={() => setZoneDraft({ points: zoneDraft.points.slice(0, -1) })} disabled={!zoneDraft.points.length}>UNDO</Button>
          <Button size="sm" variant="ghost" onClick={cancel}><X className="w-3 h-3 mr-1" /> CANCEL</Button>
        </div>
      )}
      {(site.zones || []).length > 0 && (
        <table className="w-full">
          <tbody>
            {site.zones.map(z => (
              <tr key={z.id} className="border-b border-terminal-border/40">
                <td className="py-1"><span className="inline-block w-2 h-2 mr-1.5" style={{ background: zoneHex(z.type) }} />{z.name}</td>
                <td className="py-1">
                  <select value={z.type} onChange={e => api.updateZone(z.id, { type: e.target.value })} className="bg-terminal-black border border-terminal-border px-1 text-[10px]">
                    <option value="restricted">restricted</option><option value="watch">watch</option><option value="allowed">allowed</option>
                  </select>
                </td>
                <td className="py-1 text-terminal-muted">{z.points.length} pts</td>
                <td className="py-1 text-right"><Button size="sm" variant="danger" onClick={() => api.removeZone(z.id)}><Trash2 className="w-3 h-3" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

const ArmingPanel = () => {
  const arming = useStore(s => s.arming);
  const setArming = useStore(s => s.setArming);
  const [sched, setSched] = useState(arming.schedule);
  useEffect(() => setSched(arming.schedule), [arming.schedule]);
  return (
    <div className="space-y-2 text-[11px]">
      <div className="flex gap-1">
        {[['ARMED', Lock, 'danger'], ['TEST', FlaskConical, 'warning'], ['DISARMED', Unlock, 'primary']].map(([m, Icon, v]) => (
          <Button key={m} size="sm" variant={arming.mode === m ? v : 'outline'} className="flex-1" onClick={() => setArming(m)}><Icon className="w-3 h-3 mr-1" />{m}</Button>
        ))}
      </div>
      <div className="text-terminal-muted text-[10px]">TEST raises alerts flagged as test (no siren, no notifications) — use it for walk tests. DISARMED only logs detections; tamper alerts always fire.</div>
      <Separator variant="dots" />
      <label className="flex items-center gap-2"><input type="checkbox" checked={sched.enabled} onChange={e => setSched({ ...sched, enabled: e.target.checked })} /> Daily schedule</label>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-terminal-muted">arm at</span><input type="time" value={sched.armAt} onChange={e => setSched({ ...sched, armAt: e.target.value })} className="bg-terminal-black border border-terminal-border px-1" />
        <span className="text-terminal-muted">disarm at</span><input type="time" value={sched.disarmAt} onChange={e => setSched({ ...sched, disarmAt: e.target.value })} className="bg-terminal-black border border-terminal-border px-1" />
        <Button size="sm" onClick={() => api.setSchedule(sched).catch(e => alert(e.message))}><Save className="w-3 h-3 mr-1" /> SAVE</Button>
      </div>
    </div>
  );
};

export const Setup = () => {
  const nodes = useStore(s => s.nodes);
  const site = useStore(s => s.site);
  const sim = useStore(s => s.sim);
  const notify = useStore(s => s.notify);
  const selectedId = useStore(s => s.selectedNodeId);
  const setEditMap = useStore(s => s.setEditMap);
  const setZoneDraft = useStore(s => s.setZoneDraft);
  const toast = useStore(s => s.toast);
  const [dims, setDims] = useState({ width: site.width, height: site.height, name: site.name });
  const [simNodes, setSimNodes] = useState(2);
  const [health, setHealth] = useState(null);

  useEffect(() => { setDims({ width: site.width, height: site.height, name: site.name }); }, [site.width, site.height, site.name]);
  useEffect(() => { setEditMap(true); return () => { setEditMap(false); setZoneDraft(null); }; }, [setEditMap, setZoneDraft]);
  useEffect(() => { api.health().then(setHealth).catch(() => {}); const t = setInterval(() => api.health().then(setHealth).catch(() => {}), 5000); return () => clearInterval(t); }, []);

  const list = Object.values(nodes).sort((a, b) => a.id.localeCompare(b.id));
  const selected = selectedId ? nodes[selectedId] : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-shadow-terminal">$ SITE --setup</h1>
        <p className="text-terminal-muted text-sm">Place nodes where they physically stand, draw zones, set arming, wire notifications. Heading = direction the radar faces (0° east, 90° north). Probe A is on the node's left, probe B on its right.</p>
      </div>
      <Separator variant="equals" />
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <div className="xl:col-span-7 space-y-3">
          <Card className="!h-auto" title="SITE MAP · DRAG NODES / DRAW ZONES"><div className="h-[460px]"><SiteMap /></div></Card>
          <Card className="!h-auto" title="NODE PLACEMENT">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead><tr className="text-terminal-muted text-left"><th>NODE</th><th>NAME</th><th>X (m)</th><th>Y (m)</th><th>HEADING°</th><th>SPACING (m)</th><th /></tr></thead>
                <tbody>{list.map(n => <NodeRow key={n.id} node={n} />)}</tbody>
              </table>
              {!list.length && <div className="text-terminal-muted text-[11px]">No nodes yet.</div>}
            </div>
          </Card>
          <Card className="!h-auto" title={`ZONES (${(site.zones || []).length})`}><ZoneEditor /></Card>
        </div>
        <div className="xl:col-span-5 space-y-3">
          <Card className="!h-auto" title="ARMING"><ArmingPanel /></Card>
          <Card className="!h-auto" title="SITE DIMENSIONS">
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <label className="space-y-1"><div className="text-terminal-muted">NAME</div><Input value={dims.name} onChange={e => setDims({ ...dims, name: e.target.value })} /></label>
              <label className="space-y-1"><div className="text-terminal-muted">WIDTH (m)</div><Input type="number" value={dims.width} onChange={e => setDims({ ...dims, width: e.target.value })} /></label>
              <label className="space-y-1"><div className="text-terminal-muted">HEIGHT (m)</div><Input type="number" value={dims.height} onChange={e => setDims({ ...dims, height: e.target.value })} /></label>
            </div>
            <Button size="sm" className="mt-2" onClick={() => api.updateSite({ ...dims, width: Number(dims.width), height: Number(dims.height) }).catch(e => alert(e.message))}>SAVE SITE</Button>
          </Card>

          <Card className="!h-auto" title="NOTIFICATIONS">
            <dl className="kv">
              <dt>telegram</dt><dd className={notify.telegram ? 'text-terminal-green' : ''}>{notify.telegram ? 'configured' : 'set TELEGRAM_BOT_TOKEN / CHAT_ID'}</dd>
              <dt>webhook</dt><dd className={notify.webhook ? 'text-terminal-green' : ''}>{notify.webhook ? 'configured' : 'set WEBHOOK_URL'}</dd>
              <dt>pi siren GPIO</dt><dd className={notify.siren ? 'text-terminal-green' : ''}>{notify.siren || 'set SIREN_GPIO'}</dd>
            </dl>
            <div className="flex gap-1 mt-2">
              <Button size="sm" variant="outline" onClick={() => api.notifyTest().then(r => toast({ kind: 'CMD', severity: 'INFO', title: 'Test notification', message: r.sent ? 'sent to configured channels' : 'nothing configured (server/.env)' })).catch(e => alert(e.message))}><Send className="w-3 h-3 mr-1" /> TEST</Button>
              <Button size="sm" variant="danger" onClick={() => api.siren(true, 3)} disabled={!notify.siren}><Siren className="w-3 h-3 mr-1" /> SIREN 3s</Button>
            </div>
            <div className="text-[10px] text-terminal-muted mt-1">Channels are configured in <code>server/.env</code> and need only the Pi's network / a GPIO relay.</div>
          </Card>

          <Card className="!h-auto" title={`SIMULATOR · ${sim.running ? 'RUNNING' : 'STOPPED'}`}>
            <div className="text-[10px] text-terminal-muted mb-2">Simulated nodes run through the same pipeline as hardware and are labelled SIM everywhere.</div>
            <div className="flex flex-wrap gap-2 items-center text-[11px]">
              <label className="flex items-center gap-1">nodes <input type="number" min="0" max="4" value={simNodes} onChange={e => setSimNodes(Number(e.target.value))} className="w-12 bg-terminal-black border border-terminal-border px-1" /></label>
              <select value={sim.scenario} onChange={e => api.simScenario(e.target.value)} className="bg-terminal-black border border-terminal-border px-1 py-0.5">
                {sim.scenarios.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              {!sim.running
                ? <Button size="sm" onClick={() => api.simStart(simNodes, sim.scenario)}><Play className="w-3 h-3 mr-1" /> START</Button>
                : <Button size="sm" variant="danger" onClick={() => api.simStop()}><Square className="w-3 h-3 mr-1" /> STOP</Button>}
            </div>
            <Separator variant="dots" />
            <div className="text-[10px] text-terminal-muted mb-1">One-off events at the selected node ({selected ? selected.name : '—'}):</div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="warning" onClick={() => api.simIntruder(selectedId, 'HUMAN')}><UserRoundSearch className="w-3 h-3 mr-1" /> WALKER</Button>
              <Button size="sm" variant="warning" onClick={() => api.simIntruder(selectedId, 'VEHICLE')}><Car className="w-3 h-3 mr-1" /> VEHICLE</Button>
              <Button size="sm" variant="outline" disabled={!selected || !selected.simulated} onClick={() => api.simTamper(selectedId).catch(e => alert(e.message))} title="only for simulated nodes — tilt a real node instead"><ShieldAlert className="w-3 h-3 mr-1" /> TAMPER</Button>
            </div>
          </Card>

          <Card className="!h-auto" title="SERVER">
            {!health ? <div className="text-terminal-muted text-[11px]">connecting…</div> : (
              <dl className="kv">
                <dt>host</dt><dd>{health.host} · {health.platform}</dd>
                <dt>node.js</dt><dd>{health.node}</dd>
                <dt>uptime</dt><dd>{Math.round(health.uptimeS / 60)} min · {health.memMB} MB</dd>
                <dt>dashboards</dt><dd>{health.dashboards}</dd>
                <dt>vibration model</dt><dd>{health.ml.vibrationModel} · {health.ml.trees} trees · {health.ml.trainedAt || '?'}</dd>
                <dt>thresholds</dt><dd>alert {health.thresholds.alert} · critical {health.thresholds.critical} · loiter {health.thresholds.loiterS}s</dd>
                <dt>pre-arm handoff</dt><dd>{health.thresholds.prearm ? 'on' : 'off'}</dd>
              </dl>
            )}
            <Separator variant="dots" />
            <div className="text-[10px] text-terminal-muted space-y-1">
              <div>Point a new node at this server: <code className="text-terminal-green">cfg server http://&lt;this-host&gt;:8787</code> over its serial console.</div>
              <div>Keyboard: 1–5 pages · A ack all · M mute · W wall mode · G ground truth · E place mode · Esc leave wall mode.</div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Setup;
