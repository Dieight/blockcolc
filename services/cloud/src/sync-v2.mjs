import { canonical, fail, sha } from './wire.mjs';

const packages = ['building', 'focus'];
const retainedRevisions = 512;
const emptyHash = sha('');
const presenceGraceMs = 90_000;
const focusEffects = new Set(['projects', 'habitBuildings', 'dailyGoals', 'projectConditions',
  'decorationRewards', 'holidayRewards', 'retiredSubtaskIds']);

export function focusEntry(key) {
  return key === '$/activeFocusSession' || key === '@plan' ||
    key.startsWith('focusHistory/') || key.startsWith('progressReports/');
}

export function focusEffect(key) {
  return focusEntry(key) || key === '$/activeProjectId' || focusEffects.has(key.substring(0, key.indexOf('/')));
}

function packageFor(key) {
  return focusEntry(key) ? 'focus' : 'building';
}

export function hasOverlappingHistory(changes, previous) {
  const additions = changes.filter(change => change.key.startsWith('focusHistory/') && change.canonical != null && !previous[change.key]);
  if (!additions.length) return false;
  const range = wire => {
    const value = JSON.parse(wire).value;
    const start = Date.parse(value.startedAt);
    return [start, start + value.actualDurationMs];
  };
  const committed = Object.entries(previous).filter(([key]) => key.startsWith('focusHistory/')).map(([, wire]) => range(wire));
  return additions.some(({ canonical: wire }) => {
    const [start, end] = range(wire);
    return end > start && committed.some(([from, to]) => to > from && from < end && start < to);
  });
}

/** The legacy store is migrated before accepting requests. The change index
 * retains only the newest version of each key, including deletion markers. */
