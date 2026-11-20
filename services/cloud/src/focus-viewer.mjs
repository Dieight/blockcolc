import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { ApiError, fail } from './wire.mjs';
import { FocusViewerStore, VIEWER_SESSION_SECONDS } from './focus-viewer-store.mjs';

const COOKIE = '__Host-blockcolc_viewer';
const COOKIES = 'Path=/; HttpOnly; Secure; SameSite=Lax';
const STATIC = {
  '/': ['account.html', 'text/html'],
  '/account.js': ['account.js', 'text/javascript'],
  '/account.css': ['account.css', 'text/css'],
  '/viewer.js': ['viewer.js', 'text/javascript'],
  '/viewer.css': ['viewer.css', 'text/css'],
};

const escapeHtml = text => text.replace(/[&<>"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[character]);

function legalPage(language) {
  const file = new URL(`../policy/${language}.md`, import.meta.url);
  const parts = readFileSync(file, 'utf8').trim().split(/\r?\n\r?\n/);
  const title = escapeHtml(parts.shift().replace(/^# /, ''));
  const sections = parts.map(part => part.startsWith('## ')
    ? `<h2>${escapeHtml(part.slice(3))}</h2>`
    : `<p>${escapeHtml(part)}</p>`).join('\n');
  return Buffer.from(`<!doctype html>
<html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><link rel="stylesheet" href="/viewer.css"><link rel="stylesheet" href="/account.css">
<main class="report"><nav><a href="/">BLOCKCOLC</a> · <a href="/legal">简体中文</a> · <a href="/legal/en">English</a></nav>
<article><h1>${title}</h1>${sections}<p><a href="https://github.com/Dieight/blockcolc">GitHub · Blockcolc</a></p></article></main></html>`);
}

async function credentials(req) {
  fail(req.headers['content-type']?.split(';', 1)[0] === 'application/json' && !req.headers['content-encoding'], 'JSON_REQUIRED', 415);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    fail(bytes <= 8192, 'REQUEST_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
  } catch {
    throw new ApiError(400, 'INVALID_JSON');
  }
  fail(input && typeof input === 'object' && !Array.isArray(input));
  fail(input.timeZone === undefined || typeof input.timeZone === 'string' && input.timeZone.length <= 80, 'INVALID_TIME_ZONE');
  return input;
}

function params(url, names) {
  const keys = [...url.searchParams.keys()];
  fail(new Set(keys).size === keys.length && keys.every(key => names.includes(key)), 'INVALID_QUERY');
  return url.searchParams;
}

function page(query, key) {
  const raw = query.get(key) ?? '1';
  fail(/^[1-9][0-9]{0,4}$/.test(raw), 'INVALID_QUERY');
  return Number(raw);
}

export function createFocusViewer(cloud, { owner, from, origin, webRoot, onError = () => {} }) {
  const site = new URL(origin);
  fail(site.protocol === 'https:' && site.origin === origin);
  const store = new FocusViewerStore(cloud, { owner, from });
  const assets = new Map(Object.entries(STATIC).map(([route, [name, type]]) =>
    [route, { type, body: readFileSync(join(webRoot, name)) }]));
  assets.set('/legal', { type:'text/html', body:legalPage('zh-CN') });
  assets.set('/legal/en', { type:'text/html', body:legalPage('en') });
  const streams = new Map();
  const limits = new Map();
  let ticks = 0;

  function limit(key, max, duration) {
    const now = Date.now();
    let entry = limits.get(key);
    if (!entry || entry.until <= now) {
      if (limits.size >= 8192) {
        for (const [id, value] of limits) if (value.until <= now) limits.delete(id);
        fail(limits.size < 8192 || limits.has(key), 'RATE_LIMIT', 429);
      }
      entry = { until: now + duration, count: 0 };
      limits.set(key, entry);
    }
    fail(++entry.count <= max, 'RATE_LIMIT', 429);
  }

  const interval = setInterval(() => {
    try {
      if (++ticks % 30 === 0) store.prune();
      if (!streams.size) return;
      const snapshot = store.snapshot();
      const fingerprint = JSON.stringify([snapshot.live, snapshot.daysVersion]);
      for (const [res, stream] of streams) {
        if (!store.session(stream.token)) res.end();
        else if (stream.fingerprint !== fingerprint) {
          stream.fingerprint = fingerprint;
          if (!res.write('event: snapshot\ndata: ' + JSON.stringify(snapshot) + '\n\n')) res.end();
        } else if (ticks % 10 === 0 && !res.write(': keepalive\n\n')) res.end();
      }
    } catch (error) {
      onError(error.constructor.name);
      for (const res of streams.keys()) res.end();
    }
  }, 2000);
  interval.unref();

  const server = createServer({ maxHeaderSize: 8192, headersTimeout: 10_000, requestTimeout: 20_000 }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (value, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    try {
      fail(req.headers.host === site.host && req.url?.startsWith('/') && req.url.length <= 256, 'INVALID_REQUEST');
      const url = new URL(req.url, origin);
      fail(url.origin === origin, 'INVALID_REQUEST');
      const path = url.pathname, method = req.method;
      const asset = assets.get(path);
      if (asset && ['GET', 'HEAD'].includes(method)) {
        res.writeHead(200, { 'Content-Type': asset.type + '; charset=utf-8', 'Content-Length': asset.body.length, 'Cache-Control': 'no-cache' });
        res.end(method === 'HEAD' ? undefined : asset.body);
        return;
      }
      if (method === 'GET' && path === '/healthz') return send({ ok: true, viewer: 'account' });
      const forwarded = req.headers['x-blockcolc-client-ip'];
      const remote = req.socket.remoteAddress;
      const peer = remote === '127.0.0.1' && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : remote;
      limit('request:' + peer, 180, 60_000);
      if (method === 'POST') fail(req.headers.origin === origin, 'FORBIDDEN', 403);
      if (method === 'POST' && ['/api/login', '/api/register'].includes(path)) {
        params(url, []);
        limit('auth:' + peer, 12, 600_000);
        if (path === '/api/register') limit('registration:' + peer, 6, 3_600_000);
        const token = await store.signIn(path.slice('/api/'.length), await credentials(req));
        res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${COOKIES}; Max-Age=${VIEWER_SESSION_SECONDS}`);
        return send({ ok: true });
      }
      const token = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
      const session = store.session(token);
      fail(session, 'UNAUTHORIZED', 401);
      if (method === 'GET' && path === '/api/account') {
        params(url, []);
        return send({ username: session.username, owner: session.id === owner });
      }
      if (method === 'POST' && path === '/api/logout') {
        params(url, []);
        store.logout(session);
        for (const [stream, state] of streams) if (state.token === token) stream.end();
        res.setHeader('Set-Cookie', `${COOKIE}=; ${COOKIES}; Max-Age=0`);
        return send({ ok: true });
      }
      if (method === 'POST' && path === '/api/password') {
        params(url, []);
        limit('password:' + session.id, 12, 600_000);
        await store.changePassword(session, await credentials(req));
        return send({ ok: true });
      }
      if (method === 'POST' && path === '/api/visit') {
        params(url, []);
        store.recordVisit(session);
        return send({ ok: true });
      }
      if (method === 'GET' && path === '/api/visits') {
        const q = params(url, ['todayPage', 'rankPage']);
        return send(store.visits(session, page(q, 'todayPage'), page(q, 'rankPage')));
      }
      if (method === 'GET' && path === '/api/live') {
        params(url, []);
        return send(store.snapshot());
      }
      if (method === 'GET' && path === '/api/days') {
        const q = params(url, ['from', 'through']);
        return send(store.days(q.get('from'), q.get('through')));
      }
      if (method === 'GET' && path === '/api/events') {
        params(url, []);
        const open = [...streams.values()];
        fail(open.length < 96 && open.filter(stream => stream.user === session.id).length < 4 &&
          open.filter(stream => stream.peer === peer).length < 12, 'RATE_LIMIT', 429);
        const snapshot = store.snapshot();
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform' });
        streams.set(res, { token, peer, user: session.id, fingerprint: JSON.stringify([snapshot.live, snapshot.daysVersion]) });
        res.once('close', () => streams.delete(res));
        res.write('event: snapshot\ndata: ' + JSON.stringify(snapshot) + '\n\n');
        return;
      }
      throw new ApiError(404, 'NOT_FOUND');
    } catch (error) {
      if (res.headersSent) return res.destroy();
      if (!(error instanceof ApiError)) {
        onError(error.constructor.name);
        return send({ error: 'REQUEST_FAILED' }, 500);
      }
      if (error.status === 429) res.setHeader('Retry-After', '60');
      send({ error: error.code }, error.status);
    }
  });
  server.once('close', () => clearInterval(interval));
  return server;
}
