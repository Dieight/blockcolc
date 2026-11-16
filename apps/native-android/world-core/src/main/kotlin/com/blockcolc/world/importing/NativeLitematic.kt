package com.blockcolc.world.importing

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.FilterInputStream
import java.io.InputStream
import java.io.PushbackInputStream
import java.util.Collections
import java.util.PriorityQueue
import java.util.concurrent.CancellationException
import java.util.zip.GZIPInputStream
import kotlin.math.*

data class NativeLitematicLimits(val compressedBytes:Long=64L*1024*1024,val uncompressedBytes:Long=256L*1024*1024,
    val regions:Int=64,val horizontal:Int=96,val vertical:Int=256,val regionVolume:Long=16_777_216,
    val totalVolume:Long=16_777_216,val palette:Int=4096,val voxels:Int=300_000,val nbt:NativeNbtLimits=NativeNbtLimits()) {
    init {require(listOf(compressedBytes,uncompressedBytes,regionVolume,totalVolume).all{it>0});require(listOf(regions,horizontal,vertical,palette,voxels).all{it>0})}
}
class NativeLitematicError(val code:String,message:String,cause:Throwable?=null):IllegalArgumentException(message,cause)
data class NativeRegionPreview(val name:String,val position:List<Long>,val signedSize:List<Long>,val dimensions:List<Int>,val paletteEntries:Int,val volume:Long)
data class NativeLitematicPreview(val name:String,val author:String,val description:String,val version:Long,val subVersion:Long?,val minecraftDataVersion:Long,
    val dimensions:List<Int>,val regions:List<NativeRegionPreview>,val nonAirBlocks:Int,val compatibility:Map<String,Any>,val metadataTotalBlocks:Long?) {
    fun json():JSONObject {
        fun dimensions(v:List<Int>)=JSONObject().put("width",v[0]).put("height",v[1]).put("depth",v[2])
        fun point(v:List<Long>)=JSONObject().put("x",v[0]).put("y",v[1]).put("z",v[2])
        return JSONObject().put("name",name).put("author",author).put("description",description).put("litematicVersion",version).put("litematicSubVersion",subVersion?:JSONObject.NULL)
            .put("minecraftDataVersion",minecraftDataVersion).put("dimensions",dimensions(dimensions)).put("regionCount",regions.size).put("paletteEntries",regions.sumOf{it.paletteEntries})
            .put("nonAirBlockCount",nonAirBlocks).put("metadataTotalBlocks",metadataTotalBlocks?:JSONObject.NULL).put("compatibility",JSONObject(compatibility))
            .put("regions",JSONArray(regions.map{r->JSONObject().put("name",r.name).put("position",point(r.position)).put("signedSize",point(r.signedSize)).put("dimensions",dimensions(r.dimensions)).put("paletteEntries",r.paletteEntries).put("volume",r.volume)}))
    }
}
/** Only an immutable canonical value crosses from the parsing IO lane to the
 * business actor. The actor still validates and commits its own domain copy. */
class NativeLitematicResult internal constructor(val canonical:String,val preview:NativeLitematicPreview,val decorationEligible:Boolean,val id:String) {
    fun json()=JSONObject(canonical)
}

/** Behavioral port of packages/litematic/src/{index,nbt}.ts. User import is
 * gzip Litematic; schematic/Bedrock/structure NBT are not supported by that
 * product entry. Streaming inflate, NBT allocation, traversal and output each
 * have separate admission limits, and every long stage can be cancelled. */
