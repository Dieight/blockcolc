import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudStore } from '../src/store.mjs';
import { createCloudServer } from '../src/server.mjs';
import { sha, splitDomain } from '../src/wire.mjs';
import { createInitialState, execute } from '../build/domain.mjs';

const minute = 60000;
const start = Date.parse('2026-11-26T08:00:00Z');

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'blockcolc-sync-v2-'));
  let now = start;
  let store = new CloudStore(directory, { clock: () => now });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const result = await store.register({ username: 'alice', password: 'local-test-only', name: 'Alice',
    deviceId: 'test-device-000001', deviceName: 'Test', timeZone: 'UTC' });
  const session = store.authenticate(result.token);
  store.claim(session, { generation: 0 });
  let state = createInitialState('UTC');
  function local(command) {
    const next = execute(state, command, { now: () => new Date(now) });
    assert.equal(next.ok, true);
    state = next.state;
    return splitDomain(state).entries;
  }
  function input(oldRows, newRows, requestId = crypto.randomUUID()) {
    const head = store.sync.head(session);
    return { requestId, epoch: head.epoch, execution: head.execution.generation, knownEpoch: head.epoch, known: head.packages,
      changes: [...new Set([...Object.keys(oldRows), ...Object.keys(newRows)])].filter(key => oldRows[key] !== newRows[key])
        .map(key => ({ key, before: oldRows[key] == null ? null : sha(oldRows[key]), canonical: newRows[key] ?? null })) };
  }
  const commit = (request, by = session) => store.commit(by, request, { protocol2: true });
  return { get store() { return store; }, session, token: result.token, local, input, commit,
    advance: elapsed => { now += elapsed; }, reopen: () => { store.close(); store = new CloudStore(directory, { clock: () => now }); } };
}

function project(f) {
  return f.local({ type: 'CreateProject', projectId: 'project', title: 'Focus', blueprintId: 'cottage',
    subtasks: [{ id: 'task', title: 'Task' }] });
}

test('the focus delta and estimated presence share one transaction and survive an hour and a restart', async t => {
  const f = await fixture(t);
  const base = project(f);
  f.commit(f.input({}, base));
  const idle = f.store.sync.head(f.session);
  const begun = f.local({ type: 'StartFocus', sessionId: 'first', projectId: 'project', subtaskId: 'task', plannedDurationMs: 60 * minute });
  // Uploading an offline start must not move the start or end of the round.
  f.advance(30_000);
  const reply = f.commit(f.input(base, begun));
  assert.deepEqual(Object.keys(reply.state.delta), ['focus']);
  assert.deepEqual(reply.state.packages.building, idle.packages.building);
  assert.equal(f.store.liveStatus(f.session.user).value.startedAt, new Date(start).toISOString());
  assert.equal(f.store.liveStatus(f.session.user).value.estimatedEndsAt, new Date(start + 60 * minute).toISOString());
  assert.equal(f.store.liveStatus(f.session.user).value.estimated, true);

  f.advance(60 * minute);
  f.reopen();
  assert.deepEqual(f.store.sync.head(f.session).packages, reply.state.packages);
  assert.equal(f.store.liveStatus(f.session.user).value.currentName, 'Task');
  assert.deepEqual(f.store.sync.pull(f.session, { epoch: idle.epoch, known: reply.state.packages }).delta, {});
  assert.deepEqual(f.store.dayTotals(f.session.user, 'UTC'), {});

  const done = f.local({ type: 'CompleteFocus' });
  const finish = f.input(begun, done);
  const settled = f.commit(finish);
  assert.equal(settled.state.delta.focus.entries['$/activeFocusSession'], 'null');
  assert.ok(settled.state.delta.focus.entries['focusHistory/first']);
  assert.equal(f.store.liveStatus(f.session.user).value.currentName, null);
  assert.equal(f.store.dayTotals(f.session.user, 'UTC')['2026-11-26'], 60 * minute);
  assert.equal(f.commit(finish).revision, settled.revision);
  assert.equal(f.store.dayTotals(f.session.user, 'UTC')['2026-11-26'], 60 * minute);
});

test('a competing transition returns the winner and never commits its dependent edits', async t => {
  const f = await fixture(t);
  const base = project(f);
  f.commit(f.input({}, base));
  f.store.release(f.session, { generation: f.store.head(f.session.user).execution });
  const began = f.local({ type: 'StartFocus', sessionId: 'winner', projectId: 'project', subtaskId: 'task', plannedDurationMs: minute });
  const wins = f.input(base, began);
  const rival = { ...began, '$/activeFocusSession': began['$/activeFocusSession'].replace('winner', 'loser') };
  const loses = f.input(base, rival);
  const signedIn=f.store.session(f.session.user,'test-device-000002','Second device');
  const second=f.store.authenticate(signedIn.token);
  const firstReply=f.commit(wins,second);
  assert.equal(firstReply.state.execution.owner,second.device);
  assert.equal(firstReply.state.focusLocked,true);
  const lost = f.commit(loses);
  assert.equal(lost.winners['$/activeFocusSession'], began['$/activeFocusSession']);
  assert.equal(f.store.liveStatus(f.session.user).value.currentName, 'Task');
  assert.equal(lost.revision, f.store.head(f.session.user).revision);
  assert.equal(f.store.entries(f.session.user)['$/activeFocusSession'], began['$/activeFocusSession']);
});

