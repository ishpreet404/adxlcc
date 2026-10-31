import React, { useEffect, useState } from 'react';
import { Trash2, Save, PenTool, Check, X, Send, Siren, Map as MapIcon, Cpu, Shapes, Lock, Ruler, Bell, Server, FlaskConical, Smartphone, Keyboard, Undo2 } from 'lucide-react';
import useStore from '../store/useStore';
import api from '../services/api';
import { Card, Button, Input, Select, Tag, Spinner } from '../components';
import SiteMap from '../components/map/SiteMap';
import ArmingControl from '../components/layout/ArmingControl';
import { SimToggle, InstallButton } from '../components/layout/ShellWidgets';
import { NAV } from '../components/layout/nav';
import { zoneHex, titleCase } from '../lib/format';
import { useInstall } from '../lib/pwa';

const useErrorToast = () => {
  const toast = useStore(s => s.toast);
  return (title) => (e) => toast({ kind: 'ERR', severity: 'HIGH', title, message: e.message });
};

const fieldCls = 'h-10 lg:h-8 bg-terminal-black border border-terminal-border rounded-md px-2 text-[13px] lg:text-xs text-gray-100 focus:border-terminal-cyan/70 outline-none';

const NodeRow = ({ node }) => {
  const fail = useErrorToast();
  const toast = useStore(s => s.toast);
  const [form, setForm] = useState({ name: node.name, x: node.x, y: node.y, heading: node.heading, spacing: node.spacing });
  useEffect(() => { setForm({ name: node.name, x: node.x, y: node.y, heading: node.heading, spacing: node.spacing }); }, [node.name, node.x, node.y, node.heading, node.spacing]);
  const save = () => api.updateNode(node.id, { ...form, x: Number(form.x), y: Number(form.y), heading: Number(form.heading), spacing: Number(form.spacing) })
    .then(() => toast({ kind: 'CMD', severity: 'INFO', title: 'Node saved', message: form.name, ttl: 2500 })).catch(fail('Save failed'));
  const remove = () => { if (window.confirm(`Remove ${node.id} from the site?`)) api.removeNode(node.id).catch(fail('Remove failed')); };
  const field = (k, w = 'w-20', step = '0.1', label) => (
    <input value={form[k]} type={k === 'name' ? 'text' : 'number'} step={step} aria-label={`${label} for ${node.id}`} onChange={e => setForm({ ...form, [k]: e.target.value })} className={`${w} ${fieldCls}`} />
  );
  return (
    <tr className="border-t border-terminal-border/70">
      <td className="py-2 pr-3 whitespace-nowrap">
        <div className="flex items-center gap-1.5"><span className="num font-medium text-gray-100">{node.id}</span>{node.simulated && <Tag tone="violet">SIM</Tag>}</div>
        <div className="text-terminal-muted text-[11px]">{titleCase(node.status)}</div>
      </td>
      <td className="py-2 pr-3">{field('name', 'w-36', undefined, 'Name')}</td>
      <td className="py-2 pr-3">{field('x', 'w-20', '0.1', 'X position')}</td>
      <td className="py-2 pr-3">{field('y', 'w-20', '0.1', 'Y position')}</td>
      <td className="py-2 pr-3">{field('heading', 'w-20', '1', 'Heading')}</td>
      <td className="py-2 pr-3">{field('spacing', 'w-20', '0.1', 'Probe spacing')}</td>
      <td className="py-2">
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={save} aria-label={`Save ${node.id}`} title="Save"><Save className="w-3.5 h-3.5" aria-hidden="true" /></Button>
          {(!node.simulated || node.status !== 'ONLINE') && <Button size="sm" variant="danger" onClick={remove} aria-label={`Remove ${node.id}`} title="Remove"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></Button>}
        </div>
      </td>
    </tr>
  );
};

