import React, { useMemo } from 'react';
import { Database, RefreshCw, CircleAlert, Layers, Table2, Clock3 } from 'lucide-react';
import useStore from '../../store/useStore';
import api from '../../services/api';
import { usePolling, useNow } from '../../lib/hooks';
import { Card } from '../Card';
import { EmptyState, Spinner } from '../ui/States';
import { fmtInt, fmtNum, fmtBytes, relTime, span, toMs, clockShort, titleCase, severityHex } from '../../lib/format';
import { ActivityChart, AlertTimeline, ChartPanel, DataTable, Legend, SERIES, timelineSeverities } from './charts';

const REFRESH_MS = 15000;

const Kpi = ({ label, value, sub }) => (
  <div className="rounded-xl border border-terminal-border bg-terminal-black/40 px-4 py-3 min-w-0">
    <div className="text-[12px] text-terminal-muted truncate">{label}</div>
    <div className="num text-lg sm:text-xl font-semibold text-gray-50 mt-1 truncate" title={typeof value === 'string' ? value : undefined}>{value}</div>
    {sub && <div className="text-[11px] text-terminal-muted truncate mt-0.5">{sub}</div>}
  </div>
);

const KpiSkeleton = () => (
  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3" aria-busy="true" aria-label="Loading TigerData statistics">
    {Array.from({ length: 6 }, (_, i) => <div key={i} className="rounded-xl border border-terminal-border px-4 py-3"><div className="skeleton h-3 w-2/3" /><div className="skeleton h-5 w-1/2 mt-2" /></div>)}
  </div>
);

