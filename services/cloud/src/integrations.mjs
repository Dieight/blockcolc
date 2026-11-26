import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createInitialState, parseDomainState, settleExternalFocus } from '../build/domain.mjs';
import { assembleDomain, canonical, fail, sha, splitDomain } from './wire.mjs';

const minute = 60000;
const day = 1440 * minute;
const freshness = 90000;
const tokenPattern = /^bci_[A-Za-z0-9_-]{43}$/;
const idPattern = /^[A-Za-z0-9_:-]{1,96}$/;
const blueprintIds = ['builtin-small-workshop', 'builtin-timber-house', 'builtin-village-chapel'];
export const isIntegrationApi = path => path === '/v1/integrations/focus' || path === '/v1/integrations/friends';

function instant(value) {
  fail(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value), 'INVALID_FOCUS_TIME');
  const time = Date.parse(value);
  fail(Number.isFinite(time), 'INVALID_FOCUS_TIME');
  return time;
}

function objectWithKeys(value, allowed) {
  fail(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)));
}

function nonoverlapping(intervals, history) {
  const known = history.map(row => ({
    from: Date.parse(row.startedAt), to: Date.parse(row.startedAt) + row.actualDurationMs,
  }));
  const accepted = [];
  let index = 0;
  for (const interval of intervals) {
    let from = interval.from;
    while (index < known.length && known[index].to <= from) index++;
    let overlap = index;
    while (overlap < known.length && known[overlap].from < interval.to) {
      const existing = known[overlap++];
      if (existing.from < existing.to) {
        if (existing.from > from) accepted.push({ from, to: existing.from });
        from = Math.max(from, existing.to);
      }
      if (from >= interval.to) break;
    }
    if (from < interval.to) accepted.push({ from, to: interval.to });
  }
  return accepted;
}

function activeNativePlan(entries) {
  return Boolean(JSON.parse(entries['$/activeFocusSession'] ?? 'null') || JSON.parse(entries['@plan'] ?? '{}').plan?.hasStarted);
}

/** Account-scoped API credentials and the short-lived occupancy for a focus plan. */
export class Integrations {
  constructor(cloud) {
    this.cloud = cloud;
    this.db = cloud.db;
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS integration_tokens (id TEXT PRIMARY KEY,user TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,' +
        'digest TEXT UNIQUE NOT NULL,name TEXT NOT NULL,focus INTEGER NOT NULL,friends INTEGER NOT NULL,expires INTEGER NOT NULL);' +
      'CREATE INDEX IF NOT EXISTS integration_tokens_user ON integration_tokens(user);' +
      'CREATE TABLE IF NOT EXISTS integration_friend_opt_in (user TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE);' +
      'CREATE TABLE IF NOT EXISTS native_focus_reservations (user TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,' +
        'owner TEXT NOT NULL,generation INTEGER NOT NULL,request TEXT NOT NULL,expires INTEGER NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS integration_runs (user TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,' +
        'token_id TEXT NOT NULL,session TEXT NOT NULL,epoch TEXT NOT NULL,expires INTEGER NOT NULL,wire TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS integration_focus_receipts (user TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,' +
        'id TEXT NOT NULL,created INTEGER NOT NULL,result TEXT NOT NULL,PRIMARY KEY(user,id));' +
      'CREATE INDEX IF NOT EXISTS integration_focus_receipts_created ON integration_focus_receipts(created);'
    );
  }
  authenticate(secret, scope) {
    fail(typeof secret === 'string' && tokenPattern.test(secret), 'UNAUTHORIZED', 401);
    const token = this.db.prepare('SELECT id,user,name,focus,friends,expires FROM integration_tokens WHERE digest=? AND expires>?')
      .get(sha(secret), this.cloud.clock());
    fail(token, 'UNAUTHORIZED', 401);
    fail(token[scope], 'INSUFFICIENT_SCOPE', 403);
    return token;
  }
  hasFriendOptIn(user) {
    return Boolean(this.db.prepare('SELECT 1 FROM integration_friend_opt_in WHERE user=?').get(user));
  }
  manage(session) {
    this.cloud.assertSession(session);
    const tokens = this.db.prepare('SELECT id,name,focus,friends,expires FROM integration_tokens WHERE user=? AND expires>? ORDER BY expires,id')
      .all(session.user, this.cloud.clock())
      .map(row => ({ id: row.id, name: row.name, uploadFocus: !!row.focus, readFriends: !!row.friends, expiresAt: new Date(row.expires).toISOString() }));
    return { shareWithIntegrations: this.hasFriendOptIn(session.user), tokens };
  }
  share(session, input) {
    this.cloud.assertSession(session);
    objectWithKeys(input, ['shareWithIntegrations']);
    fail(typeof input.shareWithIntegrations === 'boolean');
    if (input.shareWithIntegrations) this.db.prepare('INSERT OR IGNORE INTO integration_friend_opt_in VALUES(?)').run(session.user);
    else this.db.prepare('DELETE FROM integration_friend_opt_in WHERE user=?').run(session.user);
    return this.manage(session);
  }
  issue(session, input) {
    this.cloud.assertSession(session);
    objectWithKeys(input, ['name', 'uploadFocus', 'readFriends', 'days']);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    fail(name.length > 0 && name.length <= 64 && !/[\u0000-\u001f\u007f]/.test(name));
    fail(typeof input.uploadFocus === 'boolean' && typeof input.readFriends === 'boolean' && (input.uploadFocus || input.readFriends));
    fail(Number.isInteger(input.days) && input.days >= 1 && input.days <= 365);
    return this.cloud.transaction(() => {
      const now = this.cloud.clock();
      this.db.prepare('DELETE FROM integration_tokens WHERE user=? AND expires<=?').run(session.user, now);
      fail(this.db.prepare('SELECT count(*) n FROM integration_tokens WHERE user=?').get(session.user).n < 20, 'TOO_MANY_INTEGRATIONS', 409);
      const secret = 'bci_' + randomBytes(32).toString('base64url');
      const id = randomUUID();
      this.db.prepare('INSERT INTO integration_tokens VALUES(?,?,?,?,?,?,?)')
        .run(id, session.user, sha(secret), name, +input.uploadFocus, +input.readFriends, now + input.days * day);
      return { ...this.manage(session), token: secret };
    });
  }
  revoke(session, id) {
    this.cloud.assertSession(session);
    fail(/^[a-f0-9-]{36}$/.test(id));
    return this.cloud.transaction(() => {
      const active = this.runFor(session.user);
      this.db.prepare('DELETE FROM integration_tokens WHERE user=? AND id=?').run(session.user, id);
      if (active?.token_id === id) {
        this.db.prepare('UPDATE integration_runs SET expires=min(expires,?) WHERE user=?').run(this.cloud.clock(),session.user);
        this.db.prepare('DELETE FROM presence WHERE user=?').run(session.user);
      }
      return this.manage(session);
    });
  }
  friends(token) {
    const viewer = this.cloud.account(token.user);
    const friends = this.cloud.friends(token).filter(friend => friend.status === 'accepted' && friend.visible && this.hasFriendOptIn(friend.id));
    return {
      account: { id: viewer.id, name: viewer.name },
      friends: friends.map(({ sharing, incoming, status, ...visible }) => visible),
    };
  }

