import React, { useState } from 'react';
import { Sparkles, ArrowUp, Database, CircleAlert, ChevronRight } from 'lucide-react';
import api from '../../services/api';
import { useAiStatus } from './useAiStatus';
import { Spinner } from '../ui/States';
import { titleCase } from '../../lib/format';

// Natural-language query box over the TigerData history, answered by Gemini (text-to-SQL).
// The server validates the generated SQL (single read-only SELECT) before running it.
const SUGGESTIONS = [
  'How many intrusion alerts per node today?',
  'Average probability per node in the last 15 minutes',
  'When was the last vehicle detection?',
  'Which node has the most alerts?'
];

const cell = (v) => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

export const AskPanel = ({ showStatus = true }) => {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const status = useAiStatus();

  const run = async (question) => {
    const text = (question ?? q).trim();
    if (!text || busy) return;
    setQ(text); setBusy(true); setRes(null);
    try { setRes(await api.ask(text)); }
    catch (e) { setRes({ ok: false, error: e.message }); }
    finally { setBusy(false); }
  };

  const gemini = status && status.gemini && status.gemini.enabled;
  const tiger = status && status.tiger && status.tiger.ready;
  const cols = res && res.ok && res.rows && res.rows.length ? Object.keys(res.rows[0]) : [];

  return (
    <div className="space-y-3">
      {showStatus && (
        <div className="flex items-center gap-3 text-[12px] text-terminal-muted flex-wrap">
          <span className="inline-flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${gemini ? 'bg-terminal-violet' : 'bg-terminal-red'}`} aria-hidden="true" />Gemini {gemini ? status.gemini.model : status ? 'offline' : '…'}</span>
          <span className="inline-flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${tiger ? 'bg-terminal-green' : 'bg-terminal-red'}`} aria-hidden="true" />TigerData {tiger ? 'connected' : status ? 'offline' : '…'}</span>
        </div>
      )}

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <label htmlFor="ask-input" className="sr-only">Ask a question about the sensor history</label>
        <input id="ask-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Ask about your sensor history…" autoComplete="off" enterKeyHint="send"
          className="flex-1 min-w-0 h-10 rounded-lg bg-terminal-black border border-terminal-border px-3 text-sm text-gray-100 placeholder-terminal-muted/70 focus:border-terminal-cyan/70 focus:ring-2 focus:ring-terminal-cyan/20 outline-none" />
        <button type="submit" disabled={busy || !q.trim()} aria-label="Ask Gemini"
          className="h-10 px-3 inline-flex items-center gap-1.5 rounded-lg bg-terminal-blue text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed">
          {busy ? <Spinner /> : <ArrowUp className="w-4 h-4" aria-hidden="true" />}<span className="hidden sm:inline">Ask</span>
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map(s => (
          <button key={s} type="button" onClick={() => run(s)} disabled={busy}
            className="text-[12px] px-2.5 py-1.5 rounded-full border border-terminal-border text-gray-300 hover:text-white hover:border-terminal-cyan/50 hover:bg-terminal-cyan/5 disabled:opacity-50 text-left">{s}</button>
        ))}
      </div>

      {busy && <div className="text-[12px] text-terminal-muted flex items-center gap-2"><Spinner className="w-3.5 h-3.5" /> Gemini is writing SQL and querying TigerData…</div>}

      {res && res.ok && (
        <div className="space-y-2.5">
          {res.summary && (
            <div className="rounded-lg border border-terminal-violet/25 bg-terminal-violet/[0.06] px-3 py-2.5 text-[13px] text-gray-200 leading-relaxed flex gap-2">
              <Sparkles className="w-4 h-4 text-violet-300 flex-shrink-0 mt-0.5" aria-hidden="true" /><span>{res.summary}</span>
            </div>
          )}
          {res.sql && (
            <details className="group rounded-lg border border-terminal-border bg-terminal-black">
              <summary className="cursor-pointer select-none list-none px-3 py-2 text-[12px] text-terminal-muted flex items-center gap-1.5 hover:text-gray-200">
                <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" aria-hidden="true" /><Database className="w-3.5 h-3.5" aria-hidden="true" /> Generated SQL (read-only, validated)
              </summary>
              <pre className="px-3 pb-3 text-[11px] font-mono text-gray-300 overflow-x-auto whitespace-pre-wrap break-words">{res.sql}</pre>
            </details>
          )}
          {cols.length > 0 ? (
            <div className="overflow-auto max-h-64 rounded-lg border border-terminal-border">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-terminal-surface">
                  <tr className="text-terminal-muted">{cols.map(c => <th key={c} scope="col" className="text-left font-medium px-3 py-2 whitespace-nowrap">{titleCase(c)}</th>)}</tr>
                </thead>
                <tbody>
                  {res.rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t border-terminal-border/70">{cols.map(c => <td key={c} className="px-3 py-1.5 num text-gray-200 whitespace-nowrap">{cell(r[c])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="text-[12px] text-terminal-muted">The query returned no rows.</div>}
          {res.rows && res.rows.length > 50 && <div className="text-[11px] text-terminal-muted">Showing 50 of {res.rows.length.toLocaleString()} rows.</div>}
        </div>
      )}
      {res && !res.ok && (
        <div className="rounded-lg border border-terminal-red/30 bg-terminal-red/[0.06] px-3 py-2.5 text-[13px] text-red-200 flex gap-2">
          <CircleAlert className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0">
            <div>{res.error || 'The query failed.'}</div>
            {res.sql && <pre className="mt-1 text-[11px] font-mono text-terminal-muted whitespace-pre-wrap break-words">{res.sql}</pre>}
          </div>
        </div>
      )}
    </div>
  );
};

export default AskPanel;