export class SyncV2 {
  constructor(cloud) {
    this.cloud = cloud;
    this.db = cloud.db;
    const db = this.db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_v2_packages (
        user TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        package TEXT NOT NULL, revision INTEGER NOT NULL, hash TEXT NOT NULL,
        PRIMARY KEY(user,package)
      );
      CREATE TABLE IF NOT EXISTS sync_v2_changes (
        user TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        package TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL,
        PRIMARY KEY(user,package,key)
      );
      CREATE INDEX IF NOT EXISTS sync_v2_changes_revision ON sync_v2_changes(user,package,revision);
      CREATE TABLE IF NOT EXISTS sync_v2_focus (
        user TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        phase TEXT NOT NULL, session TEXT, value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_v2_day_totals (
        user TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        zone TEXT NOT NULL, value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_v2_migrations (version INTEGER PRIMARY KEY);
    `);
    const migrated = version => db.prepare('SELECT 1 FROM sync_v2_migrations WHERE version=?').get(version) !== undefined;
    if (migrated(3)) return;
    cloud.transaction(() => {
      if (!migrated(2)) {
        if (db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='entries'").get()) {
          db.exec('INSERT INTO sync_entries(user,key,canonical,sha) SELECT user,key,canonical,sha FROM entries');
        }
        for (const account of db.prepare('SELECT id FROM accounts').iterate()) {
          const keys = db.prepare('SELECT key FROM sync_entries WHERE user=?').all(account.id).map(row => row.key);
          if (keys.length) this.record(account.id, keys, { migrate: true });
        }
        db.prepare('INSERT INTO sync_v2_migrations VALUES(2)').run();
      } else {
        const projected = db.prepare('SELECT user,value FROM sync_v2_focus').all();
        for (const { user, value } of projected) {
          // Backfilling the expiry does not turn a stored observation into a
          // new observation or override a later legacy idle report.
          this.projectFocus(user, true, JSON.parse(value).updatedAt);
        }
      }
      db.prepare('INSERT INTO sync_v2_migrations VALUES(3)').run();
    });
  }

  packageHeads(user) {
    const heads = Object.fromEntries(packages.map(name => [name, { revision: 0, hash: emptyHash }]));
    for (const { package: name, revision, hash } of this.db.prepare(
      'SELECT package,revision,hash FROM sync_v2_packages WHERE user=?'
    ).iterate(user)) heads[name] = { revision, hash };
    return heads;
  }

  head(s) {
    const h = this.cloud.head(s.user);
    const focusLocked = this.locked(s.user);
    return {
      schema: 2, epoch: h.epoch, revision: h.revision, serverTime: this.cloud.clock(),
      execution: { owner: h.owner, generation: h.execution }, packages: this.packageHeads(s.user),
      focusLocked,
      claimable: h.owner == null && !focusLocked,
      backup: this.cloud.backupInfo(s),
    };
  }

  pull(s, { epoch, known }) {
    fail(known && typeof known === 'object' && !Array.isArray(known));
    const head = this.head(s), result = {};
    const read = this.db.prepare('SELECT key,canonical FROM sync_entries WHERE user=? AND package=? ORDER BY key');
    const changed = this.db.prepare(`SELECT c.key,e.canonical FROM sync_v2_changes c
      LEFT JOIN sync_entries e ON e.user=c.user AND e.key=c.key
      WHERE c.user=? AND c.package=? AND c.revision>? ORDER BY c.key`);
    for (const name of packages) {
      const latest = head.packages[name], previous = known[name];
      if (epoch === head.epoch && previous?.revision === latest.revision && previous?.hash === latest.hash) continue;
      const since = previous?.revision;
      const snapshot = epoch !== head.epoch || !Number.isSafeInteger(since) || since < 0 ||
        since >= latest.revision || latest.revision - since > retainedRevisions;
      const rows = snapshot
        ? read.all(s.user, name)
        : changed.all(s.user, name, since);
      result[name] = { snapshot, entries: Object.fromEntries(rows.map(row => [row.key, row.canonical])) };
    }
    return { ...head, delta: result };
  }

  // Called by every facts writer inside the same transaction as its mutation.
  record(user, keys, { migrate = false, reset = false } = {}) {
    if (!keys.length) return;
    const heads = this.packageHeads(user), db = this.db;
    const entries = db.prepare('SELECT key,sha FROM sync_entries WHERE user=? AND package=? ORDER BY key');
    const writePackage = db.prepare(`INSERT INTO sync_v2_packages VALUES(?,?,?,?)
      ON CONFLICT(user,package) DO UPDATE SET revision=excluded.revision,hash=excluded.hash`);
    const writeChange = db.prepare(`INSERT INTO sync_v2_changes VALUES(?,?,?,?)
      ON CONFLICT(user,package,key) DO UPDATE SET revision=excluded.revision`);
    for (const name of packages) {
      const changed = keys.filter(key => packageFor(key) === name);
      if (!changed.length) continue;
      const revision = heads[name].revision + 1;
      const hash = sha(entries.all(user, name).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
        .map(row => canonical([row.key, row.sha]) + '\n').join(''));
      writePackage.run(user, name, revision, hash);
      for (const key of changed) writeChange.run(user, name, key, revision);
      // A forgotten deletion must never be served as an incremental update.
      db.prepare('DELETE FROM sync_v2_changes WHERE user=? AND package=? AND revision<=?')
        .run(user, name, revision - retainedRevisions);
    }
    if (reset || keys.includes('$/activeFocusSession') || keys.includes('@plan')) {
      const observed = migrate ? new Date(this.cloud.head(user).changed).toISOString() : undefined;
      this.projectFocus(user, reset, observed);
    }
    if (keys.some(key => key.startsWith('focusHistory/'))) this.refreshDayTotals(user, this.cloud.account(user).timeZone);
  }

  projectFocus(user, refresh, observedAt) {
    const db = this.db, now = this.cloud.clock();
    const entry = db.prepare('SELECT canonical FROM sync_entries WHERE user=? AND key=?');
    const active = JSON.parse(entry.get(user, '$/activeFocusSession')?.canonical ?? 'null');
    const plan = JSON.parse(entry.get(user, '@plan')?.canonical ?? '{}').plan;
    const phase = active ? (plan?.extensionStartedAt ? 'extension' : 'focus') : plan?.phase === 'REST' ? 'rest' :
      plan?.hasStarted ? (plan.phase === 'REPORT' ? 'report' : 'waiting') : 'idle';
    const session = active?.id ?? (phase === 'rest' ? plan.id + ':' + plan.completedSessionIds.length : plan?.hasStarted ? plan.id : null);
    const previous = db.prepare('SELECT phase,session,value FROM sync_v2_focus WHERE user=?').get(user);
    const seenStart = Date.parse(phase === 'rest' ? plan.restStartedAt : plan?.extensionStartedAt ?? active?.startedAt);
    const seenEnd = Date.parse(phase === 'rest' ? plan.phaseEndsAt : active?.marathon ? plan?.exactEndAt ?? active.endsAt : active?.endsAt);
    const phaseEnd = Date.parse(phase === 'rest' ? plan.phaseEndsAt : active?.endsAt);
    const statusExpiresAt = Number.isFinite(phaseEnd) ? new Date(phaseEnd + presenceGraceMs).toISOString() : null;
    const prior = JSON.parse(previous?.value ?? '{}');
    if (previous?.phase === phase && previous.session === session && prior.statusExpiresAt === statusExpiresAt && !refresh) return;
    const begin = active || phase === 'rest' ? (Number.isFinite(seenStart) ? Math.min(now, seenStart) : now) : null;
    const until = begin != null && phase !== 'extension' && seenEnd > begin ? seenEnd : null;
    const closedStart = ['focus', 'extension'].includes(previous?.phase) && previous.session !== session ? prior.startedAt : null;
    const closedThrough = [closedStart, prior.closedThrough].filter(Boolean).sort().at(-1) ?? null;
    let currentName = null;
    if (phase === 'focus' || phase === 'extension') {
      const project = JSON.parse(entry.get(user, 'projects/' + active.projectId)?.canonical ?? 'null')?.value;
      currentName = active.marathon || phase === 'extension' ? '专注中' : active.deferredSettlement ? '极简模式' :
        project?.subtasks?.find(task => task.id === active.subtaskId)?.title ?? '专注中';
    } else if (phase === 'rest') currentName = '休息';
    const snapshot = {
      currentName, startedAt: begin == null ? null : new Date(begin).toISOString(),
      estimatedEndsAt: until == null ? null : new Date(until).toISOString(),
      updatedAt: observedAt ?? new Date(now).toISOString(),
      statusExpiresAt, closedThrough,
      ...(phase === 'rest' ? { externalState: 'rest' } : {}),
      ...(begin != null ? { estimated: true } : {}),
    };
    db.prepare(`INSERT INTO sync_v2_focus VALUES(?,?,?,?) ON CONFLICT(user) DO UPDATE SET
      phase=excluded.phase,session=excluded.session,value=excluded.value`).run(user, phase, session, canonical(snapshot));
  }

  live(user) {
    const row = this.db.prepare('SELECT phase,value FROM sync_v2_focus WHERE user=?').get(user);
    if (!row) return null;
    const value = JSON.parse(row.value);
    return { value, phase: row.phase, persistent: true, stale: Date.parse(value.statusExpiresAt) <= this.cloud.clock() };
  }

  locked(user) {
    if (this.cloud.integrations.externalBusy(user)) return true;
    const row = this.db.prepare('SELECT phase FROM sync_v2_focus WHERE user=?').get(user);
    return row != null && row.phase !== 'idle';
  }

  refreshDayTotals(user, zone) {
    const totals = this.cloud.calculateDayTotals(user, zone);
    this.db.prepare(`INSERT INTO sync_v2_day_totals VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET
      zone=excluded.zone,value=excluded.value`).run(user, zone, canonical(totals));
  }

  dayTotals(user, zone) {
    const row = this.db.prepare('SELECT value FROM sync_v2_day_totals WHERE user=? AND zone=?').get(user, zone);
    return row ? JSON.parse(row.value) : null;
  }
}
