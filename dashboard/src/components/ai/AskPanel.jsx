import React, { useState, useEffect } from 'react';
import { Sparkles, CornerDownLeft, Database, AlertCircle } from 'lucide-react';
import api from '../../services/api';

// Natural-language query box over the TigerData history, answered by Gemini (text-to-SQL).
// The server validates the generated SQL (single read-only SELECT) before running it.
const SUGGESTIONS = [
  'how many intrusion alerts per node today',
  'average probability per node in the last 15 minutes',
  'when was the last vehicle detection',
  'which node has the most alerts'
];

export const AskPanel = () => {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => { api.aiStatus().then(setStatus).catch(() => setStatus(null)); }, []);

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
    <div className="text-[11px] space-y-2">
      <div className="flex items-center gap-2 text-terminal-muted">
        <span className={gemini ? 'text-terminal-cyan' : 'text-terminal-red'}>● Gemini {gemini ? status.gemini.model : 'offline'}</span>
        <span className={tiger ? 'text-terminal-green' : 'text-terminal-red'}>● TigerData {tiger ? 'live' : 'offline'}</span>
      </div>

      <div className="flex gap-1">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') run(); }}
          placeholder="Ask about your sensor history…"
          className="flex-1 bg-terminal-black border border-terminal-border px-2 py-1 text-gray-100 focus:border-terminal-cyan outline-none"
        />
        <button onClick={() => run()} disabled={busy}
          className="px-2 border border-terminal-cyan text-terminal-cyan hover:bg-terminal-cyan/10 disabled:opacity-50 flex items-center gap-1">
          {busy ? '…' : <><Sparkles className="w-3 h-3" /><CornerDownLeft className="w-3 h-3" /></>}
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {SUGGESTIONS.map(s => (
          <button key={s} onClick={() => run(s)} disabled={busy}
            className="text-[9px] px-1.5 py-0.5 border border-terminal-border text-terminal-muted hover:text-terminal-cyan hover:border-terminal-cyan">{s}</button>
        ))}
      </div>

      {res && res.ok && (
        <div className="space-y-2">
          {res.summary && <div className="border-l-2 border-terminal-cyan pl-2 text-gray-200 flex gap-1.5"><Sparkles className="w-3 h-3 text-terminal-cyan flex-shrink-0 mt-0.5" />{res.summary}</div>}
          {res.sql && <pre className="text-[9px] text-terminal-muted bg-terminal-black border border-terminal-border p-1.5 overflow-x-auto"><Database className="w-3 h-3 inline mr-1" />{res.sql}</pre>}
          {cols.length > 0 && (
            <div className="overflow-x-auto max-h-48 border border-terminal-border">
              <table className="w-full text-[10px]">
                <thead><tr className="text-terminal-muted border-b border-terminal-border">{cols.map(c => <th key={c} className="text-left px-1.5 py-0.5">{c}</th>)}</tr></thead>
                <tbody>
                  {res.rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-b border-terminal-border/40">{cols.map(c => <td key={c} className="px-1.5 py-0.5">{String(r[c])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cols.length === 0 && <div className="text-terminal-muted">no rows</div>}
        </div>
      )}
      {res && !res.ok && (
        <div className="text-terminal-red flex gap-1.5"><AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />{res.error || 'query failed'}{res.sql && <span className="text-terminal-muted">· {res.sql}</span>}</div>
      )}
    </div>
  );
};

export default AskPanel;
