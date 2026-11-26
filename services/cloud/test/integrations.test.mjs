import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudStore } from '../src/store.mjs';
import { createCloudServer } from '../src/server.mjs';
import { assembleDomain, canonical, sha, splitDomain } from '../src/wire.mjs';
import { completedPomodorosOn, createInitialState, execute } from '../build/domain.mjs';

const minute = 60000;
const start = Date.parse('2026-11-15T08:00:00Z');
const prefs = {
  focusMinutes: 45, habitFocusMinutes: 25, habitTargetRounds: 12, breakMinutes: 5, focusGlassTransparency: 80,
  lightingQuality: 'cinematic', constructionOutlineVisibility: 'current', themeMode: 'system', fontStyle: 'pixel', language: 'zh-CN',
  showWorldCoordinates: false, returnToFocusReminders: true, autoContinueFocus: false, autoCheckUpdates: false,
  realWeatherEnabled: false, minimalMode: false, quickNotesEnabled: false,
  worldColorAdjustment: { saturation: 100, brightness: 100, contrast: 100 },
  ambience: { enabled: false, primary: 'forest-birds', rainEnabled: false, volume: 30 },
};
const tokenOptions = { name: 'Partner timer', uploadFocus: true, readFriends: true, days: 30 };
const stamp = offset => new Date(start + offset * minute).toISOString();

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'blockcolc-integrations-'));
  let now = start;
  const store = new CloudStore(directory, { clock: () => now });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  async function user(name) {
    const credentials = await store.register({ username: name, password: 'test-password-not-production',
      name, deviceId: 'device_' + name + '_12345678', deviceName: 'Test', timeZone: 'UTC' });
    return { token: credentials.token, session: store.authenticate(credentials.token) };
  }
  const { token, session } = await user('alice');
  store.claim(session, { generation: 0 });
  function push(entries) {
    const h = store.head(session.user);
    const current = store.entries(session.user);
    const changes = [...new Set([...Object.keys(current), ...Object.keys(entries)])]
      .filter(key => current[key] !== entries[key])
      .map(key => ({ key, before: current[key] == null ? null : sha(current[key]), canonical: entries[key] ?? null }));
    return store.commit(session, { requestId: crypto.randomUUID(), epoch: h.epoch, execution: h.execution, changes });
  }
  function workspace() {
    return assembleDomain(store.entries(session.user), key => store.asset(session.user, key));
  }
  const partner = store.integrations.issue(session, tokenOptions).token;
  const offline = (id, from, to, taskName) => store.integrations.report(partner, {
    state: 'recorded', sessionId: id, sequence: 1, startedAt: stamp(from), endedAt: stamp(to), taskName,
  });
  return { store, user, session, token, partner, offline, push, workspace, advance: ms => { now += ms; } };
}