/** TigerData (TimescaleDB) usage + analytics, refreshed every 15 s. */
export const TigerAnalytics = () => {
  const rawNodes = useStore(s => s.raw.nodes);
  const show = useStore(s => s.showSimulated);
  const threshold = useStore(s => s.thresholds.alert);
  useNow(REFRESH_MS);

  const stats = usePolling(() => api.tigerStats().then(d => ({ ...d, _at: Date.now() })), REFRESH_MS);
  const act = usePolling(() => api.tigerActivity(60), REFRESH_MS);
  const tl = usePolling(() => api.tigerAlertsTimeline(6), REFRESH_MS);
  const reload = () => { stats.reload(); act.reload(); tl.reload(); };

  const s = stats.data;
  const disabled = !!s && s.enabled === false;
  const failed = !!s && s.ok === false && !disabled;
  const connecting = !!s && !failed && !disabled && s.ready === false;
  const nameOf = (id) => (rawNodes[id] && rawNodes[id].name) || id;

  const activity = useMemo(() => {
    const rows = act.data && act.data.ok !== false && Array.isArray(act.data.series) ? act.data.series : [];
    const simIds = new Set(rows.map(r => r.node_id).filter(id => rawNodes[id] && rawNodes[id].simulated));
    return { rows: show ? rows : rows.filter(r => !simIds.has(r.node_id)), hidden: show ? 0 : simIds.size };
  }, [act.data, rawNodes, show]);
  const actNodes = useMemo(() => [...new Set(activity.rows.map(r => r.node_id))].sort(), [activity.rows]);
  const tlBuckets = tl.data && tl.data.ok !== false && Array.isArray(tl.data.buckets) ? tl.data.buckets : [];
  const tlSevs = useMemo(() => timelineSeverities(tlBuckets), [tlBuckets]);
  const tlRows = useMemo(() => {
    const by = new Map();
    for (const b of tlBuckets) {
      const t = toMs(b.bucket);
      const r = by.get(t) || { t, total: 0 };
      const sev = String(b.severity || 'INFO').toUpperCase();
      r[sev] = (r[sev] || 0) + Number(b.count || 0);
      r.total += Number(b.count || 0);
      by.set(t, r);
    }
    return [...by.values()].sort((a, b) => b.t - a.t);
  }, [tlBuckets]);

  const hypertables = s && Array.isArray(s.hypertables) && s.hypertables.length ? s.hypertables : ['telemetry', 'alerts'];
  const cagg = (s && s.continuousAggregate) || 'telemetry_1s';
  const oldest = s ? toMs(s.oldest) : null;
  const newest = s ? toMs(s.newest) : null;

  let body;
  if (stats.loading && !s) body = <KpiSkeleton />;
  else if (disabled) {
    body = (
      <EmptyState icon={Database} title="TigerData is not connected">
        Set <code>DATABASE_URL</code> in <code>server/.env</code> to stream every telemetry row and alert into TimescaleDB hypertables.
        The dashboard keeps working from the server's local store in the meantime.
      </EmptyState>
    );
  } else if (failed) {
    body = (
      <EmptyState icon={CircleAlert} tone="error" title="TigerData analytics unavailable"
        action={<button type="button" onClick={reload} className="h-9 px-3 rounded-lg border border-terminal-border text-[13px] text-gray-200 hover:bg-white/5">Retry</button>}>
        {s.error || 'The server did not return statistics.'}
      </EmptyState>
    );
  } else {
    const actErr = act.data && act.data.ok === false ? act.data.error : null;
    const tlErr = tl.data && tl.data.ok === false ? tl.data.error : null;
    body = (
      <div className="space-y-4">
        {connecting && (
          <div className="rounded-lg border border-terminal-amber/30 bg-terminal-amber/[0.06] px-3 py-2 text-[13px] text-amber-200 flex items-center gap-2">
            <Spinner className="w-3.5 h-3.5" /> Connecting to TigerData — hypertables are being prepared.
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <Kpi label="Telemetry rows" value={fmtInt(s.telemetryRows)} sub={`Hypertable ${hypertables[0] || 'telemetry'}`} />
          <Kpi label="Alert rows" value={fmtInt(s.alertRows)} sub={`Hypertable ${hypertables[1] || 'alerts'}`} />
          <Kpi label="Ingest rate" value={fmtNum(s.ingestPerMin, 1)} sub="rows per minute" />
          <Kpi label="Storage" value={fmtBytes(s.storageBytes)} sub={`${fmtInt(s.chunks)} chunks`} />
          <Kpi label="Aggregate rows" value={fmtInt(s.caggRows)} sub={`Continuous agg. ${cagg}`} />
          <Kpi label="Data span" value={oldest && newest ? span(newest - oldest) : '—'} sub={oldest ? `since ${new Date(oldest).toLocaleDateString()} ${clockShort(oldest)}` : 'no rows yet'} />
        </div>

        <div className="flex flex-wrap gap-2 text-[12px]">
          {hypertables.map(h => (
            <span key={h} className="inline-flex items-center gap-1.5 rounded-md border border-terminal-border px-2 py-1 text-gray-300"><Table2 className="w-3.5 h-3.5 text-green-400" aria-hidden="true" />Hypertable <code>{h}</code></span>
          ))}
          <span className="inline-flex items-center gap-1.5 rounded-md border border-terminal-border px-2 py-1 text-gray-300"><Layers className="w-3.5 h-3.5 text-green-400" aria-hidden="true" />Continuous aggregate <code>{cagg}</code></span>
          {newest && <span className="inline-flex items-center gap-1.5 rounded-md border border-terminal-border px-2 py-1 text-gray-300"><Clock3 className="w-3.5 h-3.5 text-terminal-muted" aria-hidden="true" />Latest row {relTime(newest)}</span>}
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <ChartPanel
            title="Telemetry activity · last 60 min"
            subtitle={actNodes.length === 1 ? `Peak intrusion probability per minute · ${nameOf(actNodes[0])}` : 'Peak intrusion probability per node, per minute'}
            legend={<Legend items={[...(actNodes.length >= 2 ? actNodes.map((id, i) => ({ key: id, label: nameOf(id), color: SERIES[i % SERIES.length] })) : []), { key: 'thr', label: `Alert threshold ${Math.round(threshold * 100)}%`, color: '#8b97a8', dashed: true }]} />}
            empty={act.loading && !act.data ? <div className="skeleton h-56" /> : actErr ? <EmptyState compact icon={CircleAlert} tone="error" title="Activity query failed">{actErr}</EmptyState> : !activity.rows.length ? (
              <EmptyState compact icon={Database} title="No telemetry in the last hour">
                Rows appear here as soon as nodes report.{activity.hidden > 0 && ` ${activity.hidden} simulated node${activity.hidden > 1 ? 's are' : ' is'} hidden.`}
              </EmptyState>
            ) : null}
            note={activity.rows.length ? `Per-minute buckets from TigerData${activity.hidden ? ` · ${activity.hidden} simulated node${activity.hidden > 1 ? 's' : ''} hidden` : ''}. Bars: telemetry samples ingested per minute.` : null}
            table={(
              <DataTable
                columns={[
                  { key: 't', label: 'Minute', render: r => <span className="num">{clockShort(toMs(r.bucket))}</span> },
                  { key: 'node', label: 'Node', render: r => nameOf(r.node_id) },
                  { key: 'p', label: 'Peak p', align: 'right', render: r => `${Math.round(Number(r.max_p || 0) * 100)}%` },
                  { key: 'rms', label: 'Avg RMS (g)', align: 'right', render: r => Number(r.avg_rms || 0).toFixed(4) },
                  { key: 'n', label: 'Samples', align: 'right', render: r => fmtInt(r.samples) }
                ]}
                rows={[...activity.rows].sort((a, b) => (toMs(b.bucket) || 0) - (toMs(a.bucket) || 0))}
              />
            )}>
            <ActivityChart rows={activity.rows} minutes={60} nameOf={nameOf} threshold={threshold} />
          </ChartPanel>

          <ChartPanel
            title="Alerts by severity · last 6 h"
            subtitle="Alert rows per time bucket, from the alerts hypertable"
            legend={tlSevs.length ? <Legend items={tlSevs.map(sv => ({ key: sv, label: titleCase(sv), color: severityHex(sv) }))} /> : null}
            empty={tl.loading && !tl.data ? <div className="skeleton h-56" /> : tlErr ? <EmptyState compact icon={CircleAlert} tone="error" title="Timeline query failed">{tlErr}</EmptyState> : !tlBuckets.length ? (
              <EmptyState compact icon={Database} title="No alerts in the last 6 hours">Quiet perimeter — nothing has been recorded.</EmptyState>
            ) : null}
            table={(
              <DataTable
                columns={[
                  { key: 't', label: 'Bucket', render: r => <span className="num">{clockShort(r.t)}</span> },
                  ...tlSevs.map(sv => ({ key: sv, label: titleCase(sv), align: 'right', render: r => fmtInt(r[sv] || 0) })),
                  { key: 'total', label: 'Total', align: 'right', render: r => fmtInt(r.total) }
                ]}
                rows={tlRows}
              />
            )}>
            <AlertTimeline buckets={tlBuckets} hours={6} />
          </ChartPanel>
        </div>
      </div>
    );
  }

  return (
    <Card title="TigerData Analytics" subtitle="Powered by TigerData · hypertables + continuous aggregates" icon={Database}
      headerAction={(
        <>
          {s && s._at && <span className="hidden sm:inline text-[11px] text-terminal-muted">Updated {relTime(s._at)}</span>}
          <button type="button" onClick={reload} aria-label="Refresh TigerData analytics" title="Refresh (auto every 15 s)"
            className="w-8 h-8 inline-flex items-center justify-center rounded-md text-terminal-muted hover:text-gray-100 hover:bg-white/5">
            <RefreshCw className={`w-4 h-4 ${stats.loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </>
      )}>
      {body}
    </Card>
  );
};

export default TigerAnalytics;
