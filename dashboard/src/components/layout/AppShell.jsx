import React from 'react';
import { Bell, CheckCheck, Monitor, X, ChevronRight, MoreHorizontal, AlertTriangle } from 'lucide-react';
import useStore from '../../store/useStore';
import { NAV, NAV_BY_ID, TAB_IDS, MORE_IDS } from './nav';
import { LogoMark } from './Logo';
import ArmingControl from './ArmingControl';
import AudioAlarm from './AudioAlarm';
import { ConnectionStatus, MissionBadge, SimToggle, InstallButton } from './ShellWidgets';
import { useNow } from '../../lib/hooks';
import { alertHeadline, relTime } from '../../lib/format';

const useActiveAlerts = () => useStore(s => s.alerts).filter(a => a.status === 'ACTIVE' && !a.test);

// ---- desktop sidebar ----------------------------------------------------------------------
const Sidebar = () => {
  const page = useStore(s => s.page);
  const setPage = useStore(s => s.setPage);
  const active = useActiveAlerts().length;
  return (
    <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-terminal-border bg-[#0d131b]" aria-label="Primary">
      <div className="h-16 px-4 flex items-center gap-3 border-b border-terminal-border flex-shrink-0">
        <LogoMark className="w-9 h-9" />
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-gray-50 leading-tight truncate">Cyber Chaukidaar</div>
          <div className="text-[11px] text-terminal-muted leading-tight mt-0.5">Perimeter security</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Pages">
        <ul className="space-y-0.5">
          {NAV.map(item => {
            const Icon = item.icon;
            const on = page === item.id;
            const badge = item.id === 'alerts' ? active : 0;
            return (
              <li key={item.id}>
                <button type="button" onClick={() => setPage(item.id)} aria-current={on ? 'page' : undefined}
                  className={`group w-full h-9 flex items-center gap-3 px-3 rounded-lg text-[13px] font-medium transition-colors ${on ? 'bg-white/[0.07] text-white' : 'text-gray-400 hover:text-gray-100 hover:bg-white/[0.04]'}`}>
                  <Icon className={`w-4 h-4 flex-shrink-0 ${on ? 'text-sky-300' : ''}`} aria-hidden="true" />
                  <span className="flex-1 text-left truncate">{item.label}</span>
                  {badge > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-terminal-red text-white text-[11px] font-semibold flex items-center justify-center num" aria-label={`${badge} active alerts`}>{badge}</span>}
                  <kbd className="hidden xl:inline text-[10px] text-terminal-muted/70 font-mono opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true">{item.key}</kbd>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-6">
          <MissionBadge onClick={() => setPage('mission')} />
        </div>
      </nav>

      <div className="border-t border-terminal-border p-4 space-y-4 flex-shrink-0">
        <SimToggle description={false} />
        <InstallButton />
        <ConnectionStatus />
      </div>
    </aside>
  );
};

// ---- header (mobile + desktop) ------------------------------------------------------------
const Clock = () => {
  const now = useNow(1000);
  return <time className="hidden xl:block text-xs text-terminal-muted num" dateTime={new Date(now).toISOString()}>{new Date(now).toLocaleTimeString([], { hour12: false })}</time>;
};

const AlertBanner = () => {
  const alerts = useActiveAlerts();
  const setPage = useStore(s => s.setPage);
  const acknowledgeAll = useStore(s => s.acknowledgeAll);
  useNow(5000);
  if (!alerts.length) return null;
  const a = alerts[0];
  return (
    <div className="border-b border-terminal-red/30 bg-[#2a1215]" role="alert">
      <div className="px-gutter lg:px-6 py-2 flex items-center gap-3 max-w-[1600px] mx-auto">
        <span className="relative flex w-2 h-2 flex-shrink-0" aria-hidden="true">
          <span className="absolute inset-0 rounded-full bg-terminal-red animate-ping" style={{ animationDuration: '2s' }} />
          <span className="relative w-2 h-2 rounded-full bg-terminal-red" />
        </span>
        <AlertTriangle className="w-4 h-4 text-red-300 flex-shrink-0 hidden sm:block" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-[13px] text-red-100 truncate">
          <span className="font-semibold">{alerts.length} active alert{alerts.length > 1 ? 's' : ''}</span>
          <span className="text-red-200/80"> · {alertHeadline(a)} · {a.nodeName} · {relTime(a.createdAt)}</span>
        </div>
        <button type="button" onClick={() => setPage('alerts')} className="h-8 px-3 rounded-md text-xs font-medium text-red-100 hover:bg-white/10 flex-shrink-0">View</button>
        <button type="button" onClick={acknowledgeAll} className="hidden sm:inline-flex h-8 px-3 items-center gap-1.5 rounded-md text-xs font-medium bg-terminal-red/20 text-red-100 hover:bg-terminal-red/30 flex-shrink-0" title="Acknowledge all (A)">
          <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" /> Acknowledge all
        </button>
      </div>
    </div>
  );
};

const Header = () => {
  const page = useStore(s => s.page);
  const setPage = useStore(s => s.setPage);
  const setWallMode = useStore(s => s.setWallMode);
  const nodes = useStore(s => s.nodes);
  const selectedId = useStore(s => s.selectedNodeId);
  const active = useActiveAlerts().length;
  const meta = NAV_BY_ID[page] || NAV[0];
  const sub = page === 'nodes' && selectedId && nodes[selectedId] ? nodes[selectedId].name : meta.subtitle;
  return (
    <header className={`sticky top-0 z-30 bg-terminal-black/90 backdrop-blur supports-[backdrop-filter]:bg-terminal-black/75 pt-safe ${active ? 'border-t-2 border-terminal-red' : ''}`}>
      <div className="border-b border-terminal-border">
        {/* mobile */}
        <div className="lg:hidden h-14 px-gutter flex items-center gap-2.5">
          <LogoMark className="w-8 h-8 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-semibold text-gray-50 truncate leading-tight">{meta.label}</h1>
            <p className="text-[11px] text-terminal-muted truncate leading-tight">{sub}</p>
          </div>
          <ArmingControl compact />
          <AudioAlarm compact />
        </div>
        {/* desktop */}
        <div className="hidden lg:flex h-16 px-6 items-center gap-4 max-w-[1600px] mx-auto">
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] font-semibold text-gray-50 truncate leading-tight">{meta.label}</h1>
            <p className="text-xs text-terminal-muted truncate leading-tight mt-0.5">{sub}</p>
          </div>
          <ArmingControl />
          <button type="button" onClick={() => setPage('alerts')} aria-label={`${active} active alerts — open Alerts`} title="Active alerts"
            className={`h-8 px-3 inline-flex items-center gap-1.5 rounded-lg border text-xs font-medium transition-colors ${active ? 'border-terminal-red/40 bg-terminal-red/10 text-red-300' : 'border-terminal-border text-gray-300 hover:bg-white/5'}`}>
            <Bell className="w-4 h-4" aria-hidden="true" /><span className="num">{active}</span><span className="hidden xl:inline">active</span>
          </button>
          <AudioAlarm />
          <button type="button" onClick={() => { setPage('overview'); setWallMode(true); }} aria-label="Wall display mode (W)" title="Wall display mode (W)"
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-terminal-border text-terminal-muted hover:text-gray-100 hover:bg-white/5">
            <Monitor className="w-4 h-4" aria-hidden="true" />
          </button>
          <Clock />
        </div>
      </div>
      <AlertBanner />
    </header>
  );
};

// ---- mobile tab bar + "More" sheet --------------------------------------------------------
const Tab = ({ id, label, icon: Icon, on, onClick, badge }) => (
  <button type="button" onClick={onClick} aria-current={on ? 'page' : undefined} aria-label={badge ? `${label}, ${badge} active` : label}
    className={`relative flex flex-col items-center justify-center gap-1 min-h-[56px] text-[10.5px] font-medium transition-colors ${on ? 'text-sky-300' : 'text-terminal-muted active:text-gray-100'}`}>
    <span className="relative">
      <Icon className="w-5 h-5" aria-hidden="true" />
      {badge > 0 && <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-terminal-red text-white text-[10px] font-semibold flex items-center justify-center num ring-2 ring-[#0d131b]">{badge > 99 ? '99+' : badge}</span>}
    </span>
    <span>{label}</span>
  </button>
);

const BottomTabs = () => {
  const page = useStore(s => s.page);
  const setPage = useStore(s => s.setPage);
  const moreOpen = useStore(s => s.moreOpen);
  const setMoreOpen = useStore(s => s.setMoreOpen);
  const active = useActiveAlerts().length;
  const moreOn = moreOpen || MORE_IDS.includes(page);
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-terminal-border bg-[#0d131b]/95 backdrop-blur pb-safe" aria-label="Pages">
      <div className="grid grid-cols-5 pl-safe pr-safe">
        {TAB_IDS.map(id => {
          const n = NAV_BY_ID[id];
          return <Tab key={id} id={id} label={n.label} icon={n.icon} on={page === id && !moreOpen} onClick={() => setPage(id)} badge={id === 'alerts' ? active : 0} />;
        })}
        <Tab id="more" label="More" icon={MoreHorizontal} on={moreOn} onClick={() => setMoreOpen(!moreOpen)} />
      </div>
    </nav>
  );
};

const MoreSheet = () => {
  const open = useStore(s => s.moreOpen);
  const setOpen = useStore(s => s.setMoreOpen);
  const page = useStore(s => s.page);
  const setPage = useStore(s => s.setPage);
  const setWallMode = useStore(s => s.setWallMode);
  const profile = useStore(s => s.profile);
  if (!open) return null;
  return (
    <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="more-title">
      <button type="button" className="absolute inset-0 bg-black/60 animate-fade-in" aria-label="Close menu" onClick={() => setOpen(false)} />
      <div className="absolute bottom-0 inset-x-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-terminal-border bg-terminal-dark shadow-pop pb-safe animate-sheet-up">
        <div className="sticky top-0 bg-terminal-dark pt-2 pb-1 px-4">
          <div className="mx-auto w-10 h-1 rounded-full bg-white/15" aria-hidden="true" />
          <div className="flex items-center justify-between mt-2">
            <h2 id="more-title" className="text-[15px] font-semibold text-gray-50">More</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="w-10 h-10 -mr-2 inline-flex items-center justify-center rounded-lg text-terminal-muted hover:text-gray-100 hover:bg-white/5">
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="px-4 pb-5 space-y-5">
          <ul className="rounded-xl border border-terminal-border divide-y divide-terminal-border overflow-hidden">
            {MORE_IDS.map(id => {
              const n = NAV_BY_ID[id];
              const Icon = n.icon;
              const on = page === id;
              return (
                <li key={id}>
                  <button type="button" onClick={() => setPage(id)} aria-current={on ? 'page' : undefined}
                    className={`w-full min-h-[52px] px-4 flex items-center gap-3 text-left ${on ? 'bg-white/[0.06]' : 'active:bg-white/[0.04]'}`}>
                    <Icon className={`w-5 h-5 flex-shrink-0 ${on ? 'text-sky-300' : 'text-terminal-muted'}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium text-gray-100">{n.label}</span>
                      <span className="block text-[12px] text-terminal-muted truncate">{id === 'mission' && profile ? `Active: ${profile.name}` : n.subtitle}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-terminal-muted" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="rounded-xl border border-terminal-border p-4 space-y-4">
            <SimToggle />
            <button type="button" onClick={() => { setPage('overview'); setWallMode(true); }}
              className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-lg border border-terminal-border bg-terminal-surface text-[13px] font-medium text-gray-200">
              <Monitor className="w-4 h-4" aria-hidden="true" /> Wall display mode
            </button>
            <InstallButton />
          </div>
          <ConnectionStatus className="px-1" />
        </div>
      </div>
    </div>
  );
};

/** Responsive application frame: sidebar + header on desktop, header + tab bar on mobile. */
export const AppShell = ({ children }) => (
  <div className="min-h-screen min-h-[100dvh] bg-terminal-black text-gray-200 lg:pl-60">
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:px-3 focus:py-2 focus:rounded-lg focus:bg-terminal-blue focus:text-white">Skip to content</a>
    <Sidebar />
    <Header />
    <main id="main" className="w-full max-w-[1600px] mx-auto px-gutter lg:px-6 pt-4 lg:pt-6 pb-tabbar lg:pb-10 min-w-0 overflow-x-clip">
      {children}
    </main>
    <BottomTabs />
    <MoreSheet />
  </div>
);

export default AppShell;
