package com.blockcolc.storage

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.BlueprintReadProofs
import com.blockcolc.domain.CanonicalReadCandidate
import com.blockcolc.domain.PipelineCost
import com.blockcolc.domain.StrictJson

/** The sole persisted write boundary. Call on an IO executor, publish only after it returns. */
class NativeStateStore(private val db: SqlDatabase, private val checkpoint: (String) -> Unit = {}) {
    private var readCache:DomainReadCache?=null
    constructor(db:SqlDatabase,readCache:DomainReadCache,checkpoint:(String)->Unit={}):this(db,checkpoint){this.readCache=readCache}
    // Reuse validation after an unchanged physical-connection read stamp, or
    // comparison of actual persisted inputs in this transaction. Application
    // revision alone would conceal a corrupt row.
    // Small proofs retain their bounded rows. Larger proofs keep only a digest
    // of ALL actual row contents plus the current immutable domain document.
    private data class AssetRanges(val owners:Map<String,Pair<String,String>>,val digest:String){
        fun matches(domain:DomainDocument,actual:Map<String,String>):Boolean =
            owners.keys==actual.keys&&owners.all{(sha,owner)->
                domain.matchesBlueprintCanonical(owner.first,owner.second,actual.getValue(sha))
            }
    }
    private data class ReadProof(val meta:Meta,val values:Map<String,String>,val records:List<StateRecord>,val assets:Map<String,String>,val local:String,
        val matchedAssetRanges:AssetRanges?=null,val checkedAssetDigest:String?=null,val checkedContentDigest:String?=null,
        val completedScans:BlueprintReadProofs?=null,val rawCandidate:CanonicalReadCandidate?=null){
        val controlCharacters by lazy{ControlRows(values,records,local).characters}
        val assetCharacters by lazy{assets.values.sumOf{it.length.toLong()}}
        val assetDigest by lazy{matchedAssetRanges?.digest?:checkedAssetDigest?:RecordLayout.verifyAssetDigest(assets)}
        val contentDigest by lazy{checkedContentDigest?:RecordLayout.contentDigest(values,records,assetDigest)}
    }
    private data class Validated(val rows:ReadProof?,val digest:String?,val content:ValidatedRecordContent,val assetRanges:AssetRanges?=null){val domain get()=content.domain}
    private var validated:Validated?=null
    private data class FocusBase(val values:Map<String,String>,val records:List<StateRecord>,val assets:AssetRanges)
    private data class ReadCheckpoint(val stamp:SqlReadStamp,val token:StateToken,val local:String,val focusBase:FocusBase?)
    private var readCheckpoint:ReadCheckpoint?=null
    private data class ControlRows(val values:Map<String,String>,val records:List<StateRecord>,val local:String){
        val characters get()=values.entries.sumOf{it.key.length.toLong()+it.value.length}+
            records.sumOf{it.section.length.toLong()+it.key.length+it.canonical.length+16}+local.length
    }
    private data class FocusReadback(val stamp:SqlReadStamp,val meta:Meta,val controls:ControlRows,val assets:AssetRanges)
    private var focusReadback:FocusReadback?=null
    private var validatedRoots:String?=null
    private data class RootsCheckpoint(val stamp:SqlReadStamp,val roots:List<BackupRoot>)
    private var rootsCheckpoint:RootsCheckpoint?=null
    private val cacheCharacters=1024*1024 // At most 2 MiB of UTF-16 per proof/document.
    private val largeDocumentCharacters=32*1024*1024 // One immutable document; no retained large row copy.
    fun load(): StoredState? = db.transaction { read(it) }
    private fun cloudTable(sql:SqlSession){sql.execute("CREATE TABLE IF NOT EXISTS cloud_baseline(account TEXT PRIMARY KEY NOT NULL,canonical TEXT NOT NULL)")}
    fun cloudBaseline(account:String):CloudBaseline?=db.transaction{sql->cloudTable(sql);sql.query("SELECT canonical FROM cloud_baseline WHERE account=?",listOf(account)).singleOrNull()?.let{CloudBaseline.parse(it[0] as String)}}
    fun acknowledgeCloud(baseline:CloudBaseline)=db.transaction{sql->cloudTable(sql);sql.execute("INSERT OR REPLACE INTO cloud_baseline(account,canonical) VALUES(?,?)",listOf(baseline.account,baseline.canonical()))}
    /** The remote receipt and adopted local facts have one SQLite commit.
     * A crash cannot bless a baseline while leaving older domain rows. */
    fun adoptCloud(expected:StateToken,requestId:String,domain:DomainDocument,recovery:RecoveryContext,baseline:CloudBaseline,replacement:Boolean=false,preserveRollback:Boolean=replacement):CommitReceipt {
        db.transaction{cloudTable(it)}
        val rollback=if(preserveRollback)RollbackRequest(com.blockcolc.domain.DomainTime.format(System.currentTimeMillis()),"cloud-replace",baseline.account)else null
        return write(expected,requestId,domain,recovery,replacement,null,rollback){sql->
            sql.execute("INSERT OR REPLACE INTO cloud_baseline(account,canonical) VALUES(?,?)",listOf(baseline.account,baseline.canonical()))
        }
    }
    fun initialize(
        domain: DomainDocument,
        recovery: RecoveryContext = RecoveryContext(),
        archives: Sequence<BackupArchive> = emptySequence(),
    ): StoredState {
        recovery.validate(domain, 0)
        val local = recovery.canonical()
        val token = StateToken(0, 0)
        val layout = db.transaction { sql ->
            if (read(sql) != null) throw StorageConflict("ALREADY_INITIALIZED")
            val prepared = RecordLayout.split(domain)
            writeRecords(sql, prepared)
            sql.execute("INSERT INTO local_recovery(id,canonical) VALUES(1,?)", listOf(local))
            var daily = 0
            var rollbacks = 0
            for (archive in archives) {
                require(archive.id.isNotBlank() && archive.sourceRevision >= 0)
                val kind = if (archive.date == null) "rollback" else "daily"
                if (kind == "daily") require(++daily <= 1) else require(++rollbacks <= 2)
                val snapshot = SnapshotStore.prepare(archive.domain)
                val root = SnapshotStore.save(sql, archive.id, kind, archive.createdAt, archive.date, archive.sourceRevision,
                    archive.reason, archive.source, snapshot)
                if (kind == "daily") require(root.bytes <= SnapshotStore.DAILY_BYTES)
            }
            checkpoint("before-meta")
            sql.execute("INSERT INTO state_meta(id,layout_version,revision,replacement_generation,domain_sha) VALUES(1,?,0,0,?)", listOf(StateSchema.VERSION, domain.sha256))
            checkpoint("before-commit")
            prepared
        }
        // Like a regular write, seed the proof only after COMMIT. The next
        // load must still read and compare the actual rows and recovery state.
        val records = layout.records.sortedWith(compareBy<StateRecord>{it.section}.thenBy{it.ordinal})
        remember(ReadProof(Meta(token,domain.sha256),layout.values,records,layout.assets,local),domain,
            RecordLayout.verifiedAssetKeysDigest(layout.assets.keys))
        return StoredState(token, domain, recovery)
    }
    fun commit(expected: StateToken, requestId: String, domain: DomainDocument, recovery: RecoveryContext, intentSha: String? = null, rollback: RollbackRequest? = null): CommitReceipt = write(expected, requestId, domain, recovery, false, intentSha, rollback)
    /** Domain replacement always clears local plans and grants, even if imported session IDs match. */
    fun replace(expected: StateToken, requestId: String, domain: DomainDocument): CommitReceipt = write(expected, requestId, domain, RecoveryContext(), true, null, null)
    fun importBackup(expected: StateToken, requestId: String, backup: ParsedBackup, at: String): CommitReceipt = write(expected, requestId, backup.domain, RecoveryContext(), true, backup.checksum, RollbackRequest(at, "before-import", backup.checksum))
    fun restore(expected: StateToken, requestId: String, rootId: String, at: String): CommitReceipt {
        receipt(expected.replacementGeneration, requestId, StrictJson.sha("restore:$rootId"))?.let { return it }
        val domain = db.transaction { SnapshotStore.read(it, rootId,validated?.content) }
        return write(expected, requestId, domain, RecoveryContext(), true, StrictJson.sha("restore:$rootId"), RollbackRequest(at, "before-restore", rootId))
    }
    fun backupRoots(): List<BackupRoot> = db.transaction(::checkedBackupRoots)
    private fun checkedBackupRoots(sql:SqlSession):List<BackupRoot>{
        val stamp=sql.readStamp()
        rootsCheckpoint?.takeIf{stamp!=null&&it.stamp==stamp}?.let{return it.roots}
        rootsCheckpoint=null
        val digest=ExactReadDigest()
        digest.table(sql.query("SELECT * FROM backup_roots ORDER BY sequence"))
        digest.table(sql.query("SELECT root_id,sha FROM backup_links ORDER BY root_id,sha"))
        val blockRows=sql.largeTextRows("SELECT sha,canonical,CAST(bytes AS TEXT) AS bytes FROM backup_blocks ORDER BY sha")
        digest.table(blockRows)
        val proof=digest.finish()
        val roots=SnapshotStore.list(sql)
        if(proof!=validatedRoots){
            val blocks=blockRows.associate{it[0] to SnapshotBlockRow(it[1],it[2])}
            roots.forEach { SnapshotStore.read(sql,it.id,validated?.content,blocks) }
            validatedRoots=proof
        }
        val result=java.util.Collections.unmodifiableList(roots.toList())
        // A physical-connection stamp includes external writes, schema and
        // rollback generations. Do not bless an expected post-write stamp:
        // the first read after any change still checks actual blocks/links.
        if(stamp!=null)rootsCheckpoint=RootsCheckpoint(stamp,result)
        return result
    }
    fun exportBackup(at: String): String = BackupCodec.write(load()?.domain ?: throw StorageConflict("NOT_INITIALIZED"), at)
    fun receipt(generation: Long, requestId: String, intentSha: String): CommitReceipt? = db.transaction { sql ->
        val meta = meta(sql) ?: return@transaction null
        val row = sql.query("SELECT intent_sha,committed_revision,committed_generation,rollback_id FROM command_receipts WHERE base_generation=? AND request_id=?", listOf(generation, requestId)).singleOrNull() ?: return@transaction null
        if (row[0] != intentSha) throw StorageConflict("REQUEST_ID_REUSED")
        if ((row[2] as Number).toLong() != meta.token.replacementGeneration) throw StorageConflict("STALE_GENERATION")
        read(sql) ?: throw StorageCorruption("Missing initialized state")
        CommitReceipt(StateToken((row[1] as Number).toLong(), (row[2] as Number).toLong()), true, row[3] as String?)
    }
    fun replacementReceipt(requestId: String, intentSha: String): CommitReceipt? {
        val generation = db.transaction { sql ->
            val rows=sql.query("SELECT base_generation FROM command_receipts WHERE request_id=? AND kind='replace'",listOf(requestId))
            if(rows.size>1)throw StorageConflict("REQUEST_ID_REUSED")
            rows.singleOrNull()?.get(0)?.let{(it as Number).toLong()}
        } ?: return null
        return receipt(generation,requestId,intentSha)
    }
    fun captureDaily(expected: StateToken, at: String, maximumBytes: Long = SnapshotStore.DAILY_BYTES, targetDate: String? = null): DailyCapture {
        require(maximumBytes in 1..SnapshotStore.DAILY_BYTES)
        val state = load() ?: throw StorageConflict("NOT_INITIALIZED")
        if (state.token != expected) throw StorageConflict("REVISION_CONFLICT")
        val today = com.blockcolc.domain.DomainTime.localDate(at, state.domain.focusControlJson().getJSONObject("calendar").getString("timeZone"))
        val date = targetDate?.let { com.blockcolc.domain.DomainTime.date(it).also { value -> require(value <= today) } } ?: today
        // A completed backup for this date needs no new blueprint expansion.
        // Still inspect and validate the actual recovery rows before returning.
        val existing=db.transaction{sql->
            if(meta(sql)?.token!=expected)throw StorageConflict("REVISION_CONFLICT")
            val roots=checkedBackupRoots(sql).filter{it.kind=="daily"}
            if(roots.size>1)throw StorageCorruption("Multiple daily roots")
            roots.singleOrNull()?.takeIf{it.date!!>=date}
        }
        if(existing!=null)return DailyCapture(existing,false)
        val prepared = SnapshotStore.prepare(state.domain)
        return db.transaction { sql ->
            if (meta(sql)?.token != expected) throw StorageConflict("REVISION_CONFLICT")
            // Matching daily content still checks every persisted block/link.
            // Rebuilding its large JSON tree beside the prepared replacement
            // can exceed a normal Android heap even for a 16 MiB archive.
            val roots = checkedBackupRoots(sql).filter{it.kind=="daily"}
            if (roots.size > 1) throw StorageCorruption("Multiple daily roots")
            val previous = roots.singleOrNull()
            if (previous != null && previous.date!! >= date) return@transaction DailyCapture(previous, false)
            val bytes = prepared.bytes + SnapshotStore.metadataBytes("daily:$date", "daily", at, date, expected.revision, "daily-merged", null, prepared.domainSha, prepared.manifestSha)
            if (bytes > maximumBytes) return@transaction DailyCapture(previous, false, true)
            val next = SnapshotStore.save(sql, "daily:$date", "daily", at, date, expected.revision, "daily-merged", null, prepared)
            checkpoint("after-daily-root")
            roots.forEach { sql.execute("DELETE FROM backup_roots WHERE id=?", listOf(it.id)) }
            SnapshotStore.collect(sql)
            DailyCapture(next, true)
        }
    }
    private fun write(expected: StateToken, requestId: String, domain: DomainDocument, recovery: RecoveryContext, replacement: Boolean, intentSha: String?, rollback: RollbackRequest?,extra:(SqlSession)->Unit={}): CommitReceipt {
        require(expected.revision >= 0 && expected.replacementGeneration >= 0)
        require(requestId.isNotBlank() && requestId.length <= 128)
        recovery.validate(domain, expected.replacementGeneration)
        val local = recovery.canonical(); val kind = if (replacement) "replace" else "commit"
        if (intentSha != null) require(Regex("[a-f0-9]{64}").matches(intentSha))
        val digest = StrictJson.sha("$kind\n${domain.sha256}\n$local\n${rollback?.reason.orEmpty()}\n${rollback?.source.orEmpty()}")
        val before = load() ?: throw StorageConflict("NOT_INITIALIZED")
        val focusUpdate=if(!replacement&&rollback==null)domain.activeFocusWireFrom(before.domain)else null
        val preparedLayout=if(domain==before.domain||focusUpdate!=null)null else RecordLayout.split(domain)
        var committedLayout:RecordLayout?=null
        var committedAssetDigest:String?=null
        var committedAssetRanges:AssetRanges?=null
        var committedFocusBase:FocusBase?=null
        var committedFocusStamp:SqlReadStamp?=null
        if (rollback?.reason == "before-delete") {
            val old = before.domain.json(); val next = domain.json(); val id = rollback.source
            fun project(s: org.json.JSONObject) = s.getJSONArray("projects").let { a -> (0 until a.length()).map { a.getJSONObject(it) }.find { it.getString("id") == id } }
            require(!replacement && old.opt("activeProjectId") == id && old.isNull("activeFocusSession") && project(old)?.getString("status") == "active"
                && next.isNull("activeProjectId") && next.isNull("activeFocusSession") && project(next)?.getString("status") == "deleted") { "Delete rollback target does not match the confirmed deletion" }
        }
        val prepared = if (rollback != null) SnapshotStore.prepare(before.domain) else null
        val committed = db.transaction { sql ->
            val meta = meta(sql) ?: throw StorageConflict("NOT_INITIALIZED")
            val old = sql.query("SELECT request_sha,kind,committed_revision,committed_generation,rollback_id,intent_sha FROM command_receipts WHERE base_generation=? AND request_id=?", listOf(expected.replacementGeneration, requestId)).singleOrNull()
            if (old != null) {
                if (old[0] != digest || old[1] != kind || old[5] != intentSha) throw StorageConflict("REQUEST_ID_REUSED")
                val token = StateToken((old[2] as Number).toLong(), (old[3] as Number).toLong())
                if (token.replacementGeneration != meta.token.replacementGeneration) throw StorageConflict("STALE_GENERATION")
                return@transaction CommitReceipt(token, true, old[4] as String?)
            }
            if (meta.token.replacementGeneration != expected.replacementGeneration) throw StorageConflict("STALE_GENERATION")
            if (meta.token.revision != expected.revision) throw StorageConflict("REVISION_CONFLICT")
            if (before.token != expected) throw StorageConflict("REVISION_CONFLICT")
            // The optimized focus splice touches one domain value. Reuse
            // checked rows only when the actual pinned write connection
            // still has the same stamp, and the base domain and token match.
            val point=readCheckpoint?.takeIf{focusUpdate!=null&&domain.canonicalLength<=largeDocumentCharacters&&
                it.focusBase!=null&&it.token==meta.token&&validated?.domain===before.domain&&meta.sha==before.domain.sha256}
            val focusBase=point?.takeIf{PipelineCost.section("storage.prewrite-stamp"){sql.readStamp()==it.stamp}}?.focusBase
            val current=if(focusBase==null)PipelineCost.section("storage.prewrite-inputs"){readInputs(sql,meta)}else null
            if(current!=null){
                val actual=decode(current)
                if(actual.domain!=before.domain||actual.recovery!=before.recovery)throw StorageConflict("REVISION_CONFLICT")
            }
            val rollbackId = if (prepared != null && rollback != null) {
                val id = "rollback:${expected.replacementGeneration}:$requestId"
                SnapshotStore.save(sql, id, "rollback", rollback.createdAt, null, expected.revision, rollback.reason, rollback.source, prepared)
                checkpoint("after-rollback-root"); id
            } else null
            val revision = Math.addExact(expected.revision, 1); val generation = if (replacement) Math.addExact(expected.replacementGeneration, 1) else expected.replacementGeneration
            if(current!=null){
                val values=if(focusUpdate==null)current.values else current.values+("activeFocusSession" to focusUpdate)
                val layout=preparedLayout?:RecordLayout(values,current.records,current.assets)
                committedLayout=layout
                if(layout.assets===current.assets){
                    committedAssetDigest=current.assetDigest
                    committedAssetRanges=current.matchedAssetRanges
                }
                writeRecords(sql,layout,current)
            }else{
                checkpoint("after-assets")
                if(sql.execute("UPDATE domain_values SET canonical=? WHERE name='activeFocusSession'",listOf(checkNotNull(focusUpdate)))!=1)
                    throw StorageCorruption("Missing active focus row")
                checkpoint("after-records")
                committedFocusBase=checkNotNull(focusBase)
            }
            val localChanged=(current?.local?:checkNotNull(point).local)!=local
            if(localChanged)sql.execute("UPDATE local_recovery SET canonical=? WHERE id=1", listOf(local))
            checkpoint("before-meta")
            val changed = sql.execute("UPDATE state_meta SET revision=?,replacement_generation=?,domain_sha=? WHERE id=1 AND revision=? AND replacement_generation=?", listOf(revision, generation, domain.sha256, expected.revision, expected.replacementGeneration))
            if (changed != 1) throw StorageConflict("REVISION_CONFLICT")
            sql.execute("INSERT INTO command_receipts(base_generation,request_id,request_sha,kind,committed_revision,committed_generation,intent_sha,rollback_id) VALUES(?,?,?,?,?,?,?,?)", listOf(expected.replacementGeneration, requestId, digest, kind, revision, generation, intentSha, rollbackId))
            if (rollbackId != null) {
                // The new rollback root contains the before-state just read
                // and validated in this transaction. Still check every stored
                // block/link/size/digest; avoid rebuilding the same large tree
                // while both the before and replacement documents are live.
                SnapshotStore.prune(sql,ValidatedRecordContent(checkNotNull(current).contentDigest,before.domain))
            }
            checkpoint("before-commit")
            extra(sql)
            if(focusBase!=null)committedFocusStamp=PipelineCost.section("storage.focus-write-stamp"){
                focusWriteStamp(sql,checkNotNull(point).stamp,if(localChanged)4L else 3L)
            }
            CommitReceipt(StateToken(revision, generation), false, rollbackId)
        }
        if (!committed.replayed) {
            // The immutable document was validated before persistence. Only
            // publish its expected-row proof AFTER the real COMMIT returns.
            // The next read checks actual committed rows. A bounded focus
            // splice may reuse asset ranges only after its dedicated proof.
            val meta=Meta(committed.token,domain.sha256)
            val focusBase=committedFocusBase
            if(focusBase!=null){
                val values=focusBase.values+("activeFocusSession" to checkNotNull(focusUpdate))
                val digest=RecordLayout.contentDigest(values,focusBase.records,focusBase.assets.digest)
                readCheckpoint=null
                validated=Validated(null,fingerprint(meta,local,digest),ValidatedRecordContent(digest,domain),focusBase.assets)
                val controls=ControlRows(values,focusBase.records,local)
                focusReadback=committedFocusStamp?.takeIf{controls.characters<=cacheCharacters}?.let{FocusReadback(it,meta,controls,focusBase.assets)}
                offerCheckpoint(digest,domain)
            }else{
                val layout=checkNotNull(committedLayout)
                val records=layout.records.sortedWith(compareBy<StateRecord>{it.section}.thenBy{it.ordinal})
                remember(ReadProof(meta,layout.values,records,layout.assets,local,committedAssetRanges),domain,
                    committedAssetDigest?:RecordLayout.verifiedAssetKeysDigest(layout.assets.keys))
            }
        }
        return committed
    }
    /** A fixed three or four direct writes may carry the prior asset proof to
     * the next transaction. Any unusual schema or extra write requires a full
     * read. The post-COMMIT read will compare the connection stamp and controls. */
    private fun focusWriteStamp(sql:SqlSession,before:SqlReadStamp,expectedWrites:Long):SqlReadStamp? {
        if(before.tempSchemaVersion==null||before.changes<0)return null
        return try{
            val after=sql.readStamp()?:return null
            if(after.changes<before.changes||after.changes-before.changes!=expectedWrites||after.copy(changes=before.changes)!=before)return null
            val ordinary=sql.query("""
                SELECT (SELECT COUNT(*) FROM main.sqlite_master WHERE type='table' AND rootpage>0
                    AND name IN ('state_meta','domain_values','domain_records','blueprint_assets','local_recovery','command_receipts'))=6
                    AND NOT EXISTS(SELECT 1 FROM main.sqlite_master WHERE type='trigger')
                    AND NOT EXISTS(SELECT 1 FROM temp.sqlite_master WHERE type!='table' OR name!='blockcolc_read_connection')
            """.trimIndent()).single().single() as Number
            after.takeIf{ordinary.toInt()==1}
        }catch(_:Exception){null}
    }
    private data class Meta(val token: StateToken, val sha: String)
    private fun meta(sql: SqlSession): Meta? {
        val rows = sql.query("SELECT layout_version,revision,replacement_generation,domain_sha FROM state_meta WHERE id=1")
        if (rows.isEmpty()) return null
        val r = rows.single(); if ((r[0] as Number).toLong() != StateSchema.VERSION.toLong()) throw StorageCorruption("Unsupported database layout")
        return Meta(StateToken((r[1] as Number).toLong(), (r[2] as Number).toLong()), r[3] as String)
    }
    private fun read(sql: SqlSession): StoredState? {
        try {
            val pending=focusReadback
            focusReadback=null
            val stamp=sql.readStamp()
            val cached=validated;val point=readCheckpoint
            if(stamp!=null&&cached!=null&&point?.stamp==stamp)
                return StoredState(point.token,cached.domain,RecoveryContext.parse(point.local,cached.domain))
            val meta = meta(sql)
            if (meta == null) {
                val tables = listOf("domain_values", "domain_records", "blueprint_assets", "local_recovery", "command_receipts", "backup_roots", "backup_blocks", "backup_links")
                if (tables.any { (sql.query("SELECT COUNT(*) FROM $it").single()[0] as Number).toLong() != 0L }) throw StorageCorruption("Orphan records without state metadata")
                return null
            }
            val checked=pending?.takeIf{it.stamp==stamp&&it.meta==meta&&cached?.assetRanges===it.assets&&cached?.domain?.sha256==meta.sha}
            val controls=checked?.let{PipelineCost.section("storage.focus-readback-controls"){readControls(sql)}}
            if(checked!=null&&controls!=null&&controls==checked.controls&&cached!=null){
                val recovery=RecoveryContext.parse(controls.local,cached.domain)
                readCheckpoint=ReadCheckpoint(checked.stamp,meta.token,controls.local,FocusBase(controls.values,controls.records,checked.assets))
                return StoredState(meta.token,cached.domain,recovery)
            }
            val proof=PipelineCost.section("storage.read-inputs"){readInputs(sql,meta,controls?:readControls(sql))}
            return decode(proof).also{state->
                if(stamp!=null&&validated!=null){
                    val focusBase=validated?.assetRanges?.takeIf{proof.controlCharacters<=cacheCharacters}?.let{
                        FocusBase(proof.values,proof.records,it)
                    }
                    readCheckpoint=ReadCheckpoint(stamp,state.token,proof.local,focusBase)
                }
            }
        } catch (e: StorageCorruption) { throw e }
        catch (e: Exception) { throw StorageCorruption("Stored state is invalid; retain database for recovery", e) }
    }
    private fun readControls(sql:SqlSession):ControlRows {
        val values = sql.query("SELECT name,canonical FROM domain_values").associate { it[0] as String to it[1] as String }
        val records = sql.query("SELECT section,record_key,ordinal,canonical FROM domain_records ORDER BY section,ordinal").map {
            val ordinal = (it[2] as Number).toLong(); if (ordinal !in 0..Int.MAX_VALUE.toLong()) throw StorageCorruption("Invalid ordinal")
            StateRecord(it[0] as String, it[1] as String, ordinal.toInt(), it[3] as String)
        }
        val local = sql.query("SELECT canonical FROM local_recovery WHERE id=1").singleOrNull()?.get(0) as? String ?: throw StorageCorruption("Missing local recovery record")
        return ControlRows(values,records,local)
    }
    private fun readInputs(sql:SqlSession,meta:Meta,controls:ControlRows=readControls(sql)):ReadProof {
        // Seek each immutable body by its primary key. An OFFSET over the
        // ordered body subquery materializes preceding large cells repeatedly.
        // Every body is still read and validated inside this transaction.
        val keys=sql.query("SELECT sha FROM blueprint_assets ORDER BY sha").map{it.single() as String}
        val prior=validated
        if(prior==null&&controls.values["schemaVersion"]=="15"&&keys.size in 8..256&&Runtime.getRuntime().availableProcessors()>=3){
            val assetDigest=RecordLayout.verifiedAssetKeysDigest(keys.toSet())
            val contentDigest=RecordLayout.contentDigest(controls.values,controls.records,assetDigest)
            val miss=try{readCache?.indexesAbsent(contentDigest,meta.sha,assetDigest)?:true}catch(_:Exception){false}
            val read=ColdAssetRead.load(sql,keys,controls.values,controls.records,miss)
            return ReadProof(meta,controls.values,controls.records,read.assets,controls.local,
                checkedAssetDigest=assetDigest,checkedContentDigest=contentDigest,completedScans=read.scans,rawCandidate=read.rawCandidate)
        }
        val assets=keys.associateWith(sql::blueprintBody)
        val matched=prior?.assetRanges?.takeIf{ranges->
            PipelineCost.section("storage.asset-compare"){ranges.matches(prior.domain,assets)}
        }
        return ReadProof(meta,controls.values,controls.records,assets,controls.local,matched)
    }
    private fun decode(proof:ReadProof):StoredState {
        try {
            val (meta,values,records,assets,local)=proof
            validated?.takeIf{if(it.rows!=null)it.rows==proof else it.digest==fingerprint(meta,local,proof.contentDigest)}?.let{cached->
                // Recovery contains lists: return a fresh projection, never a
                // mutable alias into the previously returned caller's object.
                return StoredState(meta.token,cached.domain,RecoveryContext.parse(local,cached.domain))
            }
            // Both the optional checkpoint and the full reconstruction use
            // the same verified inputs. A bad asset cannot become a cache miss.
            val contentDigest=proof.contentDigest
            val cached=try{PipelineCost.section("storage.checkpoint-read"){
                readCache?.read(contentDigest,meta.sha){RecordLayout.checkpointParts(values,records,assets)}?.takeIf{it.sha256==meta.sha}
            }}catch(_:Exception){null}
            val domain = cached?:PipelineCost.section("storage.decode-domain"){
                val blueprintProofs=if(proof.assetCharacters>cacheCharacters){
                    val signed=try{
                        PipelineCost.section("storage.blueprint-checkpoint-read"){readCache?.readBlueprints(proof.assetDigest)}
                    }catch(_:Exception){null}
                    signed?:proof.completedScans
                }else null
                RecordLayout.join(values,records,blueprintProofs,proof.rawCandidate){sha->assets[sha]?:throw StorageCorruption("Missing blueprint asset")}
            }
            if (domain.sha256 != meta.sha) throw StorageCorruption("Domain digest mismatch")
            val context = RecoveryContext.parse(local,domain); context.validate(domain, meta.token.replacementGeneration)
            remember(proof,domain)
            return StoredState(meta.token, domain, context)
        } catch (e: StorageCorruption) { throw e }
        catch (e: Exception) { throw StorageCorruption("Stored state is invalid; retain database for recovery", e) }
    }
    private fun remember(proof:ReadProof,domain:DomainDocument,assetDigest:String?=null) {
        // General writes still require a complete read of actual rows.
        readCheckpoint=null
        focusReadback=null
        val size=proof.controlCharacters+proof.assetCharacters+proof.assets.keys.sumOf{it.length.toLong()}
        val contentDigest=assetDigest?.let{RecordLayout.contentDigest(proof.values,proof.records,it)}?:proof.contentDigest
        val content=ValidatedRecordContent(contentDigest,domain)
        validated=when{
            size<=cacheCharacters&&domain.canonicalLength<=cacheCharacters->Validated(proof.copy(
                checkedAssetDigest=null,checkedContentDigest=null,completedScans=null,rawCandidate=null),null,content)
            domain.canonicalLength<=largeDocumentCharacters->Validated(null,fingerprint(proof.meta,proof.local,contentDigest),content,
                assetRanges(proof,domain,assetDigest?:proof.assetDigest))
            else->null
        }
        offerCheckpoint(contentDigest,domain)
    }
    private fun offerCheckpoint(contentDigest:String,domain:DomainDocument){
        val blueprints=validated?.assetRanges?.let{BlueprintCheckpointSource(it.digest,it.owners)}
        try{readCache?.offer(contentDigest,domain,blueprints)}catch(_:Exception){/* Optional cache cannot fail a saved/read state. */}
    }
    private fun assetRanges(proof:ReadProof,domain:DomainDocument,digest:String):AssetRanges? {
        if(proof.assetCharacters<=cacheCharacters)return null
        val prior=validated
        val matched=proof.matchedAssetRanges
        // A proven focus splice preserves all previously compared bodies and
        // owner identities. Other documents establish their own exact ranges.
        if(matched!=null&&prior!=null&&(domain===prior.domain||domain.activeFocusWireFrom(prior.domain)!=null))return matched
        val ranges=AssetRanges(RecordLayout.assetOwners(proof.records),digest)
        return ranges.takeIf{it.matches(domain,proof.assets)}
    }
    private fun fingerprint(meta:Meta,local:String,contentDigest:String):String {
        val digest=ExactReadDigest()
        fun text(value:String)=digest.text(value)
        text(meta.token.revision.toString());text(meta.token.replacementGeneration.toString());text(meta.sha)
        text(contentDigest);text(local)
        return digest.finish()
    }
    private fun writeRecords(sql: SqlSession, layout: RecordLayout, previous:ReadProof?=null) {
        for ((sha, body) in layout.assets) {
            val old=previous?.assets?.get(sha)
            if(old!=null){if(old!=body)throw StorageCorruption("Conflicting immutable blueprint")}
            else {
                sql.execute("INSERT INTO blueprint_assets(sha,canonical) VALUES(?,?)", listOf(sha, body))
                if (sql.blueprintBody(sha) != body) throw StorageCorruption("Conflicting immutable blueprint")
            }
        }
        checkpoint("after-assets")
        for ((name, body) in layout.values) {
            val old=previous?.values?.get(name)
            if(old==null)sql.execute("INSERT INTO domain_values(name,canonical) VALUES(?,?)", listOf(name, body))
            else if(old!=body)sql.execute("UPDATE domain_values SET canonical=? WHERE name=?", listOf(body, name))
        }
        val keys = layout.records.map { it.section to it.key }.toSet()
        val oldRecords=previous?.records.orEmpty().associateBy{it.section to it.key}
        for ((key,_) in oldRecords) if(key !in keys)sql.execute("DELETE FROM domain_records WHERE section=? AND record_key=?",listOf(key.first,key.second))
        for (r in layout.records) {
            val old=oldRecords[r.section to r.key]
            if(old==null)sql.execute("INSERT INTO domain_records(section,record_key,ordinal,canonical) VALUES(?,?,?,?)", listOf(r.section, r.key, r.ordinal, r.canonical))
            else if(old!=r)sql.execute("UPDATE domain_records SET ordinal=?,canonical=? WHERE section=? AND record_key=?", listOf(r.ordinal, r.canonical, r.section, r.key))
        }
        checkpoint("after-records")
        // Recovery roots own their immutable blocks; live assets can now be collected independently.
        for(sha in previous?.assets.orEmpty().keys)if(sha !in layout.assets)sql.execute("DELETE FROM blueprint_assets WHERE sha=?",listOf(sha))
    }
}
