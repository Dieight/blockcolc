package com.blockcolc.world.generation

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.Collections

enum class OriginalShapeFamily(val wireValue:String) {
    CARPET("carpet"),PALE_MOSS("pale-moss-carpet"),LEVER("lever"),LANTERN("lantern"),CANDLE("candle"),BED("bed"),
    SIGN("sign"),WALL_SIGN("wall-sign"),HANGING_SIGN("hanging-sign"),WALL_HANGING_SIGN("wall-hanging-sign"),
    STAIRS("stairs"),SLAB("slab"),FENCE("fence"),WALL("wall"),PANE("pane"),IRON_BARS("iron-bars"),DOOR("door"),
    TRAPDOOR("trapdoor"),LADDER("ladder"),FENCE_GATE("fence-gate"),BUTTON("button"),PRESSURE_PLATE("pressure-plate"),WEIGHTED_PLATE("weighted-pressure-plate")
}

/** Exact source registry data only: no enumerated state-to-model table and no
 * JS runtime. The native shape algorithms remain responsible for every state. */
class OriginalShapeRegistry private constructor(index:Map<String,OriginalShapeFamily>,val contentSha:String,val sourceSha:String) {
    private val index:Map<String,OriginalShapeFamily> = Collections.unmodifiableMap(LinkedHashMap(index))
    val blockIds:Set<String> = Collections.unmodifiableSet(LinkedHashSet(index.keys))
    fun family(path:String)=index[path]
    companion object {
        val bundled:OriginalShapeRegistry by lazy {
            OriginalShapeRegistry::class.java.getResourceAsStream("/original-shape-registry.json")?.use(::read)
                ?:error("Bundled original-shape registry is missing")
        }
        fun read(input:InputStream):OriginalShapeRegistry {
            val out=ByteArrayOutputStream();val buffer=ByteArray(8192)
            while(true){val n=input.read(buffer);if(n<0)break;require(out.size()+n<=256*1024){"Shape registry budget"};out.write(buffer,0,n)}
            val bytes=out.toByteArray();val root=JSONObject(bytes.toString(Charsets.UTF_8));require(root.getInt("schema")==1)
            val source=root.getString("sourceSha");require(source.matches(Regex("[a-f0-9]{64}")))
            val families=root.getJSONArray("families");require(families.length()==OriginalShapeFamily.entries.size)
            val index=LinkedHashMap<String,OriginalShapeFamily>();val seen=HashSet<OriginalShapeFamily>()
            for(i in 0 until families.length()) {
                val row=families.getJSONObject(i);val family=OriginalShapeFamily.entries.firstOrNull{it.wireValue==row.getString("id")}?:error("Unknown original-shape family")
                require(seen.add(family));val ids=row.getJSONArray("blocks");require(ids.length() in 1..1024)
                for(j in 0 until ids.length()) {
                    val id=ids.getString(j);require(id.length in 1..128&&id.matches(Regex("[a-z0-9_]+")))
                    // The formal registry gives first-family membership priority.
                    if(!index.containsKey(id))index[id]=family
                    require(index.size<=16384)
                }
            }
            val sha=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}
            return OriginalShapeRegistry(index,sha,source)
        }
    }
}
