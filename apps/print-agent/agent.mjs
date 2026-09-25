#!/usr/bin/env node
/**
 * New Chapter print agent.
 *
 * Why this exists: the API may run in the cloud, but the printers sit on the cafe's Wi-Fi
 * where the cloud can't reach them. This agent runs on any always-on machine in the cafe
 * (the cashier PC, a Raspberry Pi), asks the API for print jobs every second, sends the
 * ready-made ESC/POS bytes to each printer's IP on port 9100, and reports back.
 *
 * No dependencies — just Node 18+.
 *
 *   API_URL=https://pos.example.com   (the web app's address; /api is proxied)
 *   AGENT_KEY=pa_...                  (from Manage → Kitchen & printers → New agent key)
 *   POLL_MS=1000                      (optional)
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Minimal .env loader (KEY=value lines next to this file).
const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const API_URL = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const AGENT_KEY = process.env.AGENT_KEY;
const POLL_MS = Number(process.env.POLL_MS ?? 1000);
const HEARTBEAT_MS = 15_000;

if (!AGENT_KEY) {
  console.error('AGENT_KEY is missing. Create one in Manage → Kitchen & printers, then put it in apps/print-agent/.env');
  process.exit(1);
}

const log = (...args) => console.log(new Date().toISOString(), ...args);

async function call(method, route, body) {
  const res = await fetch(`${API_URL}/api/v1${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': AGENT_KEY },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) {
    console.error('The API rejected the agent key (revoked or wrong). Stopping.');
    process.exit(2);
  }
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status}`);
  return res.json();
}

function sendToPrinter(host, port, data, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    if (!host) return reject(new Error('Printer has no IP address'));
    const socket = net.createConnection({ host, port });
    const fail = (err) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error(`No answer from ${host}:${port}`)));
    socket.once('error', (e) => fail(new Error(`${host}:${port} ${e.code ?? e.message}`)));
    socket.once('connect', () => socket.end(data, resolve));
  });
}

/** Can we open a TCP connection to the printer? Used for the online/offline light in the admin. */
function probe(host, port) {
  return new Promise((resolve) => {
    if (!host) return resolve({ online: false, error: 'No IP address' });
    const socket = net.createConnection({ host, port });
    socket.setTimeout(2500, () => {
      socket.destroy();
      resolve({ online: false, error: 'Timed out' });
    });
    socket.once('error', (e) => resolve({ online: false, error: e.code ?? e.message }));
    socket.once('connect', () => {
      socket.destroy();
      resolve({ online: true });
    });
  });
}

// Printers are handled one job at a time each, so tickets never interleave on paper.
const busyPrinters = new Set();

async function processJob(job) {
  const key = job.printer.id;
  while (busyPrinters.has(key)) await new Promise((r) => setTimeout(r, 50));
  busyPrinters.add(key);
  try {
    await sendToPrinter(job.printer.host, job.printer.port, Buffer.from(job.data, 'base64'));
    await call('POST', `/print-agent/jobs/${job.id}/result`, { ok: true });
    log(`printed ${job.id} on ${job.printer.name}`);
  } catch (err) {
    log(`FAILED ${job.id} on ${job.printer.name}: ${err.message}`);
    await call('POST', `/print-agent/jobs/${job.id}/result`, { ok: false, error: err.message }).catch(() => undefined);
  } finally {
    busyPrinters.delete(key);
  }
}

let knownPrinters = [];
let apiDown = false;

async function heartbeat() {
  try {
    const statuses = await Promise.all(knownPrinters.map(async (p) => ({ id: p.id, ...(await probe(p.host, p.port)) })));
    const res = await call('POST', '/print-agent/heartbeat', { printers: statuses });
    knownPrinters = res.printers;
  } catch (err) {
    log(`heartbeat failed: ${err.message}`);
  }
}

async function loop() {
  for (;;) {
    try {
      const jobs = await call('POST', '/print-agent/claim');
      if (apiDown) log('connected to API again');
      apiDown = false;
      await Promise.all(jobs.map(processJob));
      if (jobs.length) continue; // more may be waiting
    } catch (err) {
      if (!apiDown) log(`cannot reach API (${err.message}); retrying`);
      apiDown = true;
    }
    await new Promise((r) => setTimeout(r, apiDown ? 5000 : POLL_MS));
  }
}

log(`print agent starting → ${API_URL}`);
await heartbeat();
setInterval(heartbeat, HEARTBEAT_MS);
loop();

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
