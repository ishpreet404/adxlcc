#!/usr/bin/env node
/**
 * Stand-alone node emulator: behaves like an ESP32 running firmware 2.x, talking to the
 * server over HTTP exactly like real hardware (ECO heartbeats, LIVE streaming, downlink
 * commands).  Useful for testing the server from another machine, or for load testing.
 *
 *   node tools/node-emulator.js --server http://127.0.0.1:8787 --id N1 --live
 *   node tools/node-emulator.js --id N7 --walk        # a person walks past every ~40 s
 */
'use strict';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def; };
const server = String(opt('server', 'http://127.0.0.1:8787')).replace(/\/+$/, '');
const id = String(opt('id', 'EMU-1'));
const walk = Boolean(opt('walk', false));
let mode = opt('live', false) ? 'LIVE' : 'ECO';
let liveUntil = mode === 'LIVE' ? Date.now() + 300000 : 0;

const FS = 100;
let seq = 0, t = 0, battery = 91;
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

function walkerDistance() {
  if (!walk) return 99;
  const cycle = (t % 40);               // every 40 s: approach from 12 m to 1.5 m and leave
  return Math.abs(12 - cycle * 1.2) + 1.5;
}

function synth(n, dist, probeOffset) {
  const out = [];
  const amp = dist < 12 ? 0.8 * Math.pow(1 / dist, 1.2) : 0;
  for (let i = 0; i < n; i++) {
    const tt = t + i / FS;
    let v = gauss() * 0.008;
    const phase = ((tt + probeOffset) % 0.53);
    if (amp > 0 && phase < 0.45) v += amp * Math.exp(-phase * 14) * Math.sin(2 * Math.PI * 11 * phase);
    out.push(v);
  }
  return out;
}

const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

async function tick() {
  const live = mode === 'LIVE';
  const dt = live ? 0.25 : 1;
  t += dt;
  const d = walkerDistance();
  const wa = synth(Math.round(dt * FS), d, 0);
  const wb = synth(Math.round(dt * FS), d + 0.4, 0.003);
  const ra = rms(wa), rb = rms(wb);
  const radarSees = d < 8 && Math.random() > 0.05;
  const active = ra > 0.02 || radarSees;
  battery = Math.max(3, battery - 0.0005);
  const packet = {
    v: 2, id, seq: ++seq, up: Math.round(t * 1000), fw: '2.0.0-emu', tr: 'wifi', rssi: -55 + Math.round(gauss() * 3),
    mode, st: radarSees && ra > 0.02 ? 'EVENT' : active ? 'SUSPECT' : 'IDLE',
    bat: { v: Number((3.3 + 0.9 * battery / 100).toFixed(2)), p: Math.round(battery) },
    radar: { ok: true, pres: radarSees, mov: radarSees ? 1 : 0, dist: radarSees ? Number((d + gauss() * 0.15).toFixed(2)) : 0, eng: radarSees ? Math.round(100 * (1 - d / 9)) : 3 },
    a: { ok: true, x: 0.01, y: -0.01, z: 0.99, rms: Number(ra.toFixed(4)), peak: Number(Math.max(...wa.map(Math.abs)).toFixed(4)), sl: Number((ra / 0.008).toFixed(2)) },
    b: { ok: true, x: 0.0, y: 0.01, z: 0.98, rms: Number(rb.toFixed(4)), peak: Number(Math.max(...wb.map(Math.abs)).toFixed(4)), sl: Number((rb / 0.008).toFixed(2)) },
    seis: { lag: Number((-2.5 * (rb - ra) / (ra + rb + 1e-6)).toFixed(2)), corr: active ? 0.8 : 0.1, ratio: Number((ra / (rb || 1e-4)).toFixed(3)) },
    wave: live ? { fs: FS, a: wa.map(v => Math.round(v * 1000)), b: wb.map(v => Math.round(v * 1000)) } : undefined,
    sys: { heap: 190000, tmp: 34.5 }
  };
  // heartbeat-only cadence in ECO when quiet (like the firmware: 1 packet/s while active, else every 60 s)
  if (!live && !active && seq % 60 !== 1) return;
  try {
    const res = await fetch(`${server}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(packet) });
    const body = await res.json();
    if (body.cmd && body.cmd.mode) { mode = body.cmd.mode; liveUntil = mode === 'LIVE' ? Date.now() + (body.cmd.liveFor || 300) * 1000 : 0; console.log(`[${id}] downlink → ${mode}`); }
    if (seq % 20 === 0 || body.alert) console.log(`[${id}] seq=${seq} mode=${mode} d=${d.toFixed(1)} rmsA=${ra.toFixed(3)} → ${body.level}${body.alert ? ' ALERT ' + body.alert : ''}`);
  } catch (err) {
    console.log(`[${id}] uplink failed: ${err.message}`);
  }
  if (mode === 'LIVE' && Date.now() > liveUntil) { mode = 'ECO'; console.log(`[${id}] LIVE expired → ECO`); }
}

console.log(`[${id}] emulating node → ${server} (mode ${mode}${walk ? ', walker scenario' : ''})`);
(async function loop() { for (;;) { await tick(); await new Promise(r => setTimeout(r, mode === 'LIVE' ? 250 : 1000)); } })();
