import React, { useEffect } from 'react';
import useStore from './store/useStore';
import AppShell from './components/layout/AppShell';
import Toasts from './components/layout/Toasts';
import WallMode from './components/layout/WallMode';
import { NAV_BY_ID, PAGE_KEYS } from './components/layout/nav';
import CommandCenter from './pages/CommandCenter';
import NodeDetail from './pages/NodeDetail';
import Incidents from './pages/Incidents';
import Intelligence from './pages/Intelligence';
import Mission from './pages/Mission';
import ThreatIntelligence from './pages/ThreatIntelligence';
import Setup from './pages/Setup';

const PAGES = {
  overview: CommandCenter,
  alerts: Incidents,
  intel: Intelligence,
  nodes: NodeDetail,
  mission: Mission,
  settings: Setup,
  osint: ThreatIntelligence
};

const isTyping = (el) => {
  if (!el) return false;
  const tag = el.tagName || '';
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || el.isContentEditable;
};

export function App() {
  const page = useStore(s => s.page);
  const init = useStore(s => s.init);
  const wallMode = useStore(s => s.wallMode);
  const activeCount = useStore(s => s.alerts.filter(a => a.status === 'ACTIVE' && !a.test).length);

  useEffect(() => { init(); }, [init]);

  // hash routing (#/alerts) so the back button and deep links work, including in the installed app
  useEffect(() => {
    const onHash = () => useStore.getState().syncPageFromHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => { window.scrollTo(0, 0); }, [page]);

  useEffect(() => {
    const label = (NAV_BY_ID[page] || NAV_BY_ID.overview).label;
    document.title = `${activeCount ? `(${activeCount}) ` : ''}${label} — Cyber Chaukidaar`;
  }, [page, activeCount]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const s = useStore.getState();
      if (PAGE_KEYS[e.key]) { s.setPage(PAGE_KEYS[e.key]); return; }
      switch (e.key.toLowerCase()) {
        case 'a': s.acknowledgeAll(); break;
        case 'm': s.setMuted(!s.muted); break;
        case 'w': if (!s.wallMode) s.setPage('overview'); s.setWallMode(!s.wallMode); break;
        case 'g': s.setShowGroundTruth(!s.showGroundTruth); break;
        case 'e': s.setEditMap(!s.editMap); break;
        case 'escape': if (s.moreOpen) s.setMoreOpen(false); else s.setWallMode(false); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const Page = PAGES[page] || CommandCenter;

  if (wallMode) return (<><WallMode /><Toasts /></>);

  return (
    <>
      <AppShell>
        {page === 'osint' ? <div className="max-w-4xl"><Page /></div> : <Page />}
      </AppShell>
      <Toasts />
    </>
  );
}

export default App;
