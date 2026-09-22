import React, { useEffect } from 'react';
import useStore from './store/useStore';
import TopBar from './components/layout/TopBar';
import Toasts from './components/layout/Toasts';
import CommandCenter from './pages/CommandCenter';
import NodeDetail from './pages/NodeDetail';
import Incidents from './pages/Incidents';
import ThreatIntelligence from './pages/ThreatIntelligence';
import Setup from './pages/Setup';

const PAGES = { 1: 'command', 2: 'node', 3: 'incidents', 4: 'threat', 5: 'setup' };

export function App() {
  const page = useStore(s => s.page);
  const init = useStore(s => s.init);
  const connected = useStore(s => s.connected);
  const nodes = useStore(s => s.nodes);
  const wallMode = useStore(s => s.wallMode);

  useEffect(() => { init(); }, [init]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
      const s = useStore.getState();
      if (PAGES[e.key]) return s.setPage(PAGES[e.key]);
      switch (e.key.toLowerCase()) {
        case 'a': return s.acknowledgeAll();
        case 'm': return s.setMuted(!s.muted);
        case 'w': if (!s.wallMode) s.setPage('command'); return s.setWallMode(!s.wallMode);
        case 'g': return s.setShowGroundTruth(!s.showGroundTruth);
        case 'e': return s.setEditMap(!s.editMap);
        case 'escape': return s.setWallMode(false);
        default: return undefined;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const online = Object.values(nodes).filter(n => n.status === 'ONLINE').length;

  return (
    <div className="min-h-screen bg-terminal-black text-gray-100 flex flex-col scanlines">
      {!wallMode && <TopBar />}
      <Toasts />
      <main className="flex-1 w-full max-w-[1800px] mx-auto p-3 sm:p-4">
        {page === 'command' && <CommandCenter />}
        {page === 'node' && <NodeDetail />}
        {page === 'incidents' && <Incidents />}
        {page === 'threat' && <div className="max-w-5xl mx-auto"><ThreatIntelligence /></div>}
        {page === 'setup' && <Setup />}
      </main>
      {!wallMode && (
        <footer className="border-t border-terminal-border bg-terminal-dark py-1.5 px-4 text-[10px] text-terminal-muted flex flex-col sm:flex-row items-center justify-between gap-1">
          <div>CYBER CHAUKIDAAR v2.1 · RADAR + DUAL SEISMIC PROBES + EDGE ML · ZONES · TAMPER · TRIANGULATION · OSINT BREACH INTELLIGENCE</div>
          <div className="flex items-center gap-3">
            <span>{online} NODES ONLINE</span>
            <span>keys: 1-5 · A · M · W · G · E</span>
            <span className={connected ? 'text-terminal-green' : 'text-terminal-red'}>{connected ? 'DEFENSE ACTIVE' : 'SERVER UNREACHABLE'}</span>
          </div>
        </footer>
      )}
    </div>
  );
}

export default App;
