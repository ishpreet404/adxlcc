import React, { useState } from 'react';
import { Database, Search, AlertTriangle, Eye, ShieldCheck, Clock3, Server, CircleAlert, Printer, RotateCcw, Info } from 'lucide-react';
import { Card, Input, Button, Spinner } from '../components';
import { fmtInt } from '../lib/format';

const APP_API_BASE_URL = (import.meta.env.VITE_APP_API_BASE_URL || '').replace(/\/+$/, '');
const BREACH_CHECK_ENDPOINT = `${APP_API_BASE_URL}/api/breach-check`;

// Field categorization
const FIELD_TYPES = {
  email: ['Email', 'email'],
  phone: ['Phone', 'Phone2', 'Phone3'],
  address: ['Address', 'City', 'State', 'Region', 'Country', 'PostCode', 'Zip'],
  sensitive: ['Password', 'CreditCard', 'CardExpiration', 'DocNumber', 'PassportNumber', 'IP', 'SSN', 'CVV'],
  personal: ['Name', 'FirstName', 'LastName', 'FullName', 'Username', 'Gender', 'Age', 'DOB', 'Birthday'],
  default: []
};

const getFieldType = (fieldName) => {
  for (const [type, fields] of Object.entries(FIELD_TYPES)) {
    if (fields.some(f => fieldName.toLowerCase().includes(f.toLowerCase()))) return type;
  }
  return 'default';
};

