import React from 'react';
import { Sparkles, Database, MessageSquareText } from 'lucide-react';
import { Card } from '../components';
import { BriefingFeed } from '../components/ai/BriefingFeed';
import SituationReport from '../components/ai/SituationReport';
import AskPanel from '../components/ai/AskPanel';
import TigerAnalytics from '../components/tiger/TigerAnalytics';
import { useAiStatus } from '../components/ai/useAiStatus';
import { fmtInt } from '../lib/format';
import api from '../services/api';

const SponsorCard = ({ icon: Icon, name, tone, ok, state, detail, uses, loading }) => (
  <div className="rounded-xl border border-terminal-border bg-terminal-dark shadow-card px-4 py-3.5 flex items-start gap-3 min-w-0">
    <span className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ring-1 ring-inset ${tone}`}><Icon className="w-5 h-5" aria-hidden="true" /></span>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[14px] font-semibold text-gray-50">{name}</span>
        {loading ? <span className="skeleton h-4 w-20" /> : (
          <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${ok ? 'bg-terminal-green/10 text-green-300 ring-terminal-green/25' : 'bg-terminal-red/10 text-red-300 ring-terminal-red/25'}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />{state}
          </span>
        )}
      </div>
      {detail && <div className="text-[12px] text-gray-300 mt-0.5 truncate">{detail}</div>}
      <div className="text-[12px] text-terminal-muted mt-0.5">{uses}</div>
    </div>
  </div>
);

const SectionHeading = ({ id, icon: Icon, title, children }) => (
  <div className="flex items-start gap-2.5">
    <Icon className="w-5 h-5 text-terminal-muted mt-0.5 flex-shrink-0" aria-hidden="true" />
    <div className="min-w-0">
      <h2 id={id} className="text-[15px] font-semibold text-gray-50">{title}</h2>
      <p className="text-[13px] text-terminal-muted mt-0.5 max-w-3xl">{children}</p>
    </div>
  </div>
);

/** Sponsor-track showcase: Gemini (narration, reports, text-to-SQL) and TigerData (time-series storage + analytics). */
export const Intelligence = () => {
  const status = useAiStatus();
  const [stored, setStored] = React.useState(null);   // total rows in the hypertables (not just this session)
  React.useEffect(() => {
    let alive = true;
    const load = () => api.tigerStats().then(r => { if (alive && r && r.ok && r.ready) setStored(r); });
    load(); const id = setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const loading = !status;
  const gemini = status && status.gemini;
  const tiger = status && status.tiger;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SponsorCard icon={Sparkles} name="Google Gemini" tone="bg-terminal-violet/10 text-violet-300 ring-terminal-violet/30" loading={loading}
          ok={!!(gemini && gemini.enabled)} state={gemini && gemini.enabled ? 'Enabled' : status && status.error ? 'Unreachable' : 'Not configured'}
          detail={gemini && gemini.model ? <span className="num">{gemini.model}</span> : null}
          uses="Alert narration · situation reports · natural-language queries" />
        <SponsorCard icon={Database} name="TigerData" tone="bg-terminal-green/10 text-green-300 ring-terminal-green/30" loading={loading}
          ok={!!(tiger && tiger.ready)} state={tiger && tiger.ready ? 'Connected' : status && status.error ? 'Unreachable' : 'Not connected'}
          detail={stored ? <><span className="num">{fmtInt(Number(stored.telemetryRows) + Number(stored.alertRows || 0))}</span> rows stored · <span className="num">{fmtInt(stored.ingestPerMin)}</span>/min</> : tiger && tiger.writes !== undefined ? <><span className="num">{fmtInt(tiger.writes)}</span> rows written</> : null}
          uses="Hypertables for telemetry and alerts · continuous aggregates" />
      </div>

      <section aria-labelledby="gemini-heading" className="space-y-4">
        <SectionHeading id="gemini-heading" icon={Sparkles} title="Gemini AI">
          Every alert is narrated in plain language as it happens. Ask for a situation report of the last hour, or ask questions about the sensor history — Gemini writes a read-only SQL query that runs on TigerData.
        </SectionHeading>
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
          <div className="xl:col-span-7 min-w-0"><BriefingFeed /></div>
          <div className="xl:col-span-5 space-y-4 min-w-0">
            <SituationReport minutes={60} />
            <Card title="Ask the data" subtitle="Natural language → SQL on TigerData, answered by Gemini" icon={MessageSquareText}>
              <AskPanel showStatus={false} />
            </Card>
          </div>
        </div>
      </section>

      <section aria-labelledby="tiger-heading" className="space-y-4">
        <SectionHeading id="tiger-heading" icon={Database} title="TigerData">
          Every telemetry row and alert is written to TimescaleDB hypertables on TigerData. A continuous aggregate rolls telemetry into one-second buckets so these charts stay fast as the history grows.
        </SectionHeading>
        <TigerAnalytics />
      </section>
    </div>
  );
};

export default Intelligence;
