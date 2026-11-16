package com.blockcolc.storage

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.BlueprintReadProofs
import com.blockcolc.domain.CanonicalReadCandidate
import com.blockcolc.domain.DigestHex
import com.blockcolc.domain.PipelineCost
import com.blockcolc.domain.StrictJson
import org.json.JSONArray
import org.json.JSONObject
import java.nio.Buffer
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CoderResult
import java.security.MessageDigest

internal data class StateRecord(val section: String, val key: String, val ordinal: Int, val canonical: String)
internal data class ValidatedRecordContent(val digest:String,val domain:DomainDocument)
internal data class RecordLayout(val values: Map<String, String>, val records: List<StateRecord>, val assets: Map<String, String>) {
    companion object {
        val arrays = "projects habitBuildings retiredSubtaskIds focusHistory progressReports dailyGoals projectConditions decorationBlueprintResources decorationRewards holidayRewards buildingBlueprintResources quickNotes birthdayRewards".split(' ').toSet()
        val singletons = "schemaVersion activeProjectId activeFocusSession calendar decayPolicy focusIntegrityPolicy worldSettings birthday".split(' ').toSet()
        private val orderedSections=(arrays+singletons).sorted()
        private fun assetSlot(section: String): String? = when (section) {
            "projects", "habitBuildings" -> "importedBlueprint"
            "buildingBlueprintResources", "decorationBlueprintResources" -> "blueprint"
            else -> null
        }
        /** Verify actual text against each immutable address before using the
         * keys to bind the asset set. A declared key alone is never a proof. */
        fun verifyAssetDigest(assets:Map<String,String>):String = PipelineCost.section("storage.asset-digest") {
            if(assets.isNotEmpty()){
                val hasher=AssetTextHasher()
                for((sha,body) in assets)hasher.verify(sha,body)
            }
            verifiedAssetKeysDigest(assets.keys)
        }
        fun verifiedAssetKeysDigest(keys:Set<String>):String {
            val digest=ExactReadDigest()
            digest.text(keys.size.toString())
            for(key in keys.sorted())digest.text(key)
            return digest.finish()
        }
        /** Binds the actual metadata rows and the verified immutable assets.
         * An independent backup root does not own local plan or revision. */
        fun contentDigest(values:Map<String,String>,records:List<StateRecord>,assetDigest:String):String = PipelineCost.section("storage.content-digest") {
            val digest=ExactReadDigest()
            fun text(value:String)=digest.text(value)
            text("blockcolc-row-proof-v3")
            text(values.size.toString())
            for(key in values.keys.sorted()){text(key);text(values.getValue(key))}
            text(records.size.toString())
            for(row in records.sortedWith(compareBy<StateRecord>{it.section}.thenBy{it.ordinal}.thenBy{it.key})){
                text(row.section);text(row.key);text(row.ordinal.toString());text(row.canonical)
            }
            text(assetDigest);digest.finish()
        }
        fun referencedAssets(records:List<StateRecord>):Set<String> = assetOwners(records).keys
        fun assetOwners(records:List<StateRecord>):Map<String,Pair<String,String>> = buildMap {
            for(row in records){
                val slot=assetSlot(row.section)?:continue
                val value=StrictJson.parse(row.canonical,StrictJson.EXPANDED_LIMIT) as JSONObject
                if(!value.isNull(slot)){
                    val reference=value.getJSONObject(slot)
                    check(reference.keys().asSequence().toSet()==setOf("\$nativeAsset"))
                    val sha=reference.getString("\$nativeAsset")
                    if(sha !in this||row.section=="decorationBlueprintResources")put(sha,row.section to row.key)
                }
            }
        }
        private fun key(section: String, v: Any): String = if (v is JSONObject) when (section) {
            "dailyGoals", "decorationRewards" -> v.getString("date")
            "projectConditions" -> v.getString("projectId")
            "birthdayRewards" -> v.getLong("year").toString()
            "holidayRewards" -> v.getString("holidayId") + ":" + v.getLong("year")
            else -> v.getString("id")
        } else v as String
        fun split(domain: DomainDocument): RecordLayout = PipelineCost.section("storage.split") {
            val root = domain.projectionJson(); val assets = LinkedHashMap<String, String>(); val records = ArrayList<StateRecord>()
            for (section in arrays) {
                val entries = root.getJSONArray(section)
                for (i in 0 until entries.length()) {
                    val v = entries.get(i); val k = key(section, v); val slot = assetSlot(section)
                    if (slot != null && v is JSONObject && !v.isNull(slot)) {
                        // This is the exact, validated canonical body. Splitting
                        // rows must not expand every unchanged blueprint only
                        // to serialize it again and replace it with its digest.
                        val body = checkNotNull(domain.blueprintCanonical(section,k)){"Missing canonical blueprint body"}
                        val sha = StrictJson.sha(body); assets[sha] = body
                        v.put(slot, JSONObject().put("\$nativeAsset", sha))
                    }
                    records.add(StateRecord(section, k, i, StrictJson.render(v)))
                }
            }
            RecordLayout(singletons.associateWith { StrictJson.render(root.get(it)) }, records, assets)
        }

        /** Candidate canonical wire from the current SQL inputs. Use it only
         * after authentication, or after comparing to the fully validated wire.
         * Legacy spellings that differ from canonical JSON fall back to join. */
        fun checkpointParts(values:Map<String,String>,records:List<StateRecord>,assets:Map<String,String>):List<String> {
            require(values.keys==singletons)
            val grouped=records.groupBy{it.section}
            require(grouped.keys.all{it in arrays})
            val parts=ArrayList<String>()
            val text=StringBuilder()
            text.append('{')
            for((index,section) in orderedSections.withIndex()){
                if(index>0)text.append(',')
                text.append('"').append(section).append("\":")
                if(section in singletons){
                    val wire=values.getValue(section)
                    if(wire.length>=8192){parts.add(text.toString());text.setLength(0);parts.add(wire)}else text.append(wire)
                    continue
                }
                text.append('[')
                val prefix=assetSlot(section)?.let{"\"$it\":{\"\$nativeAsset\":\""}
                for((ordinal,row) in grouped[section].orEmpty().withIndex()){
                    require(row.ordinal==ordinal)
                    if(ordinal>0)text.append(',')
                    val start=if(prefix==null)-1 else row.canonical.indexOf(prefix)
                    if(start<0){text.append(row.canonical);continue}
                    val keyAt=start+checkNotNull(prefix).length
                    val keyEnd=keyAt+64
                    require(row.canonical.startsWith("\"}",keyEnd))
                    val body=assets.getValue(row.canonical.substring(keyAt,keyEnd))
                    val objectAt=keyAt-"{\"\$nativeAsset\":\"".length
                    text.append(row.canonical,0,objectAt)
                    parts.add(text.toString());text.setLength(0)
                    parts.add(body)
                    text.append(row.canonical,keyEnd+2,row.canonical.length)
                }
                text.append(']')
            }
            parts.add(text.append('}').toString())
            return parts
        }

        /** Every body returned by the lookup must already have been compared
         * with its content address in this transaction or backup read. */
        fun join(values: Map<String, String>, records: List<StateRecord>, blueprintProofs:BlueprintReadProofs?=null,
                 rawCandidate:CanonicalReadCandidate?=null,
                 verifiedAsset: (String) -> String): DomainDocument {
            if (values.keys != singletons) throw StorageCorruption("Missing/unknown domain singleton")
            val root = JSONObject(); values.forEach { (k, v) -> root.put(k, StrictJson.parse(v, StrictJson.EXPANDED_LIMIT)) }
            var characterHint=2L+values.entries.sumOf{(name,wire)->name.length+wire.length+4L}
            if (records.any { it.section !in arrays }) throw StorageCorruption("Unknown domain record section")
            val grouped = records.groupBy { it.section }; val bodies=HashMap<String,String>();val owners=HashMap<Pair<String,String>,String>()
            for (section in arrays) {
                // Include the field separator even when the array is empty.
                // Being a few characters short doubles a multi-MiB buffer.
                characterHint+=section.length+6L
                val entries = JSONArray(); val ordered = grouped[section].orEmpty().sortedBy { it.ordinal }
                for ((i, row) in ordered.withIndex()) {
                    if (row.ordinal != i) throw StorageCorruption("Invalid domain record order")
                    val v = StrictJson.parse(row.canonical, StrictJson.EXPANDED_LIMIT); val slot = assetSlot(section)
                    characterHint+=row.canonical.length+1L
                    if (slot != null && v is JSONObject && !v.isNull(slot)) {
                        val ref = v.getJSONObject(slot)
                        if (ref.keys().asSequence().toSet() != setOf("\$nativeAsset")) throw StorageCorruption("Invalid asset reference")
                        val sha = ref.getString("\$nativeAsset")
                        val body = bodies.getOrPut(sha){verifiedAsset(sha)}
                        if(owners.put(section to row.key,sha)!=null)throw StorageCorruption("Duplicate blueprint owner")
                        // The domain factory privately parses/validates these
                        // bodies and may reuse an unchanged canonical spelling.
                        v.put(slot,JSONObject.NULL)
                        characterHint+=body.length-StrictJson.render(ref).length
                    }
                    if (key(section, v) != row.key) throw StorageCorruption("Domain record identity mismatch")
                    entries.put(v)
                }
                root.put(section, entries)
            }
            return DomainDocument.fromBlueprintParts(root,owners,bodies,characterHint.coerceIn(16,16*1024*1024L).toInt(),blueprintProofs,rawCandidate)
        }
    }
}

