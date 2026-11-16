package com.blockcolc.world.generation

import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.Collections

data class BlueprintBox(val minX:Long,val maxX:Long,val minY:Long,val maxY:Long,val minZ:Long,val maxZ:Long){
    init{require(minX<=maxX&&minY<=maxY&&minZ<=maxZ&&listOf(minX,maxX,minY,maxY,minZ,maxZ).all{it in -9_007_199_254_740_991L..9_007_199_254_740_991L})}
    val footprint get()=FootprintBounds(minX,maxX,minZ,maxZ)
}
data class BuiltinBlueprintEntry(val id:String,val category:String,val displayName:String,val description:String,val complexity:String,
    val holidayId:String?,val sha256:String,val bytes:Int,val bounds:BlueprintBox,val voxelCount:Int)

/** Immutable source blueprint, not a derived geometry cache. The catalog reads
 * metadata first; voxel payloads are read/verified only when a worker needs one.
 * It never resolves user imports or reads an external Litematic directory. */
class BlueprintContent internal constructor(val entry:BuiltinBlueprintEntry,private val canonical:String,validated:JSONObject){
    private val first=java.util.concurrent.atomic.AtomicReference<JSONObject?>(validated)
    // The verified tree has no external owner. Transfer it once instead of
    // immediately decoding the same payload again; subsequent calls still
    // return independent mutable copies of the unchanged source text.
    fun json()=first.getAndSet(null)?:JSONObject(canonical)
}
class BuiltinBlueprintCatalog private constructor(entries:List<BuiltinBlueprintEntry>,hashes:Map<String,String>,private val reader:(String)->ByteArray){
    val entries:List<BuiltinBlueprintEntry> = Collections.unmodifiableList(entries.toList())
    val sourceHashes:Map<String,String> = Collections.unmodifiableMap(hashes.toMap())
    private val byId=entries.associateBy{it.id}
    fun find(id:String)=byId[id]
    fun content(id:String):BlueprintContent{
        val entry=byId[id]?:throw IllegalArgumentException("Unknown bundled blueprint")
        val text=utf8(verifiedBytes(entry));val value=JSONObject(text)
        require(integer(value,"schemaVersion")==1L&&value.getString("id")==entry.id&&box(value.getJSONObject("bounds"))==entry.bounds&&value.getJSONArray("voxels").length()==entry.voxelCount){"Bundled blueprint metadata mismatch"}
        return BlueprintContent(entry,text,value)
    }
    /** Disk render reuse still checks the actual packaged asset identity. */
    fun verifyContent(id:String) {
        verifiedBytes(byId[id]?:throw IllegalArgumentException("Unknown bundled blueprint"))
    }
    private fun verifiedBytes(entry:BuiltinBlueprintEntry):ByteArray {
        val bytes=reader("native-blueprints/${entry.sha256}.json").copyOf()
        require(bytes.size==entry.bytes&&digest(bytes)==entry.sha256){"Bundled blueprint content identity mismatch"}
        return bytes
    }
    /** Project fallback follows the formal building catalog; an arbitrary
     * project ID must not accidentally resolve to a locked holiday reward.
     * Reward callers select their already-authorized entry explicitly. */
    fun resolve(id:String)=content(if(byId[id]?.category in setOf("native","supplemental"))id else "builtin-unknown-placeholder")
    companion object {
        private val hash=Regex("[a-f0-9]{64}")
        private val categories=setOf("native","supplemental","daily","holiday","birthday","placeholder")
        fun load(reader:(String)->ByteArray={name->BuiltinBlueprintCatalog::class.java.classLoader!!.getResourceAsStream(name)?.use{it.readBytes()}?:error("Missing bundled blueprint resource")}):BuiltinBlueprintCatalog{
            val bytes=reader("native-blueprints/catalog.json").copyOf();require(bytes.size in 1..1024*1024){"Bundled catalog budget"}
            val value=JSONObject(utf8(bytes));require(integer(value,"schema")==1L)
            val raw=value.getJSONArray("entries");require(raw.length() in 4..256)
            val entries=List(raw.length()){i->val item=raw.getJSONObject(i)
                val category=item.getString("category");val digest=item.getString("sha256");val id=item.getString("id")
                require(category in categories&&hash.matches(digest)&&Regex("builtin-[a-z0-9-]+").matches(id))
                val count=integer(item,"voxelCount");val size=integer(item,"bytes")
                require(count in 1..300000&&size in 1..64L*1024*1024)
                BuiltinBlueprintEntry(id,category,item.getString("displayName"),item.getString("description"),item.getString("complexity").also{require(it in setOf("simple","moderate","detailed"))},
                    if(item.isNull("holidayId"))null else item.getString("holidayId"),digest,size.toInt(),box(item.getJSONObject("bounds")),count.toInt())
            }
            require(entries.map{it.id}.distinct().size==entries.size&&entries.count{it.category=="placeholder"&&it.id=="builtin-unknown-placeholder"}==1)
            val rawHashes=value.getJSONObject("sourceHashes");val hashes=rawHashes.keys().asSequence().associateWith{key->
                require(!key.startsWith('/')&&!key.contains("..")&&!key.contains('\\'))
                rawHashes.getString(key).also{require(hash.matches(it))}
            }
            return BuiltinBlueprintCatalog(entries,hashes,reader)
        }
        private fun integer(value:JSONObject,key:String):Long{
            val number=value.get(key) as? Number?:throw IllegalArgumentException("Expected catalog integer")
            val n=number.toDouble();require(n.isFinite()&&n>=-9_007_199_254_740_991.0&&n<=9_007_199_254_740_991.0&&n==n.toLong().toDouble());return n.toLong()
        }
        private fun box(value:JSONObject)=BlueprintBox(integer(value,"minX"),integer(value,"maxX"),integer(value,"minY"),integer(value,"maxY"),integer(value,"minZ"),integer(value,"maxZ"))
        private fun utf8(bytes:ByteArray)=Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
        private fun digest(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}
    }
}
