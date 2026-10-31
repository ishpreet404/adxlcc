import { LayoutDashboard, Bell, Sparkles, Cpu, Target, Settings, Globe } from 'lucide-react';

/** Every page, in shortcut order. `key` is the keyboard shortcut. */
export const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, key: '1', subtitle: 'Live perimeter status' },
  { id: 'alerts', label: 'Alerts', icon: Bell, key: '2', subtitle: 'Incidents, evidence and replay' },
  { id: 'intel', label: 'Intelligence', icon: Sparkles, key: '3', subtitle: 'Gemini AI briefings · TigerData analytics' },
  { id: 'nodes', label: 'Nodes', icon: Cpu, key: '4', subtitle: 'Sensor node diagnostics and controls' },
  { id: 'mission', label: 'Mission', icon: Target, key: '5', subtitle: 'Deployment use-case profile' },
  { id: 'settings', label: 'Settings', icon: Settings, key: '6', subtitle: 'Site, zones, arming and notifications' },
  { id: 'osint', label: 'OSINT', icon: Globe, key: '7', subtitle: 'Breach exposure lookup' }
];

export const NAV_BY_ID = Object.fromEntries(NAV.map(n => [n.id, n]));
export const PAGE_KEYS = Object.fromEntries(NAV.map(n => [n.key, n.id]));
export const TAB_IDS = ['overview', 'alerts', 'intel', 'nodes'];
export const MORE_IDS = ['mission', 'settings', 'osint'];
