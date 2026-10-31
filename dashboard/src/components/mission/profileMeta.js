import { Radiation, Mountain, ShieldAlert, Gem, Fence, Shield } from 'lucide-react';

const ICONS = { radiation: Radiation, nuclear: Radiation, mountain: Mountain, border: Mountain, tunnel: Mountain, 'shield-alert': ShieldAlert, shieldalert: ShieldAlert, gem: Gem, retail: Gem, jewelry: Gem, fence: Fence, perimeter: Fence };
const ACCENTS = {
  nuclear: { hex: '#f59e0b', text: 'text-amber-300', bg: 'bg-terminal-amber/10', ring: 'ring-terminal-amber/30' },
  border: { hex: '#38bdf8', text: 'text-sky-300', bg: 'bg-terminal-cyan/10', ring: 'ring-terminal-cyan/30' },
  retail: { hex: '#a78bfa', text: 'text-violet-300', bg: 'bg-terminal-violet/10', ring: 'ring-terminal-violet/30' },
  perimeter: { hex: '#22c55e', text: 'text-green-300', bg: 'bg-terminal-green/10', ring: 'ring-terminal-green/30' }
};
const DEFAULT_ACCENT = { hex: '#3b82f6', text: 'text-blue-300', bg: 'bg-terminal-blue/10', ring: 'ring-terminal-blue/30' };

/** Lucide icon for a mission profile (by its `icon` hint, then its id). */
export const profileIcon = (p) => {
  if (!p) return Shield;
  const hint = String(p.icon || '').toLowerCase().replace(/[\s_]/g, '-');
  return ICONS[hint] || ICONS[hint.replace(/-/g, '')] || ICONS[p.id] || Shield;
};

export const profileAccent = (p) => (p && ACCENTS[p.id]) || DEFAULT_ACCENT;

export const deterrentLabel = (p) => (p && p.deterrent === 'silent' ? 'Silent alarm' : 'Audible siren on node');
