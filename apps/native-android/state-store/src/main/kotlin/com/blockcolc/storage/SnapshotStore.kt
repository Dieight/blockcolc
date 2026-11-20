package com.blockcolc.storage

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainTime
import com.blockcolc.domain.StrictJson
import org.json.JSONArray
import org.json.JSONObject

data class BackupRoot(val id: String, val kind: String, val createdAt: String, val date: String?, val sourceRevision: Long, val reason: String, val source: String?, val domainSha: String, val bytes: Long)
data class BackupArchive(val id: String, val createdAt: String, val date: String?, val sourceRevision: Long,
    val reason: String, val source: String?, val domain: DomainDocument)
data class RollbackRequest(val createdAt: String, val reason: String, val source: String)
data class DailyCapture(val root: BackupRoot?, val changed: Boolean, val overBudget: Boolean = false)
internal data class PreparedSnapshot(val manifest: String, val manifestSha: String, val domainSha: String, val blocks: Map<String, String>) {
    val bytes: Long by lazy { StrictJson.utf8Size(manifest) + blocks.values.sumOf(StrictJson::utf8Size) }
}
internal data class SnapshotBlockRow(val body:String,val bytes:String)

/** Independent content-addressed roots; no daily patch chains and no local automatic grant. */
internal object SnapshotStore {
    private val digestPattern=Regex("[a-f0-9]{64}")
    const val DAILY_BYTES = 200L * 1024 * 1024
    fun metadataBytes(id: String, kind: String, at: String, date: String?, revision: Long, reason: String, source: String?, domainSha: String, manifestSha: String): Long =
        StrictJson.measure(JSONObject().put("id", id).put("kind", kind).put("createdAt", at).put("date", date ?: JSONObject.NULL)
            .put("sourceRevision", revision).put("reason", reason).put("source", source ?: JSONObject.NULL).put("domainSha", domainSha).put("manifestSha", manifestSha))
    fun prepare(domain: DomainDocument): PreparedSnapshot {
        val layout = RecordLayout.split(domain); val blocks = LinkedHashMap<String, String>()
        fun block(value: String): String = StrictJson.sha(value).also { blocks[it] = value }
        val values = JSONObject(); layout.values.forEach { (k, v) -> values.put(k, block(v)) }
        val records = JSONArray(); layout.records.forEach { r -> records.put(JSONObject().put("section", r.section).put("key", r.key).put("ordinal", r.ordinal).put("sha", block(r.canonical))) }
        val assets = JSONArray(); layout.assets.toSortedMap().forEach { (sha, body) -> check(block(body) == sha); assets.put(sha) }
        val manifest = StrictJson.render(JSONObject().put("schema", 1).put("values", values).put("records", records).put("assets", assets))
        return PreparedSnapshot(manifest, StrictJson.sha(manifest), domain.sha256, java.util.Collections.unmodifiableMap(blocks))
    }
    fun save(sql: SqlSession, id: String, kind: String, at: String, date: String?, revision: Long, reason: String, source: String?, prepared: PreparedSnapshot): BackupRoot {
        DomainTime.instant(at); if (date != null) DomainTime.date(date)
        for ((sha, body) in prepared.blocks) {
            val bytes=StrictJson.utf8Size(body)
            sql.execute("INSERT OR IGNORE INTO backup_blocks(sha,canonical,bytes) VALUES(?,?,?)", listOf(sha, body, bytes))
            val saved = sql.largeTextRows("SELECT canonical,CAST(bytes AS TEXT) AS bytes FROM backup_blocks WHERE sha=?", listOf(sha)).single()
            if (saved[0] != body || saved[1].toLong() != bytes) throw StorageCorruption("Conflicting backup content")
        }
        sql.execute("INSERT INTO backup_roots(id,kind,created_at,local_date,source_revision,reason,source,manifest,manifest_sha,domain_sha) VALUES(?,?,?,?,?,?,?,?,?,?)", listOf(id, kind, at, date, revision, reason, source, prepared.manifest, prepared.manifestSha, prepared.domainSha))
        prepared.blocks.keys.forEach { sql.execute("INSERT INTO backup_links(root_id,sha) VALUES(?,?)", listOf(id, it)) }
        return BackupRoot(id, kind, at, date, revision, reason, source, prepared.domainSha, prepared.bytes + metadataBytes(id, kind, at, date, revision, reason, source, prepared.domainSha, prepared.manifestSha))
    }
    fun list(sql: SqlSession, kind: String? = null): List<BackupRoot> {
        val rows = sql.query("SELECT id,kind,created_at,local_date,source_revision,reason,source,domain_sha,manifest,manifest_sha FROM backup_roots" + if (kind == null) " ORDER BY sequence DESC" else " WHERE kind=? ORDER BY sequence DESC", if (kind == null) emptyList() else listOf(kind))
        return rows.map { row ->
            val id = row[0] as String
            val size = (sql.query("SELECT COALESCE(SUM(b.bytes),0) FROM backup_links l JOIN backup_blocks b ON l.sha=b.sha WHERE l.root_id=?", listOf(id)).single()[0] as Number).toLong() + StrictJson.utf8Size(row[8] as String)
            val root = BackupRoot(id, row[1] as String, row[2] as String, row[3] as String?, (row[4] as Number).toLong(), row[5] as String, row[6] as String?, row[7] as String, size)
            try { DomainTime.instant(root.createdAt); if (root.date != null) DomainTime.date(root.date)
                check(root.sourceRevision >= 0 && root.kind in setOf("daily", "rollback") && (root.kind != "daily" || root.date != null) && digestPattern.matches(root.domainSha))
            } catch (e: Exception) { throw StorageCorruption("Invalid recovery metadata", e) }
            root.copy(bytes = size + metadataBytes(id, root.kind, root.createdAt, root.date, root.sourceRevision, root.reason, root.source, root.domainSha, row[9] as String))
        }
    }
    fun read(sql: SqlSession, id: String,known:ValidatedRecordContent?=null,transactionBlocks:Map<String,SnapshotBlockRow>?=null): DomainDocument {
        try {
            val root = sql.query("SELECT manifest,manifest_sha,domain_sha FROM backup_roots WHERE id=?", listOf(id)).singleOrNull() ?: throw BackupRejected("Recovery root not found")
            val manifest = root[0] as String
            if (StrictJson.sha(manifest) != root[1]) throw StorageCorruption("Backup manifest digest mismatch")
            val m = StrictJson.parse(manifest) as JSONObject
            check(m.keys().asSequence().toSet() == setOf("schema", "values", "records", "assets") && m.get("schema") is Number && m.getDouble("schema") == 1.0)
            val links = sql.query("SELECT sha FROM backup_links WHERE root_id=?", listOf(id)).map { it[0] as String }.toSet()
            val used = HashSet<String>(); val cache = HashMap<String, String>(); var bytes = 0L
            // History roots contain thousands of small immutable records.
            // Read those in bounded groups rather than opening a cursor for
            // each one. Actual SQL byte length bounds prefetch memory even
            // when a damaged row declares an incorrect size. Large bodies
            // keep the existing scalar path; every consumed row is still
            // checked below before it can contribute to the domain.
            val accessOrder=linkedSetOf<String>()
            if(transactionBlocks==null){
                val values=m.getJSONObject("values");values.keys().forEach{accessOrder.add(values.get(it) as String)}
                val records=m.getJSONArray("records");for(i in 0 until records.length())accessOrder.add(records.getJSONObject(i).get("sha") as String)
                val assets=m.getJSONArray("assets");for(i in 0 until assets.length())accessOrder.add(assets.get(i) as String)
            }
            val batches=accessOrder.toList().chunked(64)
            val batchById=HashMap<String,Int>()
            batches.forEachIndexed{index,ids->ids.forEach{batchById[it]=index}}
            var currentBatch=-1;val pending=HashMap<String,SnapshotBlockRow>()
            fun storedBlock(sha:String):SnapshotBlockRow? {
                if(transactionBlocks!=null)return transactionBlocks[sha]
                val batch=checkNotNull(batchById[sha])
                if(currentBatch!=batch){
                    currentBatch=batch;pending.clear()
                    val ids=batches[batch]
                    val placeholders=ids.joinToString(","){"?"}
                    val rows=sql.largeTextRows("SELECT sha,canonical,CAST(bytes AS TEXT) AS bytes FROM backup_blocks WHERE sha IN ($placeholders) AND length(CAST(canonical AS BLOB))<=32768",ids)
                    for(row in rows){check(row[0] in ids&&pending.put(row[0],SnapshotBlockRow(row[1],row[2]))==null)}
                }
                return pending.remove(sha)?:sql.largeTextRows("SELECT canonical,CAST(bytes AS TEXT) AS bytes FROM backup_blocks WHERE sha=?",listOf(sha))
                    .singleOrNull()?.let{SnapshotBlockRow(it[0],it[1])}
            }
            fun block(sha: String): String {
                check(digestPattern.matches(sha) && sha in links); used.add(sha)
                return cache.getOrPut(sha) {
                    // A caller that already read this entire table in the
                    // enclosing transaction supplies those same immutable
                    // strings, not a cache from another snapshot or process.
                    val row=storedBlock(sha)
                    if(row==null)throw StorageCorruption("Missing backup content")
                    val body = row.body; val size = StrictJson.utf8Size(body)
                    check(size == row.bytes.toLong() && StrictJson.sha(body) == sha)
                    bytes += size; check(bytes <= StrictJson.EXPANDED_LIMIT); body
                }
            }
            val v = m.getJSONObject("values"); val values = v.keys().asSequence().associateWith { key -> check(v.get(key) is String); block(v.getString(key)) }
            val records = m.getJSONArray("records"); val rows = (0 until records.length()).map { i ->
                val r = records.getJSONObject(i); check(r.keys().asSequence().toSet() == setOf("section", "key", "ordinal", "sha"))
                for (k in listOf("section", "key", "sha")) check(r.get(k) is String)
                val n = r.get("ordinal"); check(n is Number && n.toDouble() == n.toInt().toDouble() && n.toInt() >= 0)
                StateRecord(r.getString("section"), r.getString("key"), (n as Number).toInt(), block(r.getString("sha")))
            }
            val assets = m.getJSONArray("assets"); val assetIds = (0 until assets.length()).map { i -> check(assets.get(i) is String); assets.getString(i) }
            check(assetIds.toSet().size == assetIds.size)
            val assetBodies=assetIds.associateWith{block(it)}
            // Only identical, fully checked stored content can reuse a domain
            // that has already passed semantic validation. A declared SHA or
            // revision alone never authorizes this path; every block, size,
            // link and asset reference remains checked in this transaction.
            if(known!=null&&known.domain.sha256==root[2]&&RecordLayout.contentDigest(values,rows,RecordLayout.verifiedAssetKeysDigest(assetBodies.keys))==known.digest){
                check(used==links&&RecordLayout.referencedAssets(rows)==assetIds.toSet())
                return known.domain
            }
            val referencedAssets = HashSet<String>()
            val domain = RecordLayout.join(values, rows) { sha -> check(sha in assetIds); referencedAssets.add(sha); block(sha) }
            check(used == links && referencedAssets == assetIds.toSet() && domain.sha256 == root[2])
            return domain
        } catch (e: BackupRejected) { throw e } catch (e: StorageCorruption) { throw e }
        catch (e: Exception) { throw StorageCorruption("Recovery data invalid; current state unchanged", e) }
    }
    fun prune(sql: SqlSession,known:ValidatedRecordContent?=null) {
        // Validate before pruning so corruption cannot silently replace the last good checkpoint.
        val roots = list(sql)
        roots.forEach { read(sql, it.id,known) }
        val obsolete = roots.filter { it.kind == "rollback" }.drop(2)
        obsolete.forEach { sql.execute("DELETE FROM backup_roots WHERE id=?", listOf(it.id)) }
        collect(sql)
    }
    fun collect(sql: SqlSession) { sql.execute("DELETE FROM backup_blocks WHERE sha NOT IN (SELECT sha FROM backup_links)") }
}
