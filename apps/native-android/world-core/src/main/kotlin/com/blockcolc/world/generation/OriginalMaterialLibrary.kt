package com.blockcolc.world.generation

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.Collections

enum class OriginalPattern(val wireValue:String) {
    SMOOTH("smooth"),STONE("stone"),COBBLE("cobble"),BRICK("brick"),PLANKS("planks"),BARK("bark"),SHINGLES("shingles"),FABRIC("fabric"),
    CERAMIC("ceramic"),SAND("sand"),SOIL("soil"),GRASS("grass"),FOLIAGE("foliage"),GLASS("glass"),CLEAR_GLASS("clear-glass"),METAL("metal"),
    ORE("ore"),SCULK("sculk"),MUSHROOM("mushroom"),STRAW("straw"),WATER("water"),LAVA("lava"),PATH("path"),EMISSIVE("emissive")
}
enum class OriginalResponse(val wireValue:String,val code:Int) { DEFAULT("default",0),STONE("stone",1),WOOD("wood",2),METAL("metal",3),GLASS("glass",4) }
data class MaterialResponse(val roughness:Double,val metalness:Double)
data class OriginalColor(val name:String,val color:Int)
data class OriginalTextureDescriptor(val pattern:OriginalPattern,val sha256:String,val width:Int,val height:Int,val colorSpace:String,
    val wrapS:Int,val wrapT:Int,val minFilter:Int,val magFilter:Int,val anisotropy:Double,val generateMipmaps:Boolean,val flipY:Boolean)
class OriginalTexture internal constructor(val descriptor:OriginalTextureDescriptor,private val rgba:ByteArray) {
    fun pixels():ByteBuffer=ByteBuffer.wrap(rgba).asReadOnlyBuffer()
}

/** Static original artwork is exported once as tiny RGBA assets. Kotlin
 * decides colours/patterns/components at runtime; it does not embed a baked
 * world, a state-to-model enumeration, Three.js or a browser execution path. */
class OriginalMaterialLibrary private constructor(tables:Map<String,List<OriginalColor>>,responses:Map<OriginalResponse,MaterialResponse>,textures:Map<OriginalPattern,OriginalTextureDescriptor>,
    val contentSha:String,private val source:(String)->InputStream) {
    private val tables:Map<String,List<OriginalColor>> = Collections.unmodifiableMap(tables.mapValues{Collections.unmodifiableList(it.value.toList())})
    private val responses:Map<OriginalResponse,MaterialResponse> = Collections.unmodifiableMap(LinkedHashMap(responses))
    private val textures:Map<OriginalPattern,OriginalTextureDescriptor> = Collections.unmodifiableMap(LinkedHashMap(textures))
    fun colors(table:String):List<OriginalColor> = tables.getValue(table)
    fun response(kind:OriginalResponse)=responses.getValue(kind)
    fun descriptor(pattern:OriginalPattern)=textures.getValue(pattern)
    fun texture(pattern:OriginalPattern):OriginalTexture {
        val d=descriptor(pattern);val bytes=source("native-original-materials/${d.sha256}.rgba").use{limited(it,d.width*d.height*4)}
        require(bytes.size==d.width*d.height*4&&sha(bytes)==d.sha256){"Original material texture content differs"}
        return OriginalTexture(d,bytes)
    }
    companion object {
        val bundled:OriginalMaterialLibrary by lazy {
            val loader=OriginalMaterialLibrary::class.java
            fun open(path:String)=loader.getResourceAsStream("/$path")?:error("Bundled original material missing")
            read(open("native-original-materials/materials.json").use{limited(it,256*1024)},::open)
        }
        private fun limited(input:InputStream,maximum:Int):ByteArray {
            val out=ByteArrayOutputStream();val buffer=ByteArray(8192)
            while(true){val n=input.read(buffer);if(n<0)break;require(out.size()+n<=maximum){"Original material asset budget"};out.write(buffer,0,n)}
            return out.toByteArray()
        }
        private fun sha(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}
        fun read(metadata:ByteArray,source:(String)->InputStream):OriginalMaterialLibrary {
            require(metadata.size in 1..256*1024);val root=JSONObject(metadata.toString(Charsets.UTF_8))
            fun number(o:JSONObject,key:String):Double {val n=(o.get(key) as? Number)?.toDouble()?:throw IllegalArgumentException("Expected material number");require(n.isFinite());return n}
            fun integer(o:JSONObject,key:String):Long {val n=number(o,key);require(n in 0.0..Int.MAX_VALUE.toDouble()&&n==kotlin.math.floor(n));return n.toLong()}
            fun bool(o:JSONObject,key:String):Boolean=o.get(key) as? Boolean?:throw IllegalArgumentException("Expected material flag")
            require(integer(root,"schema")==1L)
            val rawTables=root.getJSONObject("tables");val tables=LinkedHashMap<String,List<OriginalColor>>()
            for(name in listOf("BASE_COLORS","DYE_COLORS","WOOD_COLORS","TERRACOTTA_COLORS","CORAL_COLORS")) {
                val raw=rawTables.getJSONArray(name);require(raw.length() in 1..128);val seen=HashSet<String>()
                tables[name]=List(raw.length()){i->val entry=raw.getJSONObject(i);val id=entry.getString("name");require(id.matches(Regex("[a-z_]+"))&&seen.add(id))
                    val color=integer(entry,"color");require(color in 0..0xffffff);OriginalColor(id,color.toInt())}
            }
            val responses=LinkedHashMap<OriginalResponse,MaterialResponse>();val rawResponses=root.getJSONArray("responses")
            require(rawResponses.length()==OriginalResponse.entries.size)
            for(i in 0 until rawResponses.length()) {
                val r=rawResponses.getJSONObject(i);val kind=OriginalResponse.entries.firstOrNull{it.wireValue==r.getString("kind")}?:error("Unknown material response")
                val rough=number(r,"roughness");val metal=number(r,"metalness");require(rough in 0.0..1.0&&metal in 0.0..1.0&&!responses.containsKey(kind))
                responses[kind]=MaterialResponse(rough,metal)
            }
            val textures=LinkedHashMap<OriginalPattern,OriginalTextureDescriptor>();val rawTextures=root.getJSONArray("entries");require(rawTextures.length()==OriginalPattern.entries.size)
            for(i in 0 until rawTextures.length()) {
                val r=rawTextures.getJSONObject(i);val p=OriginalPattern.entries.firstOrNull{it.wireValue==r.getString("pattern")}?:error("Unknown original texture")
                val hash=r.getString("sha256");require(hash.matches(Regex("[a-f0-9]{64}"))&&!textures.containsKey(p))
                val width=integer(r,"width").toInt();val height=integer(r,"height").toInt();require(width==16&&height==16)
                require(r.getString("colorSpace")=="srgb"&&integer(r,"wrapS")==1000L&&integer(r,"wrapT")==1000L&&integer(r,"minFilter")==1008L&&integer(r,"magFilter")==1003L)
                val anisotropy=number(r,"anisotropy");require(anisotropy==4.0&&bool(r,"generateMipmaps")&&!bool(r,"flipY"))
                textures[p]=OriginalTextureDescriptor(p,hash,width,height,"srgb",1000,1000,1008,1003,anisotropy,true,false)
            }
            return OriginalMaterialLibrary(tables,responses,textures,sha(metadata),source)
        }
    }
}
