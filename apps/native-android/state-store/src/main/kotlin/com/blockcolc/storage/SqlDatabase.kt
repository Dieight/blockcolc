package com.blockcolc.storage

/** SQL is shared verbatim by Android SQLite and the real SQLite JVM contract tests. */
interface SqlSession {
    fun execute(sql: String, args: List<Any?> = emptyList()): Int
    fun query(sql: String, args: List<Any?> = emptyList()): List<List<Any?>>
    /** Non-null text cells that may exceed an Android CursorWindow. */
    fun largeTextRows(sql:String,args:List<Any?> = emptyList()):List<List<String>> =
        query(sql,args).map{row->row.map{it as String}}
    /** Exactly one non-null text cell, including cells larger than CursorWindow. */
    fun largeText(sql:String,args:List<Any?> = emptyList()):String = largeTextRows(sql,args).single().single()
    /** Required immutable body selected by blueprint_assets' primary key. */
    fun blueprintBody(sha:String):String = largeText("SELECT canonical FROM blueprint_assets WHERE sha=?",listOf(sha))
    /** Optional proof that this connection's transactional inputs are unchanged.
     * A provider must identify physical reconnections and local/external writes,
     * schema changes and rollbacks. A TEMP schema version also attests that
     * changes is SQLite's connection-wide total_changes() counter, including
     * changes in triggers and foreign-key actions. Unsupported providers keep
     * full row reads after writes. */
    fun readStamp():SqlReadStamp? = null
}
data class SqlReadStamp(val connection:String,val externalVersion:Long,val changes:Long,val schemaVersion:Long,val rollbackVersion:Long,
    val tempSchemaVersion:Long?=null)
interface SqlDatabase : AutoCloseable {
    fun <T> transaction(block: (SqlSession) -> T): T
}
object StateSchema {
    const val VERSION = 2
    val originalStatements = listOf(
        "CREATE TABLE state_meta (id INTEGER PRIMARY KEY CHECK(id=1), layout_version INTEGER NOT NULL, revision INTEGER NOT NULL CHECK(revision>=0), replacement_generation INTEGER NOT NULL CHECK(replacement_generation>=0), domain_sha TEXT NOT NULL)",
        "CREATE TABLE domain_values (name TEXT PRIMARY KEY NOT NULL, canonical TEXT NOT NULL)",
        "CREATE TABLE domain_records (section TEXT NOT NULL, record_key TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal>=0), canonical TEXT NOT NULL, PRIMARY KEY(section,record_key))",
        "CREATE INDEX domain_records_order ON domain_records(section,ordinal)",
        "CREATE TABLE blueprint_assets (sha TEXT PRIMARY KEY NOT NULL CHECK(length(sha)=64), canonical TEXT NOT NULL)",
        "CREATE TABLE local_recovery (id INTEGER PRIMARY KEY CHECK(id=1), canonical TEXT NOT NULL)",
        "CREATE TABLE command_receipts (base_generation INTEGER NOT NULL, request_id TEXT NOT NULL, request_sha TEXT NOT NULL, kind TEXT NOT NULL, committed_revision INTEGER NOT NULL, committed_generation INTEGER NOT NULL, PRIMARY KEY(base_generation,request_id))",
    )
    private val backupStatements = listOf(
        "ALTER TABLE command_receipts ADD COLUMN intent_sha TEXT",
        "ALTER TABLE command_receipts ADD COLUMN rollback_id TEXT",
        "CREATE TABLE backup_blocks (sha TEXT PRIMARY KEY NOT NULL, canonical TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes>0))",
        "CREATE TABLE backup_roots (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('rollback','daily')), created_at TEXT NOT NULL, local_date TEXT, source_revision INTEGER NOT NULL, reason TEXT NOT NULL, source TEXT, manifest TEXT NOT NULL, manifest_sha TEXT NOT NULL, domain_sha TEXT NOT NULL)",
        "CREATE TABLE backup_links (root_id TEXT NOT NULL REFERENCES backup_roots(id) ON DELETE CASCADE, sha TEXT NOT NULL REFERENCES backup_blocks(sha), PRIMARY KEY(root_id,sha))",
        "CREATE INDEX backup_links_content ON backup_links(sha)",
    )
    val statements = originalStatements + backupStatements
    fun create(sql: SqlSession) { statements.forEach { sql.execute(it) } }
    fun upgrade(sql: SqlSession, old: Int, new: Int) {
        if (old != 1 || new != VERSION) throw StorageCorruption("Unsupported database migration $old -> $new")
        backupStatements.forEach { sql.execute(it) }
        sql.execute("UPDATE state_meta SET layout_version=? WHERE id=1", listOf(VERSION))
    }
}
class StorageConflict(val reason: String) : IllegalStateException(reason)
class StorageCorruption(detail: String, cause: Throwable? = null) : IllegalStateException(detail, cause)
data class StateToken(val revision: Long, val replacementGeneration: Long)
data class StoredState(val token: StateToken, val domain: com.blockcolc.domain.DomainDocument, val recovery: RecoveryContext)
data class CommitReceipt(val token: StateToken, val replayed: Boolean, val rollbackId: String? = null)
