import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { CloudStore } from '../src/store.mjs';
import { createFocusViewer } from '../src/focus-viewer.mjs';
import { createCloudHandler } from '../src/server.mjs';
import { canonical, sha } from '../src/wire.mjs';

const origin = 'https://focus.test';
const password = 'synthetic password for tests';
const ownerDevice = 'existing_phone_device_0001';
const cookieName = '__Host-blockcolc_viewer';

test('account viewer keeps mobile execution, scope, visit counts and live data separate', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'blockcolc-focus-viewer-'));
  let now = Date.parse('2026-11-15T15:44:30Z');
  const store = new CloudStore(directory, { clock: () => now });
  const registered = await store.register({ username: 'TestOwner', name: 'Test owner', password, deviceId: ownerDevice, deviceName: 'Phone' });
  const phone = store.authenticate(registered.token);
  store.claim(phone, { generation: 0 });
  const putHistory = (id, startedAt, actualDurationMs) => {
    const wire = canonical({ ordinal: 0, value: { startedAt, actualDurationMs } });
    store.db.prepare('INSERT INTO entries VALUES(?,?,?,?)').run(phone.user, 'focusHistory/' + id, wire, sha(wire));
  };
  putHistory('one', '2026-11-15T14:00:00Z', 1_800_000);
  putHistory('two', '2026-11-14T15:45:00Z', 1_800_000);
  const snapshot = {
    currentName: 'Synthetic live focus', startedAt: '2026-11-15T15:40:00Z',
    estimatedEndsAt: '2026-11-15T15:46:00Z', estimatedElapsedMs: 270_000, todayActualFocusMs: 2_700_000,
  };
  store.presence(phone, snapshot, 1);
  for (const file of ['account.html', 'account.js', 'account.css', 'viewer.css', 'viewer.js']) writeFileSync(join(directory, file), file);
  const server = createFocusViewer(store, { owner: phone.user, from: '2026-11-14', origin, webRoot: directory, integrationHandler: createCloudHandler(store) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    const stopped = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await stopped;
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (path, { cookie, input, from = origin, apiToken, method = input === undefined ? 'GET' : 'POST' } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(base + path, {
      method,
      headers: {
        Host: 'focus.test',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(apiToken ? { Authorization: 'Bearer ' + apiToken } : {}),
        ...(input !== undefined ? { Origin: from, 'Content-Type': 'application/json' } : {}),
      },
    }, res => resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers: res.headers })));
    req.on('error', reject);
    req.end(input === undefined ? undefined : JSON.stringify(input));
  });
  const partner = store.integrations.issue(phone,{name:'Partner',uploadFocus:true,readFriends:true,days:30}).token;
  const externalRead = await request('/v1/integrations/friends',{apiToken:partner});
  assert.equal(externalRead.status,200);
  assert.deepEqual((await externalRead.json()).friends,[]);
  const externalStart = await request('/v1/integrations/focus',{apiToken:partner,method:'PUT',input:{state:'focus',sessionId:'viewer-test',sequence:1}});
  assert.equal(externalStart.status,409);
  assert.equal((await externalStart.json()).error,'NATIVE_FOCUS_IN_PROGRESS');
  assert.notEqual((await request('/v1/integrations/manage',{apiToken:registered.token})).status,200);
  assert.notEqual((await request('/v1/workspace',{apiToken:registered.token})).status,200);
  const login = async (action, username, credential = password) => {
    const response = await request('/api/' + action, { input: { username, password: credential } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, new RegExp('^' + cookieName + '=[\u0041-Za-z0-9_-]+; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='));
    return cookie.split(';')[0];
  };

  assert.equal((await request('/')).status, 200);
  for (const [path, title] of [['/legal', '方块钟云服务条款与隐私说明'], ['/legal/en', 'Blockcolc Cloud Terms and Privacy Notice']]) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.ok((await response.text()).includes(title));
  }
  for (const route of ['/api/live', '/api/events', '/api/visits', '/api/days?from=2026-11-14&through=2026-11-15']) {
    assert.equal((await request(route, { cookie: 'relay_session=retired-invite' })).status, 401);
  }
  assert.equal((await request('/api/login', { input: { username: 'TestOwner', password }, from: 'https://different.test' })).status, 403);
  const wrong = await request('/api/login', { input: { username: 'TestOwner', password: 'different password' } });
  assert.equal(wrong.status, 401);

  const owner = await login('login', 'TESTOWNER');
  const guest = await login('register', 'Guest_One');
  const secondGuest = await login('register', 'guest_two');
  assert.deepEqual(await (await request('/api/account', { cookie: guest })).json(), { username: 'guest_one', owner: false });
  assert.equal((await request('/v1/workspace', { cookie: guest })).status, 404);
  assert.equal((await request('/api/visits', { cookie: guest })).status, 403);
  assert.equal((await request('/api/visit', { cookie: guest, input: {}, from: 'https://different.test' })).status, 403);

  const live = await (await request('/api/live', { cookie: guest })).json();
  assert.equal(live.live.snapshot.currentName, snapshot.currentName);
  assert.equal(live.live.snapshot.todayActualFocusMs, 2_700_000);
  assert.equal(live.live.snapshot.estimatedElapsedMs, 270_000);
  const stream = await request('/api/events', { cookie: guest });
  const reader = stream.body.getReader();
  const initialEvent = new TextDecoder().decode((await reader.read()).value);
  assert.match(initialEvent, /event: snapshot\ndata:/);
  assert.match(initialEvent, /Synthetic live focus/);
  const days = await (await request('/api/days?from=2026-11-13&through=2026-11-17', { cookie: guest })).json();
  assert.deepEqual(days.days, [
    { date: '2026-11-14', actualFocusMs: 900_000, confirmed: true },
    { date: '2026-11-15', actualFocusMs: 2_700_000, confirmed: false },
  ]);
  assert.equal((await request('/api/days?from=2026-02-30&through=2026-11-17', { cookie: guest })).status, 400);

  await request('/api/visit', { cookie: guest, input: {} });
  await request('/api/visit', { cookie: guest, input: {} });
  await request('/api/visit', { cookie: secondGuest, input: {} });
  await request('/api/visit', { cookie: owner, input: {} });
  const first = await (await request('/api/visits', { cookie: owner })).json();
  assert.equal(first.today.rows.length, 2);
  assert.deepEqual(first.ranking.rows.map(row => [row.username,row.visits]), [['guest_one', 1], ['guest_two', 1]]);
  now += 300_000;
  await request('/api/visit', { cookie: guest, input: {} });
  const expiredEvent = new TextDecoder().decode((await reader.read()).value);
  assert.match(expiredEvent, /"currentName":null/);
  await reader.cancel();
  const second = await (await request('/api/visits', { cookie: owner })).json();
  assert.equal(second.today.rows[0].at, now);
  assert.deepEqual(second.ranking.rows[0], { username: 'guest_one', visits: 2 });

  now = Date.parse('2026-11-15T16:01:00Z');
  await request('/api/visit', { cookie: guest, input: {} });
  const localMidnight = await (await request('/api/visits', { cookie: owner })).json();
  assert.equal(localMidnight.day, '2026-11-16');
  assert.deepEqual(localMidnight.today.rows, [{ username: 'guest_one', at: now }]);
  assert.deepEqual(localMidnight.ranking.rows[0], { username: 'guest_one', visits: 3 });
  const afterMidnight = await (await request('/api/days?from=2026-11-15&through=2026-11-16', { cookie: guest })).json();
  assert.equal(afterMidnight.days[0].confirmed, true);
  assert.ok(afterMidnight.daysVersion > days.daysVersion);

  await request('/api/logout', { cookie: guest, input: {} });
  assert.equal((await request('/api/live', { cookie: guest })).status, 401);
  const appGuest = await store.login({ username: 'guest_one', password, deviceId: 'viewer_created_phone_00001', deviceName: 'Guest phone' });
  assert.equal(appGuest.account.username, 'guest_one');
  assert.deepEqual(store.devices(phone).map(device => device.id), [ownerDevice]);
  assert.equal(store.head(phone.user).owner, ownerDevice);
  await store.changePassword(phone, { currentPassword: password, password: 'new synthetic password' });
  assert.equal((await request('/api/visits', { cookie: owner })).status, 401);
  assert.equal(store.authenticate(registered.token).user, phone.user);
  const primary = await login('login', 'testowner', 'new synthetic password');
  const sibling = await login('login', 'testowner', 'new synthetic password');
  const change = (currentPassword, password) => request('/api/password', { cookie: primary, input: { currentPassword, password } });
  const wrongPassword = await change(password, 'different new synthetic password');
  assert.equal(wrongPassword.status, 400);
  assert.deepEqual(await wrongPassword.json(), { error: 'CURRENT_PASSWORD_INVALID' });
  const unmodified = await change('new synthetic password', 'new synthetic password');
  assert.equal(unmodified.status, 400);
  assert.deepEqual(await unmodified.json(), { error: 'PASSWORD_UNCHANGED' });
  const last = 'last synthetic viewer password';
  assert.equal((await change('new synthetic password', last)).status, 200);
  assert.equal((await request('/api/visits', { cookie: primary })).status, 200);
  assert.equal((await request('/api/visits', { cookie: sibling })).status, 401);
  assert.throws(() => store.authenticate(registered.token), { code: 'UNAUTHORIZED' });
  assert.equal((await request('/api/login', { input: { username: 'testowner', password: 'new synthetic password' } })).status, 401);
  await login('login', 'testowner', last);
  const appOwner = await store.login({ username: 'testowner', password: last, deviceId: ownerDevice, deviceName: 'Phone' });
  assert.equal(store.authenticate(appOwner.token).user, phone.user);
  assert.equal(store.head(phone.user).owner, ownerDevice);
});
