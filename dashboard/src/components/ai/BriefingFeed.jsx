import React from 'react';
import { Sparkles, RefreshCw, CircleAlert, Radio } from 'lucide-react';
import useStore from '../../store/useStore';
import { Card } from '../Card';
import { Tag } from '../StatusBadge';
import { EmptyState, SkeletonLines } from '../ui/States';
import { severityHex, relTime, titleCase, toMs } from '../../lib/format';
import { useNow } from '../../lib/hooks';

const SourceBadge = ({ item }) => (item.source === 'gemini'
  ? <Tag tone="violet" title="Written by Google Gemini">Gemini{item.model ? ` ${item.model}` : ''}</Tag>
  : <Tag tone="neutral" title="Gemini was unavailable; the server used its template summary">Fallback</Tag>);

export const BriefingItem = ({ item, onNode }) => {
  const t = toMs(item.t);
  return (
    <li className="relative pl-4 pr-1 py-3">
      <span className="absolute left-0 top-3 bottom-3 w-1 rounded-full" style={{ background: severityHex(item.severity) }} aria-hidden="true" />
      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[12px]">
        {item.nodeName || item.nodeId ? (
          <button type="button" onClick={() => onNode && item.nodeId && onNode(item.nodeId)} className="font-medium text-sky-300 hover:text-sky-200">{item.nodeName || item.nodeId}</button>
        ) : <span className="font-medium text-gray-300">Site</span>}
        {item.severity && <span className="text-terminal-muted">{titleCase(item.severity)}</span>}
        {item.simulated && <span className="text-[10px] font-semibold tracking-wide px-1.5 rounded ring-1 ring-inset bg-terminal-violet/10 text-violet-300 ring-terminal-violet/30 leading-[18px]">SIM</span>}
        <time className="ml-auto text-terminal-muted whitespace-nowrap" dateTime={t ? new Date(t).toISOString() : undefined} title={t ? new Date(t).toLocaleString() : undefined}>{relTime(t)}</time>
      </div>
      {(item.title || item.label || item.kind) && <div className="text-[13px] font-semibold text-gray-50 mt-1">{item.title || titleCase(item.label || item.kind)}</div>}
      <p className="text-[13px] text-gray-200 leading-relaxed mt-0.5">{item.text}</p>
      <div className="mt-1.5"><SourceBadge item={item} /></div>
    </li>
  );
};

/** Live feed of AI narratives (GET /api/ai/feed + WebSocket `ai` messages). */
export const BriefingFeed = ({ limit = 100, maxHeight = 640, compact = false }) => {
  const items = useStore(s => s.aiFeed);
  const status = useStore(s => s.aiFeedStatus);
  const error = useStore(s => s.aiFeedError);
  const load = useStore(s => s.loadAiFeed);
  const connected = useStore(s => s.connected);
  const show = useStore(s => s.showSimulated);
  const rawNodes = useStore(s => s.raw.nodes);
  const selectNode = useStore(s => s.selectNode);
  const setPage = useStore(s => s.setPage);
  useNow(15000);

  const isSim = (i) => i.simulated === true || !!(i.nodeId && rawNodes[i.nodeId] && rawNodes[i.nodeId].simulated);
  const visible = items.filter(i => show || !isSim(i));
  const hidden = items.length - visible.length;
  const onNode = (id) => { selectNode(id); setPage('nodes'); };

  const body = (() => {
    if ((status === 'loading' || status === 'idle') && !items.length) return <SkeletonLines lines={6} className="py-2" />;
    if (status === 'error' && !items.length) {
      return (
        <EmptyState compact={compact} icon={CircleAlert} tone="error" title="Briefing feed unavailable"
          action={<button type="button" onClick={load} className="h-9 px-3 rounded-lg border border-terminal-border text-[13px] text-gray-200 hover:bg-white/5">Retry</button>}>
          {error}
        </EmptyState>
      );
    }
    if (!visible.length) {
      return (
        <EmptyState compact={compact} icon={Sparkles} title="No briefings yet">
          Gemini narrates every new alert in plain language. They will stream in here live.
          {hidden > 0 && <> {hidden} item{hidden > 1 ? 's' : ''} from simulated nodes are hidden.</>}
        </EmptyState>
      );
    }
    return (
      <>
        <ul className="divide-y divide-terminal-border/70 overflow-y-auto -my-1" style={{ maxHeight }} aria-live="polite">
          {visible.slice(0, limit).map((item, i) => <BriefingItem key={item.id || i} item={item} onNode={onNode} />)}
        </ul>
        {hidden > 0 && !compact && <div className="pt-2 text-[11px] text-terminal-muted">{hidden} item{hidden > 1 ? 's' : ''} from simulated nodes hidden.</div>}
      </>
    );
  })();

  if (compact) return body;
  return (
    <Card title="Gemini Live Briefing" subtitle="Plain-language narration of every alert, streamed live" icon={Sparkles}
      headerAction={(
        <>
          <span className={`hidden sm:inline-flex items-center gap-1.5 text-[11px] ${connected ? 'text-green-300' : 'text-terminal-muted'}`}>
            <Radio className="w-3.5 h-3.5" aria-hidden="true" />{connected ? 'Live' : 'Offline'}
          </span>
          <button type="button" onClick={load} aria-label="Refresh briefing feed" title="Refresh"
            className="w-8 h-8 inline-flex items-center justify-center rounded-md text-terminal-muted hover:text-gray-100 hover:bg-white/5">
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
          </button>
        </>
      )}>
      {body}
    </Card>
  );
};

export default BriefingFeed;