const formatFieldName = (name) => {
  const s = name.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const Stat = ({ icon: Icon, label, value, tone = 'text-gray-50' }) => (
  <div className="rounded-lg border border-terminal-border px-4 py-3 min-w-0">
    <div className="text-[12px] text-terminal-muted flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" aria-hidden="true" />{label}</div>
    <div className={`num text-xl font-semibold mt-1 ${tone}`}>{value}</div>
  </div>
);

const BreachChecker = () => {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const checkBreaches = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setError(null);
    setResults(null);
    try {
      const response = await fetch(BREACH_CHECK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 100, lang: 'en' })
      });
      let data = {};
      try { data = await response.json(); } catch { /* non-JSON */ }
      if (!response.ok || data.error) setError(data.error || response.statusText || 'Please try again later.');
      else setResults(data);
    } catch (err) {
      setError(`Connection error: ${err.message}`);
    } finally {
      setIsSearching(false);
    }
  };

  const found = results && results.List && results.NumOfResults > 0;

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-terminal-muted">Check whether an email address, phone number or name appears in known data-breach records.</p>

      <Card title="Data exposure lookup" icon={Search}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); checkBreaches(); }}>
          <div className="flex items-start gap-2 rounded-lg border border-terminal-border bg-terminal-black/40 px-3 py-2.5 text-[12px] text-terminal-muted">
            <Eye className="w-4 h-4 flex-shrink-0 mt-px" aria-hidden="true" />
            <span>Queries are sent through this server to the lookup provider and are not stored by the dashboard.</span>
          </div>
          <label htmlFor="osint-query" className="sr-only">Email address or phone number</label>
          <Input id="osint-query" icon={Search} type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="email@example.com or phone number" autoComplete="off" />
          <Button type="submit" variant="primary" disabled={!query.trim() || isSearching} className="w-full sm:w-auto">
            {isSearching ? <Spinner /> : <Search className="w-4 h-4" aria-hidden="true" />}{isSearching ? 'Searching…' : 'Check for breaches'}
          </Button>
        </form>
      </Card>

      {isSearching && (
        <Card>
          <div className="flex items-center gap-3 text-[13px] text-gray-300" role="status">
            <Spinner className="w-5 h-5 text-sky-300" />
            <div><div className="font-medium">Searching breach databases…</div><div className="text-terminal-muted text-[12px]">Looking up “{query}”</div></div>
          </div>
        </Card>
      )}

      {error && !isSearching && (
        <Card>
          <div className="flex items-start gap-3" role="alert">
            <CircleAlert className="w-5 h-5 text-red-400 flex-shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-red-200">Lookup failed</div>
              <div className="text-[13px] text-terminal-muted break-words">{error}</div>
            </div>
            <Button size="sm" variant="outline" onClick={checkBreaches}><RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />Retry</Button>
          </div>
        </Card>
      )}

      {results && !isSearching && !error && !found && (
        <Card>
          <div className="flex items-center gap-4">
            <span className="w-11 h-11 rounded-full bg-terminal-green/10 text-green-300 flex items-center justify-center flex-shrink-0"><ShieldCheck className="w-6 h-6" aria-hidden="true" /></span>
            <div>
              <div className="text-[15px] font-semibold text-gray-50">No exposure found</div>
              <div className="text-[13px] text-terminal-muted">“{query}” did not appear in the breach database. Keep using unique passwords and two-factor authentication.</div>
            </div>
          </div>
        </Card>
      )}

      {found && !isSearching && !error && (
        <>
          <Card title="Results" icon={AlertTriangle}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat icon={Database} label="Databases" value={fmtInt(results.NumOfDatabase)} tone="text-red-300" />
              <Stat icon={AlertTriangle} label="Records found" value={fmtInt(results.NumOfResults)} tone="text-red-300" />
              <Stat icon={Clock3} label="Search time" value={results['search time'] !== undefined ? `${Number(results['search time']).toFixed(3)} s` : '—'} />
              <Stat icon={Server} label="Requests left" value={results.free_requests_left !== undefined ? fmtInt(results.free_requests_left) : '—'} />
            </div>
            <div className="mt-3 rounded-lg border border-terminal-red/30 bg-terminal-red/[0.06] px-3 py-2.5 text-[13px] text-red-200">
              This information was found in {results.NumOfDatabase} breach database{results.NumOfDatabase > 1 ? 's' : ''}. Review the records below and act on the recommendations.
            </div>
          </Card>

          <div className="space-y-3">
            {Object.entries(results.List).map(([dbName, dbData]) => (
              <Card key={dbName} title={dbName} icon={Database} headerAction={<span className="text-[12px] text-red-300 num">{fmtInt(dbData.NumOfResults)} record{dbData.NumOfResults > 1 ? 's' : ''}</span>}>
                {dbData.InfoLeak && (
                  <div className="mb-3 text-[13px] text-amber-200 flex items-start gap-2"><Info className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" /><span>{dbData.InfoLeak}</span></div>
                )}
                <div className="space-y-3">
                  {dbData.Data && dbData.Data.map((entry, entryIdx) => (
                    <div key={entryIdx} className="rounded-lg border border-terminal-border p-3">
                      <div className="text-[12px] font-medium text-terminal-muted mb-2">Record {entryIdx + 1}</div>
                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                        {Object.entries(entry).map(([fieldName, fieldValue]) => {
                          if (!fieldValue || fieldValue === 'null') return null;
                          const type = getFieldType(fieldName);
                          const cls = type === 'sensitive' ? 'text-red-300' : type === 'email' || type === 'phone' ? 'text-amber-200' : 'text-gray-200';
                          return (
                            <div key={fieldName} className="min-w-0">
                              <dt className="text-[11px] text-terminal-muted">{formatFieldName(fieldName)}</dt>
                              <dd className={`text-[13px] font-mono break-all ${cls}`}>{String(fieldValue)}</dd>
                            </div>
                          );
                        })}
                      </dl>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>

          <Card title="Recommended actions" icon={ShieldCheck}>
            <ol className="list-decimal pl-5 space-y-1.5 text-[13px] text-gray-200 marker:text-terminal-muted">
              <li>Change passwords on all affected accounts.</li>
              <li>Enable two-factor authentication wherever possible.</li>
              <li>Use a unique password for each service (a password manager helps).</li>
              <li>Watch the affected accounts for suspicious activity.</li>
              <li>If card details were exposed, contact your bank.</li>
            </ol>
            <div className="flex gap-2 mt-4 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => setResults(null)}><RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />New search</Button>
              <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="w-3.5 h-3.5" aria-hidden="true" />Print report</Button>
            </div>
          </Card>
        </>
      )}

      <Card title="How it works" icon={Info}>
        <dl className="space-y-3 text-[13px]">
          <div><dt className="font-medium text-gray-200">Breach database</dt><dd className="text-terminal-muted">Looks up records from publicly known data breaches and leaked databases.</dd></div>
          <div><dt className="font-medium text-gray-200">Privacy</dt><dd className="text-terminal-muted">The dashboard does not keep your searches; the request is proxied by this server.</dd></div>
          <div><dt className="font-medium text-gray-200">Why it is here</dt><dd className="text-terminal-muted">Insider and social-engineering risk often starts with leaked staff credentials — check site personnel alongside the physical perimeter.</dd></div>
        </dl>
      </Card>
    </div>
  );
};

export default BreachChecker;