test('scope, friendship and opt-in gate the HTTPS-facing integration contract', async t => {
  const f = await fixture(t);
  const buddy = await f.user('bob');
  const api = createCloudServer(f.store);
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => api.close(resolve)));
  const base = 'http://127.0.0.1:' + api.address().port + '/v1';
  async function request(path, token, method = 'GET', data) {
    const response = await fetch(base + path, { method, headers: { authorization: 'Bearer ' + token },
      ...(data && { body: JSON.stringify(data) }) });
    return [response.status, await response.json()];
  }
  const alice = f.session;
  const bob = buddy.session;
  f.store.updateAccount(alice, { friendsEnabled: true });
  f.store.updateAccount(bob, { friendsEnabled: true, sharing: { status: true, name: false, time: false, daily: false } });
  f.store.invite(alice, f.store.account(bob.user).friendCode);
  f.store.relation(bob, alice.user, 'accept');
  const read = { account: { id: alice.user, name: 'alice' }, friends: [] };
  assert.deepEqual(await request('/integrations/friends', f.partner), [200, read]);
  f.store.integrations.share(bob, { shareWithIntegrations: true });
  const writer = f.store.integrations.issue(bob, { ...tokenOptions, readFriends: false });
  f.store.integrations.report(writer.token, { state: 'focus', sessionId: 'online-bob', sequence: 1, taskName: 'secret' });
  const [status, { friends }] = await request('/integrations/friends', f.partner);
  assert.equal(status, 200);
  assert.equal(friends[0].focusing, true);
  assert.equal(friends[0].source.name, tokenOptions.name);
  assert.equal(friends[0].currentName, undefined);
  assert.equal(friends[0].startedAt, undefined);
  assert.equal((await request('/integrations/friends', writer.token))[0], 403);
  assert.equal((await request('/integrations/friends', f.token))[0], 401);
  assert.equal((await request('/workspace', f.partner))[0], 401);
  assert.equal((await request('/integrations/manage', f.partner))[0], 401);
  f.store.updateAccount(bob, { friendsEnabled: false });
  assert.deepEqual(await request('/integrations/friends', f.partner), [200, read]);
  const issued = f.store.integrations.manage(alice).tokens[0];
  assert(!JSON.stringify(issued).includes(f.partner));
  assert.notEqual(f.store.db.prepare('SELECT digest FROM integration_tokens WHERE id=?').get(issued.id).digest, f.partner);
  f.store.integrations.revoke(alice, issued.id);
  assert.equal((await request('/integrations/friends', f.partner))[0], 401);
  f.advance(30_000);
  assert.equal(f.store.integrations.report(writer.token, { state: 'idle', sessionId: 'online-bob', sequence: 2 }).focusMs, 30_000);
  assert.deepEqual(await request('/workspace', buddy.token), [409, { error: 'CLIENT_UPDATE_REQUIRED' }]);
  const workspace = await fetch(base + '/workspace', { headers:{
    authorization:'Bearer ' + buddy.token, 'x-blockcolc-focus-credits':'1', 'x-blockcolc-sync-protocol':'2',
  }});
  assert.equal(workspace.status,200);
  assert(Object.keys((await workspace.json()).entries).some(key=>key.startsWith('focusHistory/external-focus:')));
});

test('external focus uses synced habit preferences, carries minutes, and uses one durable receipt', async t => {
  const f = await fixture(t);
  const source = createInitialState();
  const created = execute(source, { type: 'CreateHabitProject', projectId: 'writing', title: 'Writing',
    blueprintId: 'builtin-timber-house', targetRounds: 10 }, { now: () => new Date(start - minute) });
  assert.equal(created.ok, true);
  f.push({ ...splitDomain(created.state).entries, '@preferences': canonical(prefs) });
  f.advance(600 * minute);
  assert.equal(f.offline('first', 0, 15, 'Writing').rounds, 0);
  assert.equal(f.offline('next', 15, 30, ' Writing ').rounds, 1);
  const beforeReplay = f.store.head(f.session.user).revision;
  assert.equal(f.offline('next', 15, 30, ' Writing ').focusMs, 15 * minute);
  assert.equal(f.store.head(f.session.user).revision, beforeReplay);
  const both = f.offline('full-window', 5, 275, 'Writing');
  assert.equal(both.rounds, 10);
  assert.equal(both.focusMs, 245 * minute);
  const result = f.workspace();
  assert.equal(result.focusHistory.reduce((sum, row) => sum + row.actualDurationMs, 0), 275 * minute);
  assert.equal(completedPomodorosOn(result, '2026-11-15'), 11);
  assert.equal(result.habitBuildings.length, 1);
  assert.equal(result.habitBuildings[0].focusSessionIds.length, 10);
  assert.equal(result.habitBuildings[0].blueprintId, 'builtin-timber-house');
  assert.equal(result.projects[0].habit.completedFocusSessionIds.length, 1);
  assert.equal(result.projects[0].habit.targetRounds, prefs.habitTargetRounds);
  assert.equal(result.projects[0].blueprintId, result.habitBuildings[0].blueprintId);
  const stagedNative = {
    id: 'offline-native', projectId: 'writing', subtaskId: null, timeZoneAtStart: 'UTC',
    startedAt: stamp(269), endsAt: stamp(294), plannedDurationMs: 25 * minute,
    integrity: { effectiveExcursions: 0, backgroundedAt: null, backgroundReason: null, exemptionPending: false },
  };
  const beforeOverlap = f.store.entries(f.session.user);
  assert.throws(() => f.push({ ...beforeOverlap, '$/activeFocusSession': canonical(stagedNative) }), { code: 'EXTERNAL_FOCUS_OVERLAP' });
  assert.deepEqual(f.store.entries(f.session.user), beforeOverlap);
  f.offline('unmatched', 300, 325, 'Finite task');
  f.offline('unnamed', 325, 350, null);
  const defaults = f.workspace().projects.filter(project => project.title === '外部专注');
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].habit.targetRounds, prefs.habitTargetRounds);
  assert.equal(defaults[0].habit.completedFocusSessionIds.length, 2);
  assert.equal(f.workspace().activeProjectId, 'writing');
});