object NativeLitematic {
    private val detailPattern=Regex("(?:door|trapdoor|sign|button|pressure_plate|ladder|rail|carpet|bed|torch|lantern|plant|leaves|vine|flower|banner|candle|chain|skull|head|bell|lever)$")
    private val fixedLights=mapOf("torch" to 14,"wall_torch" to 14,"soul_torch" to 10,"soul_wall_torch" to 10,"lantern" to 15,"soul_lantern" to 10,"glowstone" to 15,"sea_lantern" to 15,"shroomlight" to 15,
        "end_rod" to 14,"jack_o_lantern" to 15,"magma_block" to 3,"crying_obsidian" to 10,"glow_lichen" to 7,"fire" to 15,"soul_fire" to 10)
    internal data class State(val name:String,val properties:Map<String,String>)
    internal data class Voxel(val x:Long,val y:Long,val z:Long,val state:State,val material:String,val placeholder:Boolean,
        var moved:JSONObject?=null,var pose:JSONObject?=null,var sign:JSONObject?=null,var campfire:JSONObject?=null) {
        val rank:Int=if(material=="glass"||material=="accent"||detailPattern.containsMatchIn(state.name.substringAfter(':')))1 else 0
    }
    private data class Region(val preview:NativeRegionPreview,val minimum:List<Long>,val palette:List<State>,val packed:LongArray,
        val entities:Int,val tiles:List<Any>,val ticks:Int)
    internal fun invalid(message:String):Nothing=throw NativeLitematicError("INVALID_LITEMATIC",message)
    internal fun enforce(test:Boolean,message:String){if(!test)throw NativeLitematicError("LIMIT_EXCEEDED",message)}
    internal fun checkpoint(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Blueprint import cancelled")}
    @Suppress("UNCHECKED_CAST") internal fun record(value:Any?,path:String):Map<String,Any> = value as? Map<String,Any>?:invalid("$path must be a compound")
    internal fun integer(value:Any?,path:String):Long {
        val n=(value as? Number)?.toDouble()?:invalid("$path must be an integer")
        if(value is Long||!n.isFinite()||abs(n)>9_007_199_254_740_991.0||n!=floor(n))invalid("$path must be a safe numeric integer")
        return n.toLong()
    }
    internal fun safe(value:Long):Long {if(value !in -9_007_199_254_740_991L..9_007_199_254_740_991L)invalid("Coordinate overflow");return value}
    internal fun list(value:Any?,path:String):List<Any> = (value as? List<*>)?.map{it?:invalid("Null list value")}?:invalid("$path must be a list")
    internal fun properties(value:Any?):Map<String,String> {
        if(value==null)return emptyMap();val p=record(value,"Properties");if(p.size>32)invalid("Too many block state properties")
        return Collections.unmodifiableMap(p.toSortedMap().mapValues{(k,v)->
            if(k.length !in 1..64||!Regex("[a-z0-9_.-]+").matches(k)||k in setOf("__proto__","prototype","constructor"))invalid("Unsafe block state key")
            (v as? String)?.takeIf{it.length in 1..128}?:invalid("Invalid block state string")})
    }
    private fun position(value:Any?)=record(value,"Position").let{p->listOf("x","y","z").map{integer(p[it],it)}}
    internal fun air(name:String)=name in setOf("minecraft:air","minecraft:cave_air","minecraft:void_air")

    fun parse(input:InputStream,limits:NativeLitematicLimits=NativeLitematicLimits(),cancelled:()->Boolean={false}):NativeLitematicResult {
        val compressed=Meter(input,limits.compressedBytes,"INPUT_TOO_LARGE",cancelled)
        val peek=PushbackInputStream(BufferedInputStream(compressed,8192),2)
        val a=peek.read();val b=peek.read();if(a!=0x1f||b!=0x8b)throw NativeLitematicError("NOT_GZIP","Litematic input must be gzip-compressed NBT")
        peek.unread(byteArrayOf(a.toByte(),b.toByte()))
        val inflated=try{Meter(BufferedInputStream(GZIPInputStream(peek,8192),8192),limits.uncompressedBytes,"NBT_TOO_LARGE",cancelled,true)}
            catch(e:Exception){if(e is NativeLitematicError||e is CancellationException)throw e;throw NativeLitematicError("INVALID_GZIP","Invalid gzip header",e)}
        val root=try{NativeJavaNbt(inflated,limits.nbt,cancelled).root()}
            catch(e:Exception){if(e is NativeLitematicError||e is CancellationException)throw e;throw NativeLitematicError("INVALID_NBT","Could not parse Java big-endian NBT",e)}
        checkpoint(cancelled)
        val version=integer(root["Version"],"Version");val subVersion=root["SubVersion"]?.let{integer(it,"SubVersion")}
        val dataVersion=integer(root["MinecraftDataVersion"],"MinecraftDataVersion")
        val metadata=root["Metadata"]?.let{record(it,"Metadata")}.orEmpty()
        val regionMap=record(root["Regions"],"Regions");if(regionMap.isEmpty())invalid("Litematic contains no regions")
        enforce(regionMap.size<=limits.regions,"Region count exceeds ${limits.regions}")
        var total=0L
        val regions=regionMap.toSortedMap().map{(name,raw)->checkpoint(cancelled);parseRegion(name,raw,limits).also{
            total+=it.preview.volume;enforce(total<=limits.totalVolume,"Total region volume exceeded")}}
        val min=List(3){axis->regions.minOf{it.minimum[axis]}}
        val max=List(3){axis->regions.maxOf{safe(it.minimum[axis]+it.preview.dimensions[axis]-1)}}
        val dimensions=List(3){axis->safe(max[axis]-min[axis]+1)}
        enforce(dimensions[0]<=limits.horizontal&&dimensions[2]<=limits.horizontal&&dimensions[1]<=limits.vertical,"Combined dimensions exceeded")
        fun key(x:Long,y:Long,z:Long)=((x-min[0])*dimensions[1]+y-min[1])*dimensions[2]+z-min[2]
        val blocks=linkedMapOf<Long,Voxel>();val placeholders=sortedSetOf<String>();val propertyNames=sortedSetOf<String>()
        var mapped=0;var placeholderPalette=0;var paletteEntries=0;var entities=0;var tiles=0;var ticks=0
        for(region in regions){
            checkpoint(cancelled);paletteEntries+=region.palette.size;entities+=region.entities;tiles+=region.tiles.size;ticks+=region.ticks
            val mappings=region.palette.map(::mapBlock)
            region.palette.forEachIndexed{i,state->if(!air(state.name)){propertyNames+=state.properties.keys
                if(mappings[i].second){placeholderPalette++;placeholders+=state.name}else mapped++}}
            val bits=max(2,ceil(log2(region.palette.size.toDouble())).toInt());val volume=region.preview.volume
            if(region.packed.size.toLong()!=(volume*bits+63)/64)invalid("Unexpected BlockStates long count")
            val width=region.preview.dimensions[0];val depth=region.preview.dimensions[2]
            for(index in 0 until volume){
                if(index%1024==0L)checkpoint(cancelled)
                val paletteIndex=packedIndex(region.packed,index,bits);val state=region.palette.getOrNull(paletteIndex)?:invalid("Missing palette index")
                val x=region.minimum[0]+index%width;val z=region.minimum[2]+index/width%depth;val y=region.minimum[1]+index/(width.toLong()*depth)
                val coordinate=key(x,y,z)
                if(air(state.name))blocks.remove(coordinate)
                else {val mapping=mappings[paletteIndex];blocks[coordinate]=Voxel(x,y,z,state,mapping.first,mapping.second)
                    enforce(blocks.size<=limits.voxels,"Output block count exceeds ${limits.voxels}")}
            }
            for(raw in region.tiles){checkpoint(cancelled);val entity=raw as? Map<*,*>?:continue
                val p=runCatching{listOf("x","y","z").map{integer(entity[it],it)}}.getOrNull()?:continue
                if(p.indices.any{p[it] !in 0L until region.preview.dimensions[it].toLong()})continue
                val voxel=blocks[key(region.minimum[0]+p[0],region.minimum[1]+p[1],region.minimum[2]+p[2])]?:continue
                @Suppress("UNCHECKED_CAST") NativeLitematicEntities.attach(voxel,entity as Map<String,Any>,dataVersion)
            }
        }
        if(blocks.isEmpty())invalid("Litematic contains no non-air blocks")
        val values=blocks.values.toList();val origin=listOf(values.minOf{it.x},values.minOf{it.y},values.minOf{it.z})
        val normalized=values.map{it.copy(x=it.x-origin[0],y=it.y-origin[1],z=it.z-origin[2])}
        val ordered=buildOrder(normalized,cancelled);checkpoint(cancelled)
        val title=metadata["Name"] as? String?:"Untitled Litematic"
        if(title.all{it.isWhitespace()||it=='\uFEFF'})invalid("Blueprint title cannot be blank")
        val suffix=if(regions.any{r->r.preview.signedSize.any{it<0}})"-coords2" else ""
        val blueprint=JSONObject().put("schemaVersion",1).put("id","litematic-${inflated.hash()}$suffix").put("title",title)
        val bounds=JSONObject().put("minX",0).put("minY",0).put("minZ",0).put("maxX",normalized.maxOf{it.x}).put("maxY",normalized.maxOf{it.y}).put("maxZ",normalized.maxOf{it.z})
        val voxels=JSONArray();ordered.forEachIndexed{i,v->if(i%128==0)checkpoint(cancelled)
            val order=if(ordered.size==1)10000 else floor(i.toDouble()/(ordered.size-1)*10000+.5).toInt()
            val o=JSONObject().put("x",v.x).put("y",v.y).put("z",v.z).put("materialId",v.material).put("buildOrder",order)
                .put("stage",when{order<1800->"foundation";order<3800->"frame";order<6500->"walls";order<8800->"roof";else->"details"}).put("sourceBlockId",v.state.name)
            if(v.state.properties.isNotEmpty())o.put("sourceBlockState",JSONObject(v.state.properties))
            v.moved?.let{o.put("movingPistonMovedState",it)};v.pose?.let{o.put("movingPistonPose",it)};v.sign?.let{o.put("sign",it)};v.campfire?.let{o.put("campfire",it)}
            emissive(v.state)?.let{(kind,level)->o.put("emissiveKind",kind).put("emissiveLevel",level)};voxels.put(o)
        }
        blueprint.put("bounds",bounds).put("voxels",voxels)
        val moved=values.count{it.moved!=null};val pose=values.count{it.pose!=null};val signs=values.count{it.sign!=null};val campfires=values.count{it.campfire!=null}
        val compatibility=mapOf("mappedPaletteEntries" to mapped,"placeholderPaletteEntries" to placeholderPalette,"placeholderBlockNames" to placeholders.toList(),
            "placeholderVoxelCount" to values.count{it.placeholder},"preservedBlockStateProperties" to propertyNames.toList(),"ignoredEntities" to entities,
            "ignoredTileEntities" to tiles-moved-signs-campfires,"preservedMovingPistonMovedStates" to moved,"preservedMovingPistonPoses" to pose,
            "preservedSignBlockEntities" to signs,"preservedCampfireBlockEntities" to campfires,"ignoredPendingTicks" to ticks)
        checkpoint(cancelled)
        return NativeLitematicResult(blueprint.toString(),NativeLitematicPreview(title,metadata["Author"] as? String?:"",metadata["Description"] as? String?:"",
            version,subVersion,dataVersion,dimensions.map{it.toInt()},Collections.unmodifiableList(regions.map{it.preview}),ordered.size,Collections.unmodifiableMap(compatibility),metadata["TotalBlocks"]?.let{integer(it,"Metadata.TotalBlocks")}),
            bounds.getLong("maxX")<12&&bounds.getLong("maxY")<16&&bounds.getLong("maxZ")<12&&ordered.size<=2000,blueprint.getString("id"))
    }
    private fun parseRegion(name:String,raw:Any,limits:NativeLitematicLimits):Region {
        val r=record(raw,"Region");val position=position(r["Position"]);val signed=position(r["Size"])
        if(signed.any{it==0L})invalid("Zero-sized region axis")
        val sizes=signed.map{abs(it)};enforce(sizes[0]<=limits.horizontal&&sizes[2]<=limits.horizontal&&sizes[1]<=limits.vertical,"Region dimensions exceeded")
        val volume=sizes[0]*sizes[1]*sizes[2];enforce(volume<=limits.regionVolume,"Region volume exceeded")
        val rawPalette=list(r["BlockStatePalette"],"BlockStatePalette");enforce(rawPalette.isNotEmpty()&&rawPalette.size<=limits.palette,"Palette limit exceeded")
        val palette=rawPalette.map{entry->val p=record(entry,"Palette");val id=p["Name"] as? String?:invalid("Missing palette name")
            if(!Regex("[a-z0-9_.-]+:[a-z0-9_./-]+").matches(id))invalid("Invalid block ID");State(id,properties(p["Properties"]))}
        val packed=when(val value=r["BlockStates"]){is LongArray->value;is List<*>->LongArray(value.size){value[it] as? Long?:invalid("Invalid packed long value")};else->invalid("BlockStates must be a long array")}
        fun optionalList(key:String)=r[key]?.let{list(it,key)}?:emptyList()
        return Region(NativeRegionPreview(name,position,signed,sizes.map{it.toInt()},palette.size,volume),
            position.mapIndexed{i,n->safe(n+min(0,signed[i]+1))},palette,packed,optionalList("Entities").size,optionalList("TileEntities"),optionalList("PendingBlockTicks").size+optionalList("PendingFluidTicks").size)
    }
    fun packedIndex(longs:LongArray,index:Long,bits:Int):Int {
        require(index>=0&&bits in 1..32);val start=index*bits;val at=(start/64).toInt();val offset=(start%64).toInt();val mask=(1L shl bits)-1
        val first=longs.getOrNull(at)?:invalid("Missing packed long")
        val value=if(offset+bits<=64)first ushr offset else (first ushr offset)or((longs.getOrNull(at+1)?:invalid("Missing packed long")) shl (64-offset))
        return(value and mask).toInt()
    }
    private fun mapBlock(s:State):Pair<String,Boolean> {
        val path=s.name.substringAfter(':');fun test(pattern:String)=Regex(pattern).containsMatchIn(path)
        return when{
            !s.name.startsWith("minecraft:")->"accent" to true
            test("(?:^|_)(?:glass|glass_pane|ice|stained_glass)(?:$|_)")->"glass" to false
            test("(?:log|wood|stem|hyphae|bamboo_block|fence|fence_gate)$")->"wood" to false
            test("(?:stairs|slab|tile|terracotta|concrete|wool|copper|purpur|prismarine)$")->"roof" to false
            test("(?:planks|shelf|bookshelf|barrel|chest|crafting_table|lectern|door|trapdoor|sign|button|pressure_plate)$")||test("^(?:oak|spruce|birch|jungle|acacia|dark_oak|pale_oak|mangrove|cherry|bamboo|crimson|warped)_")->"plank" to false
            test("(?:stone|cobble|brick|deepslate|andesite|diorite|granite|calcite|tuff|basalt|blackstone|quartz|sandstone|obsidian|ore|bedrock|dirt|grass_block|sand|gravel|mud|clay|netherrack|end_stone|observer|piston|resin|sulfur|cinnabar)")->"stone" to false
            test("(?:torch|lantern|light|glowstone|campfire|end_rod|flower|plant|leaves|vine|moss|grass|fern|bush|sapling|banner|carpet|bed|rail|ladder|hopper|anvil|cauldron|chain|candle|pot|skull|head|bell|lever|iron_bars|water|lava|bubble_column)")->"accent" to false
            else->"accent" to true
        }
    }
    private fun detail(v:Voxel):Int=v.rank
    private fun buildOrder(values:List<Voxel>,cancelled:()->Boolean):List<Voxel> {
        val strideY=values.maxOf{it.y}+3;val strideZ=values.maxOf{it.z}+3
        fun key(x:Long,y:Long,z:Long)=(x*strideY+y)*strideZ+z
        fun key(v:Voxel)=key(v.x,v.y,v.z)
        fun neighbors(v:Voxel)=longArrayOf(key(v.x-1,v.y,v.z),key(v.x+1,v.y,v.z),key(v.x,v.y-1,v.z),key(v.x,v.y+1,v.z),key(v.x,v.y,v.z-1),key(v.x,v.y,v.z+1))
        val compare=Comparator<Voxel>{a,b->(detail(a)-detail(b)).takeIf{it!=0}?:a.y.compareTo(b.y).takeIf{it!=0}?:a.x.compareTo(b.x).takeIf{it!=0}?:a.z.compareTo(b.z)}
        val byCoordinate=values.associateBy(::key);val queued=hashSetOf<Long>();val built=hashSetOf<Long>();val heap=PriorityQueue(compare)
        val disconnected=values.filter{!byCoordinate.containsKey(key(it.x,it.y-1,it.z))}.sortedWith(compare);var disconnectedIndex=0
        val ordered=ArrayList<Voxel>(values.size)
        fun enqueue(v:Voxel?,force:Boolean=false){if(v==null)return;val key=key(v);if(key in queued||key in built)return
            if(!force&&v.y!=0L){val below=key(v.x,v.y-1,v.z);if(below in byCoordinate&&below !in built)return;if(neighbors(v).none{it in built})return}
            queued.add(key);heap.add(v)}
        values.filter{it.y==0L}.sortedWith(compare).forEach{enqueue(it)}
        while(ordered.size<values.size){if(ordered.size%128==0)checkpoint(cancelled)
            var next=heap.poll();if(next==null){while(disconnectedIndex<disconnected.size&&key(disconnected[disconnectedIndex]) in built)disconnectedIndex++
                enqueue(disconnected.getOrNull(disconnectedIndex),true);next=heap.poll()}
            if(next==null)invalid("Construction ordering stalled");built.add(key(next));ordered.add(next);neighbors(next).forEach{enqueue(byCoordinate[it])}
        };return ordered
    }
    private fun emissive(s:State):Pair<String,Int>? {
        val p=s.name.substringAfter(':');val lit=s.properties["lit"]!="false"
        if(!s.name.startsWith("minecraft:"))return null
        fixedLights[p]?.let{return (when(p){"wall_torch"->"torch";"soul_wall_torch"->"soul_torch";"magma_block"->"magma";else->p}) to it}
        if(p in setOf("ochre_froglight","verdant_froglight","pearlescent_froglight"))return "froglight" to 15
        if(lit&&p in setOf("campfire","soul_campfire","redstone_torch","redstone_wall_torch","redstone_lamp"))return (if(p=="redstone_wall_torch")"redstone_torch" else p) to when(p){"soul_campfire"->10;"redstone_torch","redstone_wall_torch"->7;else->15}
        if(p=="light")return s.properties["level"].let{it?.toIntOrNull()?:if(it==null)15 else 0}.takeIf{it in 1..15}?.let{"light" to it}
        if(Regex("(?:^|_)copper_(?:wall_)?torch$").containsMatchIn(p))return "copper_torch" to 14
        if(Regex("(?:^|_)copper_lantern$").containsMatchIn(p))return "copper_lantern" to 15
        if(Regex("(?:^|_)copper_bulb$").containsMatchIn(p)&&lit)return "copper_bulb" to when{p.contains("oxidized")->4;p.contains("weathered")->8;p.contains("exposed")->12;else->15}
        fun bounded(key:String,default:Int)=s.properties[key]?.toIntOrNull()?.takeIf{it in 1..4}?:default
        if(p=="sea_pickle"&&s.properties["waterlogged"]!="false")return "sea_pickle" to (3+bounded("pickles",1)*3)
        if(p=="respawn_anchor")return bounded("charges",0).takeIf{it>0}?.let{"respawn_anchor" to it*4-1}
        if(Regex("(?:^|_)candle$").containsMatchIn(p)&&lit)return "candle" to bounded("candles",1)*3
        return null
    }
    private class Meter(input:InputStream,val maximum:Long,val code:String,val cancelled:()->Boolean,val hashing:Boolean=false):FilterInputStream(input) {
        private var count=0L;private var first=0x811c9dc5.toInt();private var second=0x9e3779b9.toInt()
        private fun accept(bytes:ByteArray,offset:Int,n:Int){if(n<=0)return;enforceRead(n);if(hashing)for(i in offset until offset+n){val b=bytes[i].toInt()and 255;first=(first xor b)*0x01000193;second=Integer.rotateLeft((second xor b)*0x85ebca6b.toInt(),13)}}
        private fun enforceRead(n:Int){checkpoint(cancelled);if(count>maximum-n)throw NativeLitematicError(code,"Blueprint byte limit exceeded");count+=n}
        override fun read():Int {checkpoint(cancelled);val b=`in`.read();if(b>=0){enforceRead(1);if(hashing){first=(first xor b)*0x01000193;second=Integer.rotateLeft((second xor b)*0x85ebca6b.toInt(),13)}};return b}
        override fun read(b:ByteArray,off:Int,len:Int):Int {checkpoint(cancelled);val n=`in`.read(b,off,minOf(8192,len,(maximum-count+1).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()));accept(b,off,n);return n}
        fun hash()=first.toUInt().toString(16).padStart(8,'0')+second.toUInt().toString(16).padStart(8,'0')
    }
}
