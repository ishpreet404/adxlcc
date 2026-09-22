import React from 'react';
import { AlertTriangle, ShieldAlert, X, Info, Timer } from 'lucide-react';
import useStore from '../../store/useStore';

const styles = {
  INTRUSION: 'border-terminal-red bg-terminal-red/10 text-terminal-red',
  TAMPER: 'border-terminal-violet bg-terminal-violet/10 text-terminal-violet',
  LOITER: 'border-terminal-amber bg-terminal-amber/10 text-terminal-amber',
  ERR: 'border-terminal-red bg-terminal-red/10 text-terminal-red',
  default: 'border-terminal-cyan bg-terminal-cyan/10 text-terminal-cyan'
};
const icons = { INTRUSION: AlertTriangle, TAMPER: ShieldAlert, LOITER: Timer, default: Info };

export const Toasts = () => {
  const toasts = useStore(s => s.toasts);
  const dismiss = useStore(s => s.dismissToast);
  const selectNode = useStore(s => s.selectNode);
  const setPage = useStore(s => s.setPage);
  if (!toasts.length) return null;
  return (
    <div className="fixed top-14 right-3 z-50 space-y-2 w-80 max-w-[92vw]">
      {toasts.map(t => {
        const Icon = icons[t.kind] || icons.default;
        return (
          <div key={t.id} className={`border p-2.5 backdrop-blur text-[11px] shadow-lg ${styles[t.kind] || styles.default} ${t.test ? 'opacity-70' : ''}`}>
            <div className="flex items-start gap-2">
              <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-bold">{t.title}</div>
                <div className="text-gray-300 break-words">{t.message}</div>
                {t.nodeId && <button className="mt-1 underline text-gray-200" onClick={() => { selectNode(t.nodeId); setPage('node'); dismiss(t.id); }}>inspect node</button>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-gray-400 hover:text-white"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default Toasts;
