import React from 'react';
import useStore from '../../store/useStore';
import { clock, titleCase } from '../../lib/format';

const typeColor = (type) => {
  if (type.startsWith('ALERT_CREATED') || type === 'DETECTION') return 'text-red-300';
  if (type.includes('OFFLINE') || type.includes('WARNING')) return 'text-amber-300';
  if (type.includes('ONLINE') || type.includes('RESOLVED')) return 'text-green-300';
  if (type.startsWith('SIM')) return 'text-violet-300';
  return 'text-sky-300';
};

export const EventLog = ({ limit = 40, height = 220 }) => {
  const events = useStore(s => s.events);
  const loaded = useStore(s => s.loaded);
  return (
    <div className="overflow-y-auto -mx-1 px-1 text-[12px]" style={{ maxHeight: height }} role="log" aria-label="Event log">
      {events.slice(0, limit).map(e => (
        <div key={e.id || `${e.t}-${e.type}`} className="flex gap-3 py-1.5 border-b border-terminal-border/60 last:border-0 min-w-0">
          <span className="num text-terminal-muted flex-shrink-0 text-[11px] pt-px">{clock(e.t)}</span>
          <span className="min-w-0">
            <span className={`font-medium mr-2 ${typeColor(e.type || '')}`}>{titleCase(e.type)}</span>
            <span className="text-gray-300 break-words">{e.message}</span>
          </span>
        </div>
      ))}
      {!events.length && <div className="text-terminal-muted py-4 text-center">{loaded ? 'No events yet.' : 'Loading…'}</div>}
    </div>
  );
};

export default EventLog;
