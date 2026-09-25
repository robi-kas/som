#!/usr/bin/env node
/**
 * `npm run dev` — starts everything for local development in one terminal:
 *   1. the Postgres container (docker compose v2 or the older docker-compose),
 *   2. the NestJS API   (apps/api, http://localhost:3001),
 *   3. the Next.js web  (apps/web, http://localhost:3000),
 * with each line labelled [api] / [web]. Ctrl+C stops all of them — nothing is left running.
 */
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const color = { db: '\x1b[35m', api: '\x1b[36m', web: '\x1b[32m', reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m' };
const log = (name, msg) => process.stdout.write(`${color[name] ?? ''}[${name}]${color.reset} ${msg}\n`);

// npm sets workspace variables when a script runs via -w; the Nest CLI then fails with
// ENOWORKSPACES. Give the children a clean environment.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_config_workspace/i.test(k)));

function startDatabase() {
  const tries = [
    ['docker', ['compose', 'up', '-d', 'db']],
    ['docker-compose', ['up', '-d', 'db']],
  ];
  for (const [cmd, args] of tries) {
    const r = spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8' });
    if (r.status === 0) {
      log('db', 'Postgres container is up');
      return true;
    }
    const out = `${r.stderr ?? ''}${r.stdout ?? ''}`;
    if (/permission denied/i.test(out)) {
      log('db', `${color.red}Docker says "permission denied". Run: sudo usermod -aG docker $USER  then log out and back in.${color.reset}`);
      return false;
    }
  }
  log('db', `${color.red}Could not start the database with docker. Is Docker installed and running?${color.reset}`);
  return false;
}

function waitForPort(port, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const s = net.createConnection({ host: '127.0.0.1', port });
      s.once('connect', () => {
        s.destroy();
        resolve(true);
      });
      s.once('error', () => {
        s.destroy();
        if (Date.now() > until) resolve(false);
        else setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

const children = [];
let lastHint = 0;
function apiDownHint() {
  if (Date.now() - lastHint < 30_000) return; // at most once every 30 s
  lastHint = Date.now();
  log('web', `${color.dim}can't reach the API on :3001 yet — it's starting, or it has an error (look for red [api] lines above)${color.reset}`);
}
function run(name, cwd, args) {
  const child = spawn('npm', args, { cwd: path.join(root, cwd), env, detached: process.platform !== 'win32' });
  children.push(child);
  let skippingProxyError = false;
  const pipe = (stream) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        // The website can't reach the API (still starting, or it failed to compile). Next.js
        // prints a 10-line stack for every request; show one short hint instead.
        if (name === 'web' && (/Failed to proxy .*ECONNREFUSED/.test(line) || /^Error: connect ECONNREFUSED/.test(line))) {
          skippingProxyError = true;
          apiDownHint();
          continue;
        }
        if (skippingProxyError) {
          if (line.trim() === '}') skippingProxyError = false;
          continue;
        }
        // Make TypeScript errors from the API impossible to miss.
        if (name === 'api' && (/error TS\d+/.test(line) || /Found [1-9]\d* errors?/.test(line))) {
          log(name, `${color.red}${line}${color.reset}`);
          if (/Found [1-9]\d* errors?/.test(line)) log(name, `${color.red}The API did not start. Send these red lines to fix them.${color.reset}`);
          continue;
        }
        log(name, line);
      }
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    log(name, `${color.dim}stopped${code ? ` (exit ${code})` : ''}${color.reset}`);
    if (!stopping) shutdown(code ?? 1);
  });
  return child;
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    try {
      // Kill the whole process group, so nest/next child processes don't linger on the ports.
      if (process.platform === 'win32') c.kill();
      else process.kill(-c.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 1500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

startDatabase();
log('db', 'waiting for Postgres on localhost:5433 …');
if (!(await waitForPort(5433))) {
  log('db', `${color.red}Postgres did not answer on port 5433. The API will fail until it does.${color.reset}`);
} else {
  log('db', 'ready');
  // Apply any new migrations and refresh the Prisma client, so a code update that adds a
  // column never leaves the API failing to compile against an old database/client.
  for (const args of [['prisma', 'migrate', 'deploy'], ['prisma', 'generate']]) {
    const r = spawnSync('npx', args, { cwd: path.join(root, 'apps/api'), env, encoding: 'utf8' });
    if (r.status !== 0) {
      log('db', `${color.red}"prisma ${args[1]}" failed:${color.reset}\n${r.stderr || r.stdout}`);
      break;
    }
    log('db', args[1] === 'migrate' ? 'database is up to date' : 'Prisma client generated');
  }
}

run('api', 'apps/api', ['run', 'start:dev']);
run('web', 'apps/web', ['run', 'dev']);
log('web', `${color.dim}open http://localhost:3000 once [api] says "Nest application successfully started"${color.reset}`);
// Phones and tablets on the same Wi-Fi / hotspot open one of these.
const lan = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => `http://${i.address}:3000`);
if (lan.length) log('web', `on a phone (same Wi-Fi or hotspot): ${lan.join('  or  ')}`);
