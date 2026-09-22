#!/usr/bin/env node
/**
 * Serial → server bridge for bench testing a node over USB (no WiFi needed).
 *
 * The firmware echoes every uplink packet on its serial port as ">>{json}".
 * This script reads those lines and POSTs them to the server, and writes the
 * server's downlink (e.g. LIVE/ECO) back to the node as a console command.
 *
 *   npm install serialport            (once, in tools/)
 *   node tools/serial-bridge.js COM5 http://127.0.0.1:8787
 *   node tools/serial-bridge.js /dev/ttyUSB0 http://raspberrypi.local:8787
 *
 * Anything you type is forwarded to the node's console (cfg ..., live, eco, status).
 */
'use strict';
const readline = require('readline');

const [, , portPath, serverArg] = process.argv;
if (!portPath) {
  console.error('usage: node serial-bridge.js <serial-port> [server-url]');
  process.exit(1);
}
const server = (serverArg || 'http://127.0.0.1:8787').replace(/\/+$/, '');

let SerialPort;
try {
  ({ SerialPort } = require('serialport'));
} catch {
  console.error('missing dependency: run `npm install serialport` inside tools/');
  process.exit(1);
}

const port = new SerialPort({ path: portPath, baudRate: 115200 });
const lines = readline.createInterface({ input: port });
let sent = 0;

lines.on('line', async (line) => {
  if (!line.startsWith('>>')) { process.stdout.write(`[node] ${line}\n`); return; }
  let packet;
  try { packet = JSON.parse(line.slice(2)); } catch { return; }
  packet.tr = 'serial';
  try {
    const res = await fetch(`${server}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Transport': 'serial' }, body: JSON.stringify(packet) });
    const body = await res.json();
    sent++;
    process.stdout.write(`[bridge] #${sent} ${packet.id} seq=${packet.seq} -> ${res.status} ${body.level || ''}${body.alert ? ' ALERT ' + body.alert : ''}\n`);
    if (body.cmd && body.cmd.mode) port.write(`${body.cmd.mode === 'LIVE' ? 'live' : 'eco'}\n`);
    if (body.cmd && body.cmd.reboot) port.write('reboot\n');
  } catch (err) {
    process.stdout.write(`[bridge] server error: ${err.message}\n`);
  }
});

port.on('open', () => console.log(`[bridge] ${portPath} @115200 -> ${server}/api/ingest  (type console commands here)`));
port.on('error', (e) => { console.error('[bridge] serial error', e.message); process.exit(1); });

readline.createInterface({ input: process.stdin }).on('line', (l) => port.write(l + '\n'));
