import { randomBytes } from 'node:crypto';
import { fail, sha } from './wire.mjs';

const DAY = 86_400_000;
const VISIT_GAP = 5 * 60_000;
const PAGE_SIZE = 50;
export const VIEWER_SESSION_SECONDS = 30 * DAY / 1000;

function localDate(now) {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
}

function dateMillis(date) {
  fail(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date));
  const milliseconds = Date.parse(date + 'T00:00:00Z');
  fail(Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === date);
  return milliseconds;
}

export class FocusViewerStore {
  constructor(cloud, { owner, from }) {
    this.cloud = cloud;
    this.owner = owner;
    this.startDay = dateMillis(from);
    cloud.account(owner);
    fail(!cloud.db.prepare('SELECT 1 FROM external_sources WHERE user=?').get(owner));
    this.db = cloud.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS viewer_sessions(
        token TEXT PRIMARY KEY, user TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        salt TEXT NOT NULL, expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS viewer_visits(
        id INTEGER PRIMARY KEY, owner TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        visitor TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        day TEXT NOT NULL, at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS viewer_visits_day ON viewer_visits(owner,day,at DESC,id DESC);
      CREATE TABLE IF NOT EXISTS viewer_visit_totals(
        owner TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        visitor TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        visits INTEGER NOT NULL, PRIMARY KEY(owner,visitor)
      );
      CREATE INDEX IF NOT EXISTS viewer_visits_visitor ON viewer_visits(owner,visitor,at DESC);
    `);
  }

  async signIn(action, input) {
    const { username, password } = input;
    const identity = action === 'register'
      ? await this.cloud.createAccount({ username, password, name: username, timeZone: input.timeZone })
      : await this.cloud.verifyCredentials({ username, password });
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO viewer_sessions VALUES(?,?,?,?)')
      .run(sha(token), identity.id, identity.salt, this.cloud.clock() + VIEWER_SESSION_SECONDS * 1000);
    return token;
  }

  session(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return this.sessionByDigest(sha(token));
  }

  sessionByDigest(digest) {
    return this.db.prepare(`
      SELECT s.token, a.id, a.username FROM viewer_sessions s JOIN accounts a ON a.id=s.user
      WHERE s.token=? AND s.expires>? AND s.salt=a.salt
    `).get(digest, this.cloud.clock()) ?? null;
  }

  async changePassword(session, input) {
    await this.cloud.replacePassword(session.id, input, {
      authorize: () => fail(this.sessionByDigest(session.token)?.id === session.id, 'UNAUTHORIZED', 401),
      renewViewer: salt => this.db.prepare('UPDATE viewer_sessions SET salt=? WHERE token=?').run(salt, session.token),
    });
  }

  logout(session) {
    this.db.prepare('DELETE FROM viewer_sessions WHERE token=?').run(session.token);
  }

  prune() {
    const now = this.cloud.clock();
    this.db.prepare('DELETE FROM viewer_visits WHERE owner=? AND day<?').run(this.owner, localDate(now));
    this.db.prepare(`DELETE FROM viewer_sessions WHERE expires<=? OR NOT EXISTS (
      SELECT 1 FROM accounts a WHERE a.id=viewer_sessions.user AND a.salt=viewer_sessions.salt
    )`).run(now);
  }

  recordVisit(session) {
    if (session.id === this.owner) return;
    const now = this.cloud.clock(), day = localDate(now);
    this.cloud.transaction(() => {
      const last = this.db.prepare('SELECT at FROM viewer_visits WHERE owner=? AND visitor=? AND day=? ORDER BY at DESC LIMIT 1')
        .get(this.owner, session.id, day);
      if (last && now - last.at < VISIT_GAP) return;
      this.db.prepare('INSERT INTO viewer_visits(owner,visitor,day,at) VALUES(?,?,?,?)')
        .run(this.owner, session.id, day, now);
      this.db.prepare(`INSERT INTO viewer_visit_totals VALUES(?,?,1)
        ON CONFLICT(owner,visitor) DO UPDATE SET visits=visits+1`).run(this.owner, session.id);
    });
  }

  visits(session, todayPage, rankPage) {
    fail(session.id === this.owner, 'FORBIDDEN', 403);
    const day = localDate(this.cloud.clock());
    const read = (sql, args, page) => {
      const rows = this.db.prepare(sql).all(...args, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
      return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
    };
    const today = read(`SELECT a.username, v.at FROM viewer_visits v JOIN accounts a ON a.id=v.visitor
      WHERE v.owner=? AND v.day=? ORDER BY v.at DESC, v.id DESC LIMIT ? OFFSET ?`, [this.owner, day], todayPage);
    const ranking = read(`SELECT a.username, v.visits FROM viewer_visit_totals v JOIN accounts a ON a.id=v.visitor
      WHERE v.owner=? ORDER BY v.visits DESC, a.username LIMIT ? OFFSET ?`, [this.owner], rankPage);
    return { day, today, ranking };
  }

  daily(now, head) {
    const date = localDate(now);
    if (this.cachedDays?.date !== date || this.cachedDays.epoch !== head.epoch || this.cachedDays.revision !== head.revision) {
      this.cachedDays = {
        date, epoch: head.epoch, revision: head.revision,
        version: dateMillis(date) + head.revision,
        totals: this.cloud.dayTotals(this.owner, 'Asia/Shanghai'),
      };
    }
    return this.cachedDays;
  }

  snapshot() {
    const now = this.cloud.clock(), head = this.cloud.head(this.owner);
    const days = this.daily(now, head);
    const presence = this.cloud.liveStatus(this.owner);
    const observed = presence?.value;
    const capturedAt = new Date(Math.min(now, Math.max(head.changed, Date.parse(observed?.updatedAt) || 0))).toISOString();
    const start = Date.parse(observed?.startedAt), end = Date.parse(observed?.estimatedEndsAt);
    const openEnded = observed?.estimatedEndsAt === null;
    const active = !presence?.stale && observed?.currentName && observed.externalState !== 'rest' && start <= now &&
      (presence.persistent || presence.expires > now && (openEnded || end > now));
    const snapshot = {
      currentName: active ? observed.currentName : null,
      startedAt: active ? observed.startedAt : null,
      estimatedEndsAt: active ? observed.estimatedEndsAt : null,
      estimatedElapsedMs: active ? Math.max(0, Date.parse(capturedAt) - start) : 0,
      todayActualFocusMs: Math.min(DAY, days.totals[days.date] ?? 0),
      ...(presence?.stale ? { stale: true } : {}),
      ...(active && openEnded ? { waitingForEnd: true } : {}),
      ...(active && observed.estimated ? { estimated: true } : {}),
    };
    return {
      live: { schemaVersion: 1, sourceEpoch: head.epoch, revision: head.revision, capturedAt, snapshot },
      daysVersion: days.version,
      serverTime: new Date(now).toISOString(),
    };
  }

  days(from, through) {
    const now = this.cloud.clock();
    const since = dateMillis(from), until = dateMillis(through);
    fail(since <= until && until - since < 366 * DAY);
    const daily = this.daily(now, this.cloud.head(this.owner));
    const today = dateMillis(daily.date);
    const days = [];
    for (let start = Math.max(since, this.startDay); start <= Math.min(until, today); start += DAY) {
      const date = new Date(start).toISOString().slice(0, 10);
      days.push({ date, actualFocusMs: Math.min(DAY, daily.totals[date] ?? 0), confirmed: start < today });
    }
    return { days, daysVersion: daily.version, nextFrom: null };
  }
}