/** Match the address's UTF-8 encoding without allowing a lossy replacement
 * character to make invalid SQL text look like an already verified body. */
internal class AssetTextHasher {
    private val digest=MessageDigest.getInstance("SHA-256")
    private val encoder=Charsets.UTF_8.newEncoder()
    private val chars=CharArray(4096)
    private val input=CharBuffer.wrap(chars)
    private val bytes=ByteArray(chars.size*3)
    private val output=ByteBuffer.wrap(bytes)

    fun verify(sha:String,body:String){
        if(hash(body)!=sha)throw StorageCorruption("Blueprint digest mismatch")
    }

    private fun hash(body:String):String {
        encoder.reset()
        (output as Buffer).clear()
        var start=0
        do {
            var end=minOf(start+chars.size,body.length)
            if(end<body.length&&body[end-1].isHighSurrogate())end--
            body.toCharArray(chars,0,start,end)
            (input as Buffer).clear()
            (input as Buffer).limit(end-start)
            val status=encoder.encode(input,output,end==body.length)
            checkEncoded(status)
            check(!input.hasRemaining()){"Incomplete asset text encoding"}
            drain()
            start=end
        }while(start<body.length)
        checkEncoded(encoder.flush(output))
        drain()
        return DigestHex.encode(digest.digest())
    }

    private fun checkEncoded(status:CoderResult){
        try{if(!status.isUnderflow)status.throwException()}
        catch(error:CharacterCodingException){throw StorageCorruption("Invalid blueprint text encoding",error)}
    }

    private fun drain(){
        digest.update(bytes,0,output.position())
        (output as Buffer).clear()
    }
}
