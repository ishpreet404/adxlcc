import React, { useEffect, useState } from 'react';
import { Shield, Radio, Cpu, Activity, Database, Settings2, Lock, Unlock, FlaskConical, CheckCheck, Monitor } from 'lucide-react';
import useStore from '../../store/useStore';
import AudioAlarm from './AudioAlarm';

const NAV = [
  { id: 'command', label: 'COMMAND', icon: Radio, key: '1' },
  { id: 'node', label: 'NODE', icon: Cpu, key: '2' },
  { id: 'incidents', label: 'INCIDENTS', icon: Activity, key: '3' },
  { id: 'threat', label: 'THREAT INTEL', icon: Database, key: '4' },
  { id: 'setup', label: 'SETUP', icon: Settings2, key: '5' }
];

const ARM = [
  { id: 'ARMED', label: 'ARMED', icon: Lock, cls: 'border-terminal-red text-terminal-red bg-terminal-red/15' },
  { id: 'TEST', label: 'TEST', icon: FlaskConical, cls: 'border-terminal-amber text-terminal-amber bg-terminal-amber/15' },
  { id: 'DISARMED', label: 'DISARMED', icon: Unlock, cls: 'border-terminal-green text-terminal-green bg-terminal-green/15' }
];

export const TopBar = () => {
  const page = useStore(s => s.page);
  const setPage = useStore(s => s.setPage);
  const connected = useStore(s => s.connected);
  const alerts = useStore(s => s.alerts);
  const nodes = useStore(s => s.nodes);
  const arming = useStore(s => s.arming);
  const setArming = useStore(s => s.setArming);
  const acknowledgeAll = useStore(s => s.acknowledgeAll);
  const setWallMode = useStore(s => s.setWallMode);
  const [time, setTime] = useState('');

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString([], { hour12: false }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const online = Object.values(nodes).filter(n => n.status === 'ONLINE').length;
  const total = Object.keys(nodes).length;
  const active = alerts.filter(a => a.status === 'ACTIVE' && !a.test).length;

  return (
    <header className="border-b border-terminal-border bg-terminal-black sticky top-0 z-40">
      <div className="px-3 sm:px-4">
        <div className="flex items-center justify-between h-12 gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 bg-terminal-green/10 border border-terminal-green flex items-center justify-center flex-shrink-0">
              <Shield className="w-4 h-4 text-terminal-green" />
            </div>
            <div className="min-w-0 hidden sm:block">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm tracking-wider text-terminal-green text-shadow-terminal leading-none truncate">CYBER CHAUKIDAAR</span>
                <span className="text-[10px] px-1.5 py-0.5 bg-terminal-green/20 text-terminal-green border border-terminal-green/40 leading-none">v2.1</span>
              </div>
              <div className="text-[9px] text-terminal-muted tracking-widest uppercase mt-0.5 leading-none">3-point perimeter sensing grid</div>
            </div>
          </div>

          <nav className="hidden lg:flex items-center gap-1">
            {NAV.map(item => {
              const Icon = item.icon;
              const isActive = page === item.id;
              const badge = item.id === 'incidents' ? active : 0;
              return (
                <button key={item.id} onClick={() => setPage(item.id)} title={`key ${item.key}`}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider border transition-all ${
                    isActive ? 'bg-terminal-green/15 text-terminal-green border-terminal-green' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-terminal-border'
                  }`}>
                  <Icon className="w-3.5 h-3.5" />
                  <span>{item.label}</span>
                  {badge > 0 && <span className="px-1.5 text-[10px] bg-terminal-red text-white font-bold animate-pulse">{badge}</span>}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            {/* arming segmented control */}
            <div className="flex border border-terminal-border">
              {ARM.map(m => {
                const Icon = m.icon;
                const on = arming.mode === m.id;
                return (
                  <button key={m.id} onClick={() => setArming(m.id)} title={`Set site ${m.label}`}
                    className={`flex items-center gap-1 px-2 py-1 text-[10px] font-bold border-r last:border-r-0 border-terminal-border transition-colors ${on ? m.cls : 'text-terminal-muted hover:text-gray-200'}`}>
                    <Icon className="w-3 h-3" /><span className="hidden md:inline">{m.label}</span>
                  </button>
                );
              })}
            </div>
            {active > 0 && (
              <button onClick={acknowledgeAll} title="Acknowledge all (A)" className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold border border-terminal-amber text-terminal-amber bg-terminal-amber/10">
                <CheckCheck className="w-3 h-3" /> ACK ALL
              </button>
            )}
            <AudioAlarm />
            <button onClick={() => { setPage('command'); setWallMode(true); }} title="Wall mode (W)" className="hidden md:flex items-center px-2 py-1 border border-terminal-border text-terminal-muted hover:text-gray-200">
              <Monitor className="w-3.5 h-3.5" />
            </button>
            <div className="hidden xl:flex items-center gap-1.5 text-[11px] border border-terminal-border px-2 py-1 bg-terminal-surface">
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-terminal-green animate-pulse' : 'bg-terminal-red'}`} />
              <span className={connected ? 'text-terminal-green' : 'text-terminal-red'}>{connected ? 'LINK' : 'DOWN'}</span>
              <span className="text-terminal-muted">{online}/{total}</span>
            </div>
            <div className="hidden xl:block text-[11px] text-terminal-muted px-2 py-1 border border-terminal-border bg-black/40 tabular-nums">{time}</div>
          </div>
        </div>
        <div className="lg:hidden flex items-center gap-1 py-1.5 border-t border-terminal-border/50 overflow-x-auto no-scrollbar">
          {NAV.map(item => (
            <button key={item.id} onClick={() => setPage(item.id)}
              className={`px-2 py-1 text-[10px] uppercase whitespace-nowrap border ${page === item.id ? 'border-terminal-green text-terminal-green bg-terminal-green/10 font-bold' : 'border-terminal-border text-gray-400'}`}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
};

export default TopBar;
