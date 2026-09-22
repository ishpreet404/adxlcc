import React from 'react';
import useStore from '../../store/useStore';
import { clock } from '../../lib/format';

const typeColor = (type) => {
  if (type.startsWith('ALERT_CREATED') || type === 'DETECTION') return 'text-terminal-red';
  if (type.includes('OFFLINE') || type.includes('WARNING')) return 'text-terminal-amber';
  if (type.includes('ONLINE') || type.includes('RESOLVED')) return 'text-terminal-green';
  if (type.startsWith('SIM')) return 'text-terminal-violet';
  return 'text-terminal-cyan';
};

export const EventLog = ({ limit = 40, height = 220 }) => {
  const events = useStore(s => s.events);
  return (
    <div className="overflow-y-auto text-[10px] font-mono" style={{ maxHeight: height }}>
      {events.slice(0, limit).map(e => (
        <div key={e.id} className="flex gap-2 py-0.5 border-b border-terminal-border/40">
          <span className="text-terminal-muted tabular-nums flex-shrink-0">{clock(e.t)}</span>
          <span className={`flex-shrink-0 w-32 truncate ${typeColor(e.type)}`}>{e.type}</span>
          <span className="text-gray-300 truncate">{e.message}</span>
        </div>
      ))}
      {!events.length && <div className="text-terminal-muted">no events yet</div>}
    </div>
  );
};

export default EventLog;