test('native reservation, external refresh and idle settlement enforce one active source', async t => {
  const f = await fixture(t);
  const { store, session, partner } = f;
  const generation = store.head(session.user).execution;
  const startFrame = { state: 'focus', sessionId: 'live', sequence: 0, taskName: 'Reading' };
  store.integrations.nativeStart(session, { generation, request: 'starting-native' });
  assert.throws(() => store.integrations.report(partner, startFrame), { code: 'NATIVE_FOCUS_IN_PROGRESS' });
  store.integrations.nativeCancel(session, { request: 'starting-native' });
  const first = store.integrations.report(partner, startFrame);
  assert.deepEqual(store.integrations.report(partner, startFrame), first);
  assert.throws(() => store.integrations.nativeStart(session, { generation, request: 'native-later' }), { code: 'EXTERNAL_FOCUS_IN_PROGRESS' });
  assert.throws(() => store.integrations.report(partner, { ...startFrame, sessionId: 'second' }), { code: 'EXTERNAL_FOCUS_IN_PROGRESS' });
  f.advance(30_000);
  store.integrations.report(partner, { ...startFrame, state: 'rest', sequence: 1 });
  assert.throws(() => store.integrations.report(partner, startFrame), { code: 'STALE_SEQUENCE' });
  f.advance(45_000);
  store.integrations.report(partner, { ...startFrame, sequence: 2 });
  f.advance(30_000);
  assert.equal(store.integrations.report(partner, { ...startFrame, state: 'idle', sequence: 3 }).focusMs, 60_000);
  assert.equal(store.integrations.report(partner, { ...startFrame, state: 'idle', sequence: 3 }).focusMs, 60_000);
  const another = { ...startFrame, sessionId: 'expires' };
  store.integrations.report(partner, another);
  f.advance(30_000);
  store.integrations.report(partner, { ...another, sequence: 1 });
  f.advance(95_000);
  store.integrations.sweep();
  assert.equal(store.integrations.report(partner, { ...another, state: 'idle', sequence: 2 }).focusMs, 30_000);
  store.integrations.nativeStart(session, { generation, request: 'native-after-expiry' });
  assert.equal(f.workspace().focusHistory.reduce((sum, row) => sum + row.actualDurationMs, 0), 90_000);
});

test('cloud backup restores the habit duration and round target with the workspace', async t => {
  const f = await fixture(t);
  f.push({ ...splitDomain(createInitialState()).entries, '@preferences': canonical(prefs) });
  f.store.capture(f.session.user);
  f.push({ ...f.store.entries(f.session.user), '@preferences': canonical({ ...prefs, habitFocusMinutes: 60, habitTargetRounds: 30 }) });
  const current = f.store.workspace(f.session);
  const restored = f.store.restore(f.session, { revision: current.revision, requestId: 'test-restore-prefs' });
  assert.deepEqual(JSON.parse(restored.entries['@preferences']), prefs);
});