const ZoneEditor = () => {
  const site = useStore(s => s.site);
  const zoneDraft = useStore(s => s.zoneDraft);
  const setZoneDraft = useStore(s => s.setZoneDraft);
  const setEditMap = useStore(s => s.setEditMap);
  const fail = useErrorToast();
  const [name, setName] = useState('Restricted area');
  const [type, setType] = useState('restricted');
  const start = () => { setEditMap(false); setZoneDraft({ points: [] }); };
  const finish = () => {
    if (!zoneDraft || zoneDraft.points.length < 3) return;
    api.createZone({ name, type, points: zoneDraft.points }).then(() => { setZoneDraft(null); setEditMap(true); }).catch(fail('Zone not saved'));
  };
  const cancel = () => { setZoneDraft(null); setEditMap(true); };
  return (
    <div className="space-y-3 text-[13px]">
      <p className="text-terminal-muted text-[12px]">
        Zones change what an alert means: <span className="text-red-300">restricted</span> escalates anything inside to critical, <span className="text-amber-300">watch</span> tags the alert, <span className="text-green-300">allowed</span> lets vehicles pass (driveways).
      </p>
      {!zoneDraft ? (
        <div className="flex gap-2 items-center flex-wrap">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Zone name" aria-label="Zone name" className="flex-1 min-w-[160px]" />
          <Select value={type} onChange={e => setType(e.target.value)} aria-label="Zone type" className="!h-10">
            <option value="restricted">Restricted</option><option value="watch">Watch</option><option value="allowed">Allowed</option>
          </Select>
          <Button size="md" variant="primary" onClick={start}><PenTool className="w-4 h-4" aria-hidden="true" />Draw on map</Button>
        </div>
      ) : (
        <div className="flex gap-2 items-center flex-wrap rounded-lg border border-terminal-amber/40 bg-terminal-amber/[0.05] p-3">
          <span className="text-amber-200 flex-1 min-w-[180px]">Click the map to add corners ({zoneDraft.points.length} of at least 3)</span>
          <Button size="sm" variant="primary" onClick={finish} disabled={zoneDraft.points.length < 3}><Check className="w-3.5 h-3.5" aria-hidden="true" />Save zone</Button>
          <Button size="sm" variant="ghost" onClick={() => setZoneDraft({ points: zoneDraft.points.slice(0, -1) })} disabled={!zoneDraft.points.length}><Undo2 className="w-3.5 h-3.5" aria-hidden="true" />Undo</Button>
          <Button size="sm" variant="ghost" onClick={cancel}><X className="w-3.5 h-3.5" aria-hidden="true" />Cancel</Button>
        </div>
      )}
      {(site.zones || []).length > 0 && (
        <ul className="divide-y divide-terminal-border/70 rounded-lg border border-terminal-border">
          {site.zones.map(z => (
            <li key={z.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: zoneHex(z.type) }} aria-hidden="true" />
              <span className="flex-1 min-w-0 truncate text-gray-200">{z.name}</span>
              <span className="text-terminal-muted text-[12px] hidden sm:inline">{z.points.length} points</span>
              <Select value={z.type} onChange={e => api.updateZone(z.id, { type: e.target.value }).catch(fail('Zone not updated'))} aria-label={`Type of zone ${z.name}`}>
                <option value="restricted">Restricted</option><option value="watch">Watch</option><option value="allowed">Allowed</option>
              </Select>
              <Button size="sm" variant="danger" onClick={() => api.removeZone(z.id).catch(fail('Zone not removed'))} aria-label={`Delete zone ${z.name}`}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const ArmingPanel = () => {
  const arming = useStore(s => s.arming);
  const toast = useStore(s => s.toast);
  const fail = useErrorToast();
  const [sched, setSched] = useState(arming.schedule);
  useEffect(() => setSched(arming.schedule), [arming.schedule]);
  return (
    <div className="space-y-3 text-[13px]">
      <ArmingControl full />
      <p className="text-terminal-muted text-[12px]">Test raises alerts flagged as test (no siren, no notifications) — use it for walk tests. Disarmed only logs detections; tamper alerts always fire.</p>
      <div className="pt-3 border-t border-terminal-border space-y-3">
        <label className="flex items-center gap-2 text-gray-200"><input type="checkbox" className="w-4 h-4 accent-sky-500" checked={sched.enabled} onChange={e => setSched({ ...sched, enabled: e.target.checked })} /> Daily schedule</label>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-2"><span className="text-terminal-muted">Arm at</span><input type="time" value={sched.armAt} onChange={e => setSched({ ...sched, armAt: e.target.value })} className={fieldCls} /></label>
          <label className="flex items-center gap-2"><span className="text-terminal-muted">Disarm at</span><input type="time" value={sched.disarmAt} onChange={e => setSched({ ...sched, disarmAt: e.target.value })} className={fieldCls} /></label>
          <Button size="sm" variant="outline" onClick={() => api.setSchedule(sched).then(() => toast({ kind: 'CMD', severity: 'INFO', title: 'Schedule saved', ttl: 2500 })).catch(fail('Schedule not saved'))}><Save className="w-3.5 h-3.5" aria-hidden="true" />Save</Button>
        </div>
      </div>
    </div>
  );
};

/** Telegram / webhook / siren status, with self-service Telegram setup (token + chat discovery). */
const NotifyPanel = ({ notify, toast }) => {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const fail = useErrorToast();
  const chats = notify.telegramChats || [];
  const recent = (notify.recent || []).slice(-4).reverse();
  const run = async (what, fn, okMsg) => {
    setBusy(what);
    try {
      const r = await fn();
      toast({ kind: r && r.ok === false ? 'ERR' : 'CMD', severity: r && r.ok === false ? 'HIGH' : 'INFO', title: what, message: (r && r.error) || (typeof okMsg === 'function' ? okMsg(r) : okMsg), ttl: 5000 });
    } catch (e) { toast({ kind: 'ERR', severity: 'HIGH', title: what, message: e.message }); }
    setBusy('');
  };
  const tgState = !notify.telegramToken ? ['No token', ''] : notify.telegramError ? [`Token rejected: ${notify.telegramError}`, 'text-red-300'] : !chats.length ? ['Bot OK · waiting for your chat', 'text-amber-300'] : [`Ready · ${chats.length} chat${chats.length > 1 ? 's' : ''}`, 'text-green-300'];
  return (
    <div className="space-y-4 text-[13px]">
      <dl className="kv">
        <dt>Telegram</dt><dd className={tgState[1]}>{tgState[0]}{notify.telegramBot && <> · <a className="text-sky-300 hover:underline" href={`https://t.me/${notify.telegramBot}`} target="_blank" rel="noreferrer">@{notify.telegramBot}</a></>}</dd>
        <dt>Webhook</dt><dd className={notify.webhook ? 'text-green-300' : ''}>{notify.webhook ? 'Configured' : 'Set WEBHOOK_URL'}</dd>
        <dt>Pi siren GPIO</dt><dd className={notify.siren ? 'text-green-300' : ''}>{notify.siren || 'Set SIREN_GPIO'}</dd>
      </dl>

      <div className="rounded-lg border border-terminal-border p-3 space-y-3">
        <div className="text-[12px] font-medium text-gray-300">Telegram setup</div>
        <ol className="text-[12px] text-terminal-muted list-decimal ml-4 space-y-1">
          <li>Create a bot with <span className="text-sky-300">@BotFather</span> and paste its token below (or set <code>TELEGRAM_BOT_TOKEN</code> in <code>server/.env</code>).</li>
          <li>Open the bot in Telegram and press <b className="text-gray-300">Start</b> (a group works too: add the bot and say hi).</li>
          <li>Press <b className="text-gray-300">Find chats</b>, then <b className="text-gray-300">Send test</b>. Every alert now goes to those chats.</li>
        </ol>
        <div className="flex gap-2">
          <Input type="password" autoComplete="off" aria-label="Telegram bot token" placeholder={notify.telegramToken ? `Token ${notify.telegramToken} (${notify.telegramTokenSource})` : '123456:ABC… bot token'} value={token} onChange={e => setToken(e.target.value)} className="flex-1 min-w-0" />
          <Button size="md" variant="outline" disabled={!token.trim() || busy === 'Save token'} onClick={() => run('Save token', () => api.telegramConfigure({ token: token.trim() }).then(r => { setToken(''); return r; }), r => (r.notify.telegramBot ? `Bot @${r.notify.telegramBot} accepted` : `Rejected: ${r.notify.telegramError}`))}>
            <Save className="w-4 h-4" aria-hidden="true" />Save
          </Button>
        </div>
        {chats.length > 0 && (
          <ul className="space-y-1">
            {chats.map(c => (
              <li key={c.id} className="flex items-center gap-2 text-[12px]">
                <Check className="w-3.5 h-3.5 text-green-400" aria-hidden="true" />
                <span className="font-medium text-gray-200">{c.name}</span><span className="text-terminal-muted num">{c.type} · {c.id}</span>
                {c.type !== 'env' && <button type="button" className="ml-auto w-8 h-8 inline-flex items-center justify-center rounded-md text-terminal-muted hover:text-red-300 hover:bg-white/5" aria-label={`Remove chat ${c.name}`} onClick={() => api.telegramRemoveChat(c.id).catch(fail('Chat not removed'))}><X className="w-3.5 h-3.5" aria-hidden="true" /></button>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" disabled={!notify.telegramToken || busy === 'Find chats'} onClick={() => run('Find chats', api.telegramDiscover, r => (r.chats.length ? `${r.chats.length} chat(s): ${r.chats.map(c => c.name).join(', ')}` : 'None yet — press Start in the bot first, then try again'))}>
            {busy === 'Find chats' && <Spinner className="w-3.5 h-3.5" />}Find chats
          </Button>
          <Button size="sm" variant="outline" disabled={busy === 'Test notification'} onClick={() => run('Test notification', api.notifyTest, r => { const last = (r.notify.recent || []).slice(-1)[0]; return r.sent ? (last ? `${last.channel}: ${last.ok ? 'OK' : 'failed'} — ${last.detail}` : 'Sent') : 'Nothing configured'; })}>
            <Send className="w-3.5 h-3.5" aria-hidden="true" />Send test
          </Button>
          <Button size="sm" variant="danger" onClick={() => api.siren(true, 3).catch(fail('Siren failed'))} disabled={!notify.siren}><Siren className="w-3.5 h-3.5" aria-hidden="true" />Pi siren 3 s</Button>
        </div>
      </div>

      {recent.length > 0 && (
        <div>
          <div className="text-[12px] font-medium text-gray-400 mb-1">Recent deliveries</div>
          {recent.map((r, i) => (
            <div key={i} className="text-[12px] flex gap-2 min-w-0">
              <span className="text-terminal-muted num flex-shrink-0">{new Date(r.t).toLocaleTimeString([], { hour12: false })}</span>
              <span className={`flex-shrink-0 ${r.ok ? 'text-green-300' : 'text-red-300'}`}>{r.channel} {r.ok ? 'OK' : 'failed'}</span>
              <span className="text-terminal-muted truncate">{r.detail}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[12px] text-terminal-muted">Webhook and siren are configured in <code>server/.env</code>; Telegram can also be set up here.</p>
    </div>
  );
};

const InstallCard = () => {
  const { standalone } = useInstall();
  return (
    <Card title="Install as an app" subtitle="Home-screen app with offline shell" icon={Smartphone}>
      {standalone
        ? <p className="text-[13px] text-green-300 flex items-center gap-2"><Check className="w-4 h-4" aria-hidden="true" />Running as an installed app.</p>
        : (
          <div className="space-y-3">
            <p className="text-[13px] text-terminal-muted">Install the dashboard on a phone or desktop for a full-screen, app-like console. Live data always comes from the server.</p>
            <InstallButton />
          </div>
        )}
    </Card>
  );
};

export const Setup = () => {
  const nodes = useStore(s => s.nodes);
  const site = useStore(s => s.site);
  const notify = useStore(s => s.notify);
  const setEditMap = useStore(s => s.setEditMap);
  const setZoneDraft = useStore(s => s.setZoneDraft);
  const toast = useStore(s => s.toast);
  const fail = useErrorToast();
  const [dims, setDims] = useState({ width: site.width, height: site.height, name: site.name });
  const [health, setHealth] = useState(null);

  useEffect(() => { setDims({ width: site.width, height: site.height, name: site.name }); }, [site.width, site.height, site.name]);
  useEffect(() => { setEditMap(true); return () => { setEditMap(false); setZoneDraft(null); }; }, [setEditMap, setZoneDraft]);
  useEffect(() => {
    const load = () => api.health().then(setHealth).catch(() => {});
    load();
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') load(); }, 5000);
    return () => clearInterval(t);
  }, []);

  const list = Object.values(nodes).sort((a, b) => a.id.localeCompare(b.id));

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-terminal-muted max-w-3xl">
        Place nodes where they physically stand, draw zones, set arming and wire notifications. Heading is the direction the radar faces (0° east, 90° north). Probe A is on the node's left, probe B on its right.
      </p>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-7 space-y-4 min-w-0">
          <Card title="Site map" subtitle="Drag nodes to place them · draw zones below" icon={MapIcon}><div className="h-[320px] sm:h-[460px] rounded-lg overflow-hidden"><SiteMap /></div></Card>
          <Card title="Node placement" subtitle={`${list.length} node${list.length === 1 ? '' : 's'}`} icon={Cpu}>
            {list.length ? (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-[12px] min-w-[640px]">
                  <thead><tr className="text-terminal-muted text-left"><th scope="col" className="font-medium pb-2 pr-3">Node</th><th scope="col" className="font-medium pb-2 pr-3">Name</th><th scope="col" className="font-medium pb-2 pr-3">X (m)</th><th scope="col" className="font-medium pb-2 pr-3">Y (m)</th><th scope="col" className="font-medium pb-2 pr-3">Heading (°)</th><th scope="col" className="font-medium pb-2 pr-3">Spacing (m)</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>{list.map(n => <NodeRow key={n.id} node={n} />)}</tbody>
                </table>
              </div>
            ) : <div className="text-terminal-muted text-[13px]">No nodes yet.</div>}
          </Card>
          <Card title="Zones" subtitle={`${(site.zones || []).length} defined`} icon={Shapes}><ZoneEditor /></Card>
        </div>
        <div className="xl:col-span-5 space-y-4 min-w-0">
          <Card title="Arming" icon={Lock}><ArmingPanel /></Card>
          <Card title="Demo data" subtitle="Simulator nodes are hidden by default" icon={FlaskConical}>
            <SimToggle />
            <p className="text-[12px] text-terminal-muted mt-3">When on, simulated nodes, alerts and events appear everywhere with a <Tag tone="violet">SIM</Tag> badge. Real hardware is always shown. Saved in this browser.</p>
          </Card>
          <Card title="Site dimensions" icon={Ruler}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px]">
              <label className="space-y-1"><div className="text-terminal-muted">Name</div><Input value={dims.name} onChange={e => setDims({ ...dims, name: e.target.value })} /></label>
              <label className="space-y-1"><div className="text-terminal-muted">Width (m)</div><Input type="number" inputMode="decimal" value={dims.width} onChange={e => setDims({ ...dims, width: e.target.value })} /></label>
              <label className="space-y-1"><div className="text-terminal-muted">Height (m)</div><Input type="number" inputMode="decimal" value={dims.height} onChange={e => setDims({ ...dims, height: e.target.value })} /></label>
            </div>
            <Button size="sm" variant="outline" className="mt-3 self-start" onClick={() => api.updateSite({ ...dims, width: Number(dims.width), height: Number(dims.height) }).then(() => toast({ kind: 'CMD', severity: 'INFO', title: 'Site saved', ttl: 2500 })).catch(fail('Site not saved'))}>
              <Save className="w-3.5 h-3.5" aria-hidden="true" />Save site
            </Button>
          </Card>

          <Card title="Notifications" icon={Bell}><NotifyPanel notify={notify} toast={toast} /></Card>
          <InstallCard />

          <Card title="Server" icon={Server}>
            {!health ? <div className="text-terminal-muted text-[13px] flex items-center gap-2"><Spinner className="w-3.5 h-3.5" />Connecting…</div> : (
              <dl className="kv">
                <dt>Host</dt><dd>{health.host} · {health.platform}</dd>
                <dt>Node.js</dt><dd className="num">{health.node}</dd>
                <dt>Uptime</dt><dd>{Math.round(health.uptimeS / 60).toLocaleString()} min · {health.memMB} MB</dd>
                <dt>Dashboards</dt><dd>{health.dashboards}</dd>
                {health.ml && <><dt>Vibration model</dt><dd>{health.ml.vibrationModel} · {health.ml.trees} trees · {health.ml.trainedAt || '?'}</dd></>}
                {health.thresholds && <><dt>Thresholds</dt><dd>alert {health.thresholds.alert} · critical {health.thresholds.critical} · loiter {health.thresholds.loiterS} s</dd>
                <dt>Pre-arm handoff</dt><dd>{health.thresholds.prearm ? 'On' : 'Off'}</dd></>}
              </dl>
            )}
            <div className="mt-3 pt-3 border-t border-terminal-border text-[12px] text-terminal-muted">
              Point a new node at this server over its serial console: <code className="text-green-300 break-all">cfg server http://&lt;this-host&gt;:8787</code>
            </div>
          </Card>

          <Card title="Keyboard shortcuts" icon={Keyboard}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
              {NAV.map(n => <React.Fragment key={n.id}><dt><kbd className="num px-1.5 py-0.5 rounded border border-terminal-border bg-terminal-black text-gray-200">{n.key}</kbd></dt><dd className="text-gray-300">{n.label}</dd></React.Fragment>)}
              {[['A', 'Acknowledge all alerts'], ['M', 'Mute / unmute alarm sound'], ['W', 'Wall display mode'], ['G', 'Simulator ground truth'], ['E', 'Place-nodes mode'], ['Esc', 'Close menu / leave wall mode']].map(([k, d]) => (
                <React.Fragment key={k}><dt><kbd className="num px-1.5 py-0.5 rounded border border-terminal-border bg-terminal-black text-gray-200">{k}</kbd></dt><dd className="text-gray-300">{d}</dd></React.Fragment>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Setup;