  runFor(user) { return this.db.prepare('SELECT * FROM integration_runs WHERE user=?').get(user); }
  hasSettledFocus(user) {
    return this.db.prepare("SELECT 1 FROM sync_entries WHERE user=? AND key GLOB 'focusHistory/external-focus:*' LIMIT 1").get(user) !== undefined;
  }
  assertNativeIntervals(user, changes) {
    const incoming = changes.filter(change => change.canonical != null && (change.key === '$/activeFocusSession' ||
      (change.key.startsWith('focusHistory/') && !change.key.startsWith('focusHistory/external-focus:'))));
    if (!incoming.length) return;
    const confirmed = this.db.prepare("SELECT canonical FROM sync_entries WHERE user=? AND key GLOB 'focusHistory/external-focus:*'").all(user);
    const external = confirmed.map(({ canonical: wire }) => {
      const value = JSON.parse(wire).value;
      return [Date.parse(value.startedAt), Date.parse(value.completedAt)];
    });
    for (const change of incoming) {
      const wire = JSON.parse(change.canonical);
      const record = change.key === '$/activeFocusSession' ? wire : wire?.value;
      if (!record) continue;
      const from = Date.parse(record.startedAt);
      const to = Date.parse(record.completedAt ?? record.interruptedAt ?? record.endsAt);
      fail(!external.some(([start,end]) => from < end && to > start), 'EXTERNAL_FOCUS_OVERLAP', 409);
    }
  }
  externalBusy(user) { return this.runFor(user) !== undefined; }
  forgetNativeReservations(user) { this.db.prepare('DELETE FROM native_focus_reservations WHERE user=?').run(user); }
  nativeStart(session, { generation, request }) {
    this.cloud.assertSession(session);
    fail(typeof request === 'string' && idPattern.test(request));
    return this.cloud.transaction(() => {
      const head = this.cloud.head(session.user);
      fail(head.owner === session.device && head.execution === generation, 'EXECUTION_CHANGED', 409);
      const now = this.cloud.clock();
      this.expire(session.user, now);
      fail(!this.externalBusy(session.user), 'EXTERNAL_FOCUS_IN_PROGRESS', 409);
      this.db.prepare('INSERT OR REPLACE INTO native_focus_reservations VALUES(?,?,?,?,?)')
        .run(session.user, session.device, generation, request, now + freshness);
      return { ok: true };
    });
  }
  nativeCancel(session, { request }) {
    this.cloud.assertSession(session);
    fail(typeof request === 'string' && idPattern.test(request));
    this.db.prepare('DELETE FROM native_focus_reservations WHERE user=? AND owner=? AND request=?').run(session.user, session.device, request);
    return { ok: true };
  }
  assertAvailable(user, now) {
    const executionEntries = Object.fromEntries(this.db.prepare("SELECT key,canonical FROM sync_entries WHERE user=? AND key IN ('$/activeFocusSession','@plan')")
      .all(user).map(row => [row.key,row.canonical]));
    fail(!activeNativePlan(executionEntries), 'NATIVE_FOCUS_IN_PROGRESS', 409);
    const observed = this.db.prepare('SELECT value FROM presence WHERE user=? AND expires>?').get(user, now);
    if(observed){
      const snapshot = JSON.parse(observed.value);
      fail(!snapshot.currentName || snapshot.externalState, 'NATIVE_FOCUS_IN_PROGRESS', 409);
    }
    const native = this.db.prepare('SELECT * FROM native_focus_reservations WHERE user=? AND expires>?').get(user, now);
    const head = this.cloud.head(user);
    fail(!native || native.owner !== head.owner || native.generation !== head.execution, 'NATIVE_FOCUS_IN_PROGRESS', 409);
  }
  expire(user, now) {
    const run = this.runFor(user);
    if (run && run.expires <= now) this.closeRun(run, JSON.parse(run.wire).lastSeen);
  }
  sweep() {
    const now = this.cloud.clock();
    for (const { user } of this.db.prepare('SELECT user FROM integration_runs WHERE expires<=? LIMIT 20').all(now)) {
      this.cloud.transaction(() => this.expire(user, now));
    }
    this.db.prepare('DELETE FROM native_focus_reservations WHERE expires<=?').run(now);
    this.db.prepare('DELETE FROM integration_focus_receipts WHERE created<?').run(now - 60 * day);
  }
  receiptKey(tokenId, session) { return sha(tokenId + ':' + session); }
  record(user, key, input) {
    const oldEntries = this.cloud.entries(user);
    const account = this.cloud.account(user);
    const domain = Object.hasOwn(oldEntries, '$/schemaVersion')
      ? assembleDomain(oldEntries, asset => this.cloud.asset(user, asset))
      : createInitialState(account.timeZone);
    const intervals = nonoverlapping(input.intervals, domain.focusHistory);
    const preferences = JSON.parse(oldEntries['@preferences'] ?? '{}');
    const { state, ...result } = settleExternalFocus(domain, {
      receipt: key, source: input.name, title: input.title, intervals,
      roundMs: (preferences.habitFocusMinutes ?? 45) * minute, targetRounds: preferences.habitTargetRounds ?? 10,
      defaultBlueprint: () => blueprintIds[randomInt(blueprintIds.length)],
    });
    if (result.focusMs > 0) {
      const { entries } = splitDomain(parseDomainState(state));
      const size = Object.values(entries).reduce((bytes, wire) => bytes + Buffer.byteLength(wire), 0);
      fail(size <= 100 * 1024 * 1024, 'WORKSPACE_TOO_LARGE', 413);
      const write = this.db.prepare('INSERT INTO sync_entries VALUES(?,?,?,?) ON CONFLICT(user,key) DO UPDATE SET canonical=excluded.canonical,sha=excluded.sha');
      const changed = [];
      for (const [entry, wire] of Object.entries(entries)) if (oldEntries[entry] !== wire) {
        write.run(user, entry, wire, sha(wire));
        changed.push(entry);
      }
      this.db.prepare('UPDATE heads SET revision=revision+1,changed=? WHERE user=?').run(this.cloud.clock(), user);
      this.cloud.sync.record(user, changed);
    }
    const reply = { settled: true, ...result };
    this.db.prepare('INSERT INTO integration_focus_receipts VALUES(?,?,?,?)').run(user, key, this.cloud.clock(), canonical(reply));
    return reply;
  }
  closeRun(row, at) {
    fail(this.cloud.head(row.user).epoch === row.epoch, 'WORKSPACE_REPLACED', 409);
    const run = JSON.parse(row.wire);
    const end = Math.min(at, row.expires);
    if (run.focusFrom != null && end > run.focusFrom) run.intervals.push({ from: run.focusFrom, to: end });
    const result = this.record(row.user, this.receiptKey(row.token_id, row.session), run);
    this.db.prepare('DELETE FROM integration_runs WHERE user=?').run(row.user);
    const now = this.cloud.clock();
    const idle = { currentName: null, startedAt: null, estimatedEndsAt: null, estimatedElapsedMs: 0, todayActualFocusMs: 0,
      updatedAt: new Date(now).toISOString() };
    this.db.prepare('INSERT OR REPLACE INTO presence VALUES(?,?,?)').run(row.user, canonical(idle), now + freshness);
    return result;
  }
  report(secret, input) {
    const token = this.authenticate(secret, 'focus');
    objectWithKeys(input, ['state', 'sessionId', 'sequence', 'taskName', 'estimatedEndsAt', 'startedAt', 'endedAt']);
    const { state, sessionId, sequence } = input;
    fail(['focus', 'rest', 'idle', 'recorded'].includes(state) && typeof sessionId === 'string' && idPattern.test(sessionId), 'INVALID_FOCUS_REPORT');
    fail(Number.isSafeInteger(sequence) && sequence >= 0, 'INVALID_FOCUS_REPORT');
    const title = input.taskName == null ? null : typeof input.taskName === 'string' ? input.taskName.trim() : undefined;
    fail(title === null || typeof title === 'string' && title.length <= 160, 'INVALID_FOCUS_REPORT');
    const key = this.receiptKey(token.id, sessionId);
    const now = this.cloud.clock();
    const estimated = input.estimatedEndsAt == null ? null : instant(input.estimatedEndsAt);
    fail(estimated == null || estimated <= now + day, 'INVALID_FOCUS_TIME');
    return this.cloud.transaction(() => {
      this.expire(token.user, now);
      const receipt = this.db.prepare('SELECT result FROM integration_focus_receipts WHERE user=? AND id=?').get(token.user, key);
      if (receipt) return JSON.parse(receipt.result);
      const existing = this.runFor(token.user);
      if (state === 'recorded') {
        fail(!existing, 'EXTERNAL_FOCUS_IN_PROGRESS', 409);
        this.assertAvailable(token.user, now);
        const from = instant(input.startedAt);
        const to = instant(input.endedAt);
        fail(from >= now - 30 * day && from < to && to <= now && to - from <= day, 'INVALID_FOCUS_TIME');
        return this.record(token.user, key, { name: token.name, title, intervals: [{ from, to }] });
      }
      fail(!existing || existing.token_id === token.id && existing.session === sessionId, 'EXTERNAL_FOCUS_IN_PROGRESS', 409);
      const epoch = this.cloud.head(token.user).epoch;
      if (!existing) {
        fail(state === 'focus', 'FOCUS_SESSION_NOT_FOUND', 404);
        this.assertAvailable(token.user, now);
      }
      const run = existing ? JSON.parse(existing.wire)
        : { name: token.name, title, started: now, lastSeen: now, sequence: -1, focusFrom: null, intervals: [] };
      fail(!existing || !title || title === run.title, 'FOCUS_TASK_CHANGED', 409);
      if (sequence === run.sequence) {
        fail(run.frame === sha(canonical(input)), 'SEQUENCE_REUSED', 409);
        return { accepted: true, expiresAt: new Date(existing.expires).toISOString() };
      }
      fail(sequence > run.sequence, 'STALE_SEQUENCE', 409);
      if (state === 'idle') return this.closeRun(existing, now);
      fail(run.intervals.length < 256 && now - run.started < day, 'FOCUS_SESSION_LIMIT', 409);
      if (state === 'focus' && run.focusFrom == null) run.focusFrom = now;
      if (state === 'rest' && run.focusFrom != null) {
        if (now > run.focusFrom) run.intervals.push({ from: run.focusFrom, to: now });
        run.focusFrom = null;
      }
      const expires = Math.min(now + freshness, token.expires, run.started + day);
      run.lastSeen = now;
      run.sequence = sequence;
      run.frame = sha(canonical(input));
      this.db.prepare('INSERT OR REPLACE INTO integration_runs VALUES(?,?,?,?,?,?)')
        .run(token.user, token.id, sessionId, epoch, expires, canonical(run));
      const stamp = new Date(now).toISOString();
      const snapshot = { currentName: run.title || (state === 'rest' ? '休息中' : '专注中'), taskName: run.title,
        startedAt: new Date(run.focusFrom ?? run.started).toISOString(),
        estimatedEndsAt: estimated != null && estimated > now ? new Date(estimated).toISOString() : null,
        sourceName: token.name, externalState: state, updatedAt: stamp, estimatedElapsedMs: now - (run.focusFrom ?? now), todayActualFocusMs: 0 };
      this.db.prepare('INSERT INTO presence VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET value=excluded.value,expires=excluded.expires')
        .run(token.user, canonical(snapshot), expires);
      return { accepted: true, expiresAt: new Date(expires).toISOString() };
    });
  }
}
