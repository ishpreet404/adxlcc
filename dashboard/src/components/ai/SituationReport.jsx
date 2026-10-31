import React, { useEffect, useRef } from 'react';
import { FileText, RefreshCw, CircleAlert } from 'lucide-react';
import useStore from '../../store/useStore';
import { Card } from '../Card';
import { Button } from '../Button';
import { Tag } from '../StatusBadge';
import { Spinner, SkeletonLines, EmptyState } from '../ui/States';
import RichText from './RichText';
import { clockShort, relTime, fmtInt, toMs } from '../../lib/format';
import { useNow } from '../../lib/hooks';

const STALE_MS = 5 * 60 * 1000;

/** Gemini-written summary of the last hour (POST /api/ai/brief). Auto-requested once per visit. */
export const SituationReport = ({ minutes = 60 }) => {
  const brief = useStore(s => s.brief);
  const loading = useStore(s => s.briefLoading);
  const error = useStore(s => s.briefError);
  const request = useStore(s => s.requestBrief);
  const asked = useRef(false);
  useNow(30000);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    // Reuse a recent report (Gemini has daily quotas) instead of regenerating on every visit.
    if (!brief || Date.now() - (brief.receivedAt || 0) > STALE_MS) request(minutes);
  }, [brief, minutes, request]);

  const gen = brief ? toMs(brief.generatedAt) || brief.receivedAt : null;
  const fallback = brief && (brief.source ? brief.source !== 'gemini' : !brief.model);

  return (
    <Card title="Situation Report" subtitle={`Gemini summary of the last ${minutes} minutes`} icon={FileText}
      headerAction={(
        <Button size="xs" variant="outline" onClick={() => request(minutes)} disabled={loading} aria-label="Generate a new situation report">
          {loading ? <Spinner className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
          <span>{loading ? 'Generating…' : 'Generate report'}</span>
        </Button>
      )}>
      {error && (
        <div className="mb-3 rounded-lg border border-terminal-red/30 bg-terminal-red/[0.06] px-3 py-2 text-[13px] text-red-200 flex gap-2" role="alert">
          <CircleAlert className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" /><span className="min-w-0 break-words">{error}</span>
        </div>
      )}
      {!brief && loading && (
        <div className="space-y-3">
          <div className="text-[12px] text-terminal-muted flex items-center gap-2"><Spinner className="w-3.5 h-3.5" /> Gemini is reviewing the last hour of alerts and telemetry…</div>
          <SkeletonLines lines={5} />
        </div>
      )}
      {!brief && !loading && !error && <EmptyState compact icon={FileText} title="No report yet">Generate a report to get a plain-language summary of recent activity.</EmptyState>}
      {brief && (
        <div className={`space-y-3 ${loading ? 'opacity-60 transition-opacity' : ''}`} aria-busy={loading}>
          <div className="flex items-center gap-2 flex-wrap text-[12px] text-terminal-muted">
            <span>Generated <span className="num text-gray-300">{gen ? clockShort(gen) : '—'}</span> ({relTime(gen)})</span>
            {fallback ? <Tag tone="neutral">Fallback</Tag> : <Tag tone="violet">Gemini {brief.model}</Tag>}
          </div>
          <RichText text={brief.text} />
          {brief.stats && (
            <div className="grid grid-cols-3 gap-2 pt-1">
              {[['Alerts', brief.stats.alerts], ['Telemetry rows', brief.stats.telemetryRows], ['Nodes', Array.isArray(brief.stats.nodes) ? brief.stats.nodes.length : brief.stats.nodes]].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-terminal-black border border-terminal-border px-3 py-2 min-w-0">
                  <div className="text-[11px] text-terminal-muted truncate">{k}</div>
                  <div className="num text-[15px] text-gray-100 truncate">{fmtInt(v)}</div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-terminal-muted">Built from the alerts and telemetry recorded in this window.</p>
        </div>
      )}
    </Card>
  );
};

export default SituationReport;
