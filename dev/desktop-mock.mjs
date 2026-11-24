#!/usr/bin/env node
// Fake ax-kit Mac for the desktop app: the iOS repo's mock (../ax-kit-ios/dev/mock-server.mjs) plus what only the
// desktop app asks for (PROTOCOL-REQUESTS.md D-items): place coordinates, routes between today's plans, stats.
// No dependencies. Run: node dev/desktop-mock.mjs [--port 47795]   (it starts the iOS mock itself on port+1)
// The extension modules in dev/mock/*.mjs are the spec examples for the server.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as routes from './mock/routes.mjs';
import * as stats from './mock/stats.mjs';
import * as instructions from './mock/instructions.mjs';
import * as browserLive from './mock/browserlive.mjs';
import * as projects from './mock/projects.mjs';
import * as teamPlan from './mock/teamplan.mjs';
import * as work from './mock/work.mjs';
import * as firstLook from './mock/firstlook.mjs';
import * as people from './mock/people.mjs';
import * as dictation from './mock/dictation.mjs';
import * as appUpdates from './mock/appupdates.mjs';

const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) || 47795;
const UP = PORT + 1;
const IOS_MOCK = process.env.IOS_MOCK ?? fileURLToPath(new URL('../../ax-kit-ios/dev/mock-server.mjs', import.meta.url));
if (!existsSync(IOS_MOCK)) {
  console.error(`iOS 가짜 맥을 찾지 못했어요: ${IOS_MOCK} (IOS_MOCK=경로 로 알려 주세요)`);
  process.exit(1);
}
const child = spawn(process.execPath, [IOS_MOCK, '--port', String(UP)], { stdio: ['ignore', 'ignore', 'inherit'] });
process.on('exit', () => child.kill());
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child.kill(); process.exit(0); });

/** Extensions, in order. Each may `handle` a request (return true when it answered) or `augment` a JSON reply. */
const extensions = [routes, stats, instructions, browserLive, projects, teamPlan, work, firstLook, people, dictation, appUpdates];

const send = (res, status, body) => {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
};

/** Calls the iOS mock and returns parsed JSON (for extensions that build on its data). */
export function upstream(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: UP, path, headers: { Authorization: `Bearer ${token}` } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

/** POSTs JSON to the iOS mock (e.g. the owner's "계속해 주세요" after browser-live `done`). */
export function upstreamPost(path, token, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: UP, path, method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.end(data);
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://mock.local');
  const path = url.pathname.startsWith('/m/v1/app/') ? url.pathname.slice('/m/v1/app/'.length) : null;
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  try {
    if (path !== null && token.startsWith('mock-')) {
      for (const ext of extensions) {
        if (ext.handle && (await ext.handle({ req, res, path, url, token, send, upstream, upstreamPost }))) return;
      }
    }
    if (url.pathname === '/dev/firstlook') { firstLook.devReset(url.searchParams); return send(res, 200, { ok: true }); }
    if (url.pathname === '/dev/update') { appUpdates.devReset(url.searchParams); return send(res, 200, { ok: true }); }
    if (url.pathname === '/dev/people') { people.devReset(url.searchParams); return send(res, 200, { ok: true }); }
    if (url.pathname === '/dev/dictation') { dictation.devReset(url.searchParams); return send(res, 200, { ok: true }); }
    if (url.pathname === '/dev/work') { work.devReset(url.searchParams); return send(res, 200, { ok: true }); }
    if (url.pathname === '/dev/plan') { teamPlan.devReset(url.searchParams); return send(res, 200, { ok: true }); }
    if (url.pathname === '/dev/live') { browserLive.devReset(url.searchParams, upstream); return send(res, 200, { ok: true }); }
    const isStream = path === 'stream';
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
    const up = http.request({ host: '127.0.0.1', port: UP, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${UP}` } }, async (ur) => {
      const wantsAugment = path !== null && !isStream && (ur.headers['content-type'] ?? '').includes('application/json') && extensions.some((e) => e.augment);
      if (!wantsAugment) {
        res.writeHead(ur.statusCode ?? 502, ur.headers);
        ur.pipe(res);
        return;
      }
      const raw = await readBody(ur);
      let json;
      try { json = JSON.parse(raw.toString('utf8')); } catch { res.writeHead(ur.statusCode ?? 502, ur.headers); res.end(raw); return; }
      for (const ext of extensions) if (ext.augment) json = (await ext.augment({ path, url, json, token, upstream })) ?? json;
      send(res, ur.statusCode ?? 200, json);
    });
    up.on('error', () => send(res, 502, { ok: false, error: 'upstream' }));
    if (body) up.write(body);
    up.end();
    req.on('close', () => { if (isStream) up.destroy(); });
  } catch (error) {
    console.error(error);
    send(res, 500, { ok: false });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`데스크톱용 가짜 맥: http://127.0.0.1:${PORT} (안쪽 iOS 가짜 맥: ${UP})`);
  console.log(`앱: AXKIT_DEV_MOCK=http://127.0.0.1:${PORT} npm run tauri dev`);
});