test('building-only edits isolate revisions and serve deletions without a workspace fetch', async t => {
  const f = await fixture(t);
  const base = project(f);
  f.commit(f.input({}, base));
  const before = f.store.sync.head(f.session);
  const added = f.local({ type: 'AddQuickNote', noteId: 'note', text: 'A note' });
  const result = f.commit(f.input(base, added));
  assert.deepEqual(result.state.packages.focus, before.packages.focus);
  assert.deepEqual(Object.keys(result.state.delta), ['building']);
  assert.ok(result.state.delta.building.entries['quickNotes/note']);
  const deleted = f.commit(f.input(added, base));
  assert.equal(deleted.state.delta.building.entries['quickNotes/note'], null);
  const oldClient = f.store.sync.pull(f.session, { epoch: 'old-epoch', known: before.packages });
  assert.equal(oldClient.delta.building.snapshot, true);
  assert.equal(oldClient.delta.focus.snapshot, true);
});

test('a concurrent note edit does not prevent storing an interrupted focus interval', async t => {
  const f = await fixture(t);
  project(f);
  const base = f.local({ type: 'AddQuickNote', noteId: 'note', text: 'Original' });
  f.commit(f.input({}, base));
  const begun = f.local({ type: 'StartFocus', sessionId: 'interrupted', projectId: 'project', subtaskId: 'task', plannedDurationMs: 60 * minute });
  f.commit(f.input(base, begun));
  f.advance(12 * minute);
  const done = f.local({ type: 'CancelFocus' });
  const note = 'quickNotes/note';
  const remoteEdit = { ...begun, [note]: begun[note].replace('Original', 'First cloud edit') };
  f.commit(f.input(begun, remoteEdit));
  const localEdit = { ...done, [note]: begun[note].replace('Original', 'Late device edit') };
  const reply = f.commit(f.input(begun, localEdit));
  assert.equal(reply.winners[note], remoteEdit[note]);
  assert.equal(f.store.liveStatus(f.session.user).value.currentName, null);
  assert.equal(f.store.dayTotals(f.session.user, 'UTC')['2026-11-26'], 12 * minute);
});

test('one-time bootstrap indexes an existing workspace without replacing its facts', async t => {
  const f = await fixture(t);
  const base = project(f);
  const active = f.local({ type: 'StartFocus', sessionId: 'migrate', projectId: 'project', subtaskId: 'task', plannedDurationMs: minute });
  f.commit(f.input({}, base));
  f.commit(f.input(base, active));
  const original = f.store.entries(f.session.user);
  f.store.db.exec(`CREATE TABLE entries AS SELECT user,key,canonical,sha FROM sync_entries; DELETE FROM sync_entries;
    DELETE FROM sync_v2_migrations; DELETE FROM sync_v2_changes; DELETE FROM sync_v2_packages; DELETE FROM sync_v2_focus;`);
  f.advance(45_000);
  f.reopen();
  assert.deepEqual(f.store.entries(f.session.user), original);
  assert.equal(f.store.liveStatus(f.session.user).value.startedAt, new Date(start).toISOString());
  const migrated = f.store.sync.head(f.session);
  f.reopen();
  assert.deepEqual(f.store.sync.head(f.session), migrated);
});

test('legacy HTTP and v2 clients share data and the v2 head is read-only', async t => {
  const f = await fixture(t);
  const server = createCloudServer(f.store);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const headers = { authorization: 'Bearer ' + f.token };
  const post = (path, payload) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(payload) });
  const initial = project(f);
  const legacyCommit = await post('/workspace/commit', f.input({}, initial));
  assert.equal(legacyCommit.status, 200);
  const old = await fetch(base + '/workspace', { headers });
  assert.equal(old.status, 200);
  assert.deepEqual((await old.json()).entries, initial);
  const v2 = await post('/sync/pull', { known: {} });
  assert.deepEqual((await v2.json()).delta.building.entries, Object.fromEntries(
    Object.entries(initial).filter(([key]) => key !== '$/activeFocusSession')));
  const legacyPresence = await post('/presence', { execution: f.store.head(f.session.user).execution, snapshot:
    { currentName: 'Legacy task', startedAt: new Date(start).toISOString(), estimatedElapsedMs: 0,
      estimatedEndsAt: new Date(start + minute).toISOString(), todayActualFocusMs: 0 } });
  assert.equal(legacyPresence.status, 200);
  assert.equal(f.store.liveStatus(f.session.user).value.currentName, 'Legacy task');
  const note = f.local({ type: 'AddQuickNote', noteId: 'new-client', text: 'Read by the legacy client' });
  assert.equal((await post('/sync/commit', f.input(initial, note))).status, 200);
  assert.deepEqual((await (await fetch(base + '/workspace', { headers })).json()).entries, note);
  const before = f.store.devices(f.session)[0].last_seen;
  f.advance(6 * minute);
  const head = await fetch(base + '/sync/head', { headers });
  assert.equal(head.status, 200);
  assert.equal((await head.json()).schema, 2);
  assert.equal(f.store.devices(f.session)[0].last_seen, before);
});

test('an idle watching device cannot silently take over or commit focus effects', async t => {
  const f = await fixture(t);
  const base = project(f);
  f.commit(f.input({}, base));
  const begun = f.local({ type: 'StartFocus', sessionId: 'viewer', projectId: 'project', subtaskId: 'task', plannedDurationMs: minute });
  const signedIn = f.store.session(f.session.user, 'test-device-000002', 'Watching device');
  const viewer = f.store.authenticate(signedIn.token);
  const result = f.commit(f.input(base, begun), viewer);
  assert.equal(result.winners['$/activeFocusSession'], 'null');
  assert.equal(result.state.execution.owner, f.session.device);
  assert.equal(f.store.liveStatus(f.session.user).value.currentName, null);
  f.store.claim(viewer, { generation: result.state.execution.generation, takeover: true });
  const takeover = f.commit(f.input(base, begun), viewer);
  assert.equal(takeover.state.execution.owner, viewer.device);
  assert.equal(takeover.state.focusLocked, true);
});
