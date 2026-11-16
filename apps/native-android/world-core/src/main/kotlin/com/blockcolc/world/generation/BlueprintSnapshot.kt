package com.blockcolc.world.generation

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Collections

enum class BlockFacing(val key:String,val dx:Int,val dy:Int,val dz:Int){
    DOWN("down",0,-1,0),UP("up",0,1,0),NORTH("north",0,0,-1),SOUTH("south",0,0,1),WEST("west",-1,0,0),EAST("east",1,0,0)
}
data class PistonMovedState(val blockId:String,val properties:Map<String,String>?)
data class PistonPose(val facing:BlockFacing,val progress:Double,val extending:Boolean,val source:Boolean)
data class SignFace(val lines:List<String>,val dyeColor:String,val glowing:Boolean)
data class SignText(val front:SignFace,val back:SignFace)
data class CampfireItem(val slot:Int,val itemId:String,val count:Int)
data class RenderVoxel(val x:Double,val y:Double,val z:Double,val materialId:String,val buildOrder:Int,
    val sourceBlockId:String?=null,val sourceBlockState:Map<String,String>?=null,
    val movingPistonMovedState:PistonMovedState?=null,val movingPistonPose:PistonPose?=null,
    val sign:SignText?=null,val campfire:List<CampfireItem>?=null,val emissiveKind:String?=null,val emissiveLevel:Int?=null)

/** Immutable render input shared by every completion/condition. Source block
 * entities keep their allowlisted data; the builder never flattens a blueprint
 * into six colors or loses state before resource-pack routing. */
class BlueprintSnapshot private constructor(val id:String,val title:String,val bounds:BlueprintBox,voxels:List<RenderVoxel>,canonicalSource:String?,val geometrySha:String,val canonicalLength:Int){
    val voxels:List<RenderVoxel> = Collections.unmodifiableList(voxels.toList())
    // Restored render inputs need no JSON tree or full text write. Explicit
    // json()/canonical consumers still get the identical normalized wire.
    val canonical:String by lazy{canonicalSource?:canonicalWire(id,title,bounds,this.voxels)}
    fun json()=JSONObject(canonical)
    companion object {
        private val materials=setOf("stone","wood","plank","roof","glass","accent")
        private val dyes=setOf("white","orange","magenta","light_blue","yellow","lime","pink","gray","light_gray","cyan","purple","blue","brown","green","red","black")
        private val blockId=Regex("minecraft:[a-z0-9_.-]+(?:/[a-z0-9_.-]+)*")
        private val itemId=Regex("[a-z0-9_.-]+:[a-z0-9_./-]+")
        private val keyPattern=Regex("[a-z0-9_.-]+")
        private val movedValuePattern=Regex("[a-z0-9_./-]+")
        private val forbidden=setOf("__proto__","constructor","prototype")
        fun read(input:JSONObject,decoration:Boolean=false):BlueprintSnapshot{
            require(integer(input,"schemaVersion")==1L)
            val id=text(input,"id");val title=text(input,"title");val b=input.getJSONObject("bounds")
            val bounds=BlueprintBox(integer(b,"minX"),integer(b,"maxX"),integer(b,"minY"),integer(b,"maxY"),integer(b,"minZ"),integer(b,"maxZ"))
            require(bounds.maxX-bounds.minX+1 in 1L..(if(decoration)12L else 96L))
            require(bounds.maxZ-bounds.minZ+1 in 1L..(if(decoration)12L else 96L))
            require(bounds.maxY-bounds.minY+1 in 1L..(if(decoration)16L else 256L))
            val raw=input.getJSONArray("voxels");require(raw.length() in 1..(if(decoration)2000 else 300000))
            val occupied=HashSet<Triple<Long,Long,Long>>();val minimum=LongArray(3){Long.MAX_VALUE};val maximum=LongArray(3){Long.MIN_VALUE}
            val voxels=List(raw.length()){i->
                val v=raw.getJSONObject(i);val x=integer(v,"x");val y=integer(v,"y");val z=integer(v,"z")
                require(x in bounds.minX..bounds.maxX&&y in bounds.minY..bounds.maxY&&z in bounds.minZ..bounds.maxZ&&occupied.add(Triple(x,y,z))){"Duplicate or out-of-bounds blueprint voxel"}
                for((axis,n)in listOf(x,y,z).withIndex()){minimum[axis]=minOf(minimum[axis],n);maximum[axis]=maxOf(maximum[axis],n)}
                val material=text(v,"materialId");require(material in materials)
                val order=integer(v,"buildOrder");require(order in 0..10000)
                val source=optionalText(v,"sourceBlockId")
                val state=if(v.has("sourceBlockState"))properties(v.getJSONObject("sourceBlockState"))else null
                val moved=if(v.has("movingPistonMovedState")){
                    require(source=="minecraft:moving_piston")
                    val value=v.getJSONObject("movingPistonMovedState");require(keys(value).all{it in setOf("blockId","properties")})
                    val movedId=text(value,"blockId");require(movedId.length<=256&&blockId.matches(movedId)&&movedId !in setOf("minecraft:air","minecraft:cave_air","minecraft:void_air","minecraft:moving_piston"))
                    val props=if(value.has("properties"))properties(value.getJSONObject("properties"))else null
                    require(props==null||props.values.all{movedValuePattern.matches(it)})
                    PistonMovedState(movedId,props)
                }else null
                val pose=if(v.has("movingPistonPose")){
                    require(source=="minecraft:moving_piston")
                    val value=v.getJSONObject("movingPistonPose");require(keys(value)==setOf("facing","progress","extending","source"))
                    val facing=BlockFacing.entries.firstOrNull{it.key==value.get("facing")}?:error("Invalid piston facing")
                    val progress=(value.get("progress") as? Number)?.toDouble()?:error("Invalid piston progress")
                    require(progress.isFinite()&&progress in 0.0..1.0)
                    PistonPose(facing,progress,boolean(value,"extending"),boolean(value,"source"))
                }else null
                val sign=if(v.has("sign")){
                    require(source!=null&&Regex("minecraft:[a-z0-9_]*sign").matches(source))
                    val value=v.getJSONObject("sign");require(keys(value)==setOf("front","back"))
                    SignText(signFace(value.getJSONObject("front")),signFace(value.getJSONObject("back")))
                }else null
                val campfire=if(v.has("campfire")){
                    require(source in setOf("minecraft:campfire","minecraft:soul_campfire"))
                    val value=v.getJSONObject("campfire");require(keys(value)==setOf("slots"))
                    val slots=value.getJSONArray("slots");require(slots.length()<=4)
                    val parsed=List(slots.length()){index->val slot=slots.getJSONObject(index);require(keys(slot)==setOf("slot","itemId","count"))
                        val n=integer(slot,"slot");val count=integer(slot,"count");val item=text(slot,"itemId")
                        require(n in 0..3&&count in 1..64&&item.length<=256&&itemId.matches(item));CampfireItem(n.toInt(),item,count.toInt())}
                    require(parsed.map{it.slot}.distinct().size==parsed.size)
                    Collections.unmodifiableList(parsed.sortedBy{it.slot})
                }else null
                val emissive=optionalText(v,"emissiveKind")
                val level=if(v.has("emissiveLevel"))integer(v,"emissiveLevel").also{require(it in 0..15)}.toInt()else null
                RenderVoxel(x.toDouble(),y.toDouble(),z.toDouble(),material,order.toInt(),source,state,moved,pose,sign,campfire,emissive,level)
            }
            require(minimum.contentEquals(longArrayOf(bounds.minX,bounds.minY,bounds.minZ))&&maximum.contentEquals(longArrayOf(bounds.maxX,bounds.maxY,bounds.maxZ))){"Blueprint bounds must enclose the actual voxels exactly"}
            // Serialize normalized cells once, without retaining a second
            // complete JSONObject tree or a String per nested JSON value.
            val boundsWire=canonicalJson(boxJson(bounds))
            val cellsWire=buildString{
                append('[');voxels.forEachIndexed{i,v->if(i>0)append(',');appendCanonical(this,voxelJson(v))};append(']')
            }
            val hasher=MessageDigest.getInstance("SHA-256")
            hasher.update('['.code.toByte());hasher.update(boundsWire.toByteArray(Charsets.UTF_8));hasher.update(','.code.toByte())
            hasher.update(cellsWire.toByteArray(Charsets.UTF_8));hasher.update(']'.code.toByte())
            val digest=hasher.digest().joinToString(""){"%02x".format(it.toInt() and 255)}
            val wire=buildString{
                append("{\"bounds\":");append(boundsWire);append(",\"id\":");SourceNumbers.appendQuoted(this,id)
                append(",\"schemaVersion\":1,\"title\":");SourceNumbers.appendQuoted(this,title)
                append(",\"voxels\":");append(cellsWire);append('}')
            }
            return BlueprintSnapshot(id,title,bounds,voxels,wire,digest,wire.length)
        }
        /** Codec owns and checks all inputs before calling this boundary. */
        internal fun fromCachedRender(id:String,title:String,bounds:BlueprintBox,voxels:List<RenderVoxel>,geometrySha:String,canonicalLength:Int):BlueprintSnapshot {
            nonBlank(id);nonBlank(title);require(geometrySha.matches(Regex("[a-f0-9]{64}")))
            require(canonicalLength in 2..512*1024*1024)
            return BlueprintSnapshot(id,title,bounds,voxels,null,geometrySha,canonicalLength)
        }
        private fun canonicalWire(id:String,title:String,bounds:BlueprintBox,voxels:List<RenderVoxel>):String=buildString{
            append("{\"bounds\":");appendCanonical(this,boxJson(bounds));append(",\"id\":");SourceNumbers.appendQuoted(this,id)
            append(",\"schemaVersion\":1,\"title\":");SourceNumbers.appendQuoted(this,title);append(",\"voxels\":[")
            voxels.forEachIndexed{i,v->if(i>0)append(',');appendCanonical(this,voxelJson(v))};append("]}")
        }
        internal fun voxelJson(v:RenderVoxel):JSONObject{
            val value=JSONObject().put("x",v.x).put("y",v.y).put("z",v.z).put("materialId",v.materialId).put("buildOrder",v.buildOrder)
            v.sourceBlockId?.let{value.put("sourceBlockId",it)};v.sourceBlockState?.let{value.put("sourceBlockState",JSONObject(it))}
            v.movingPistonMovedState?.let{m->value.put("movingPistonMovedState",JSONObject().put("blockId",m.blockId).apply{m.properties?.let{put("properties",JSONObject(it))}})}
            v.movingPistonPose?.let{p->value.put("movingPistonPose",JSONObject().put("facing",p.facing.key).put("progress",p.progress).put("extending",p.extending).put("source",p.source))}
            v.sign?.let{s->fun face(f:SignFace)=JSONObject().put("lines",JSONArray(f.lines)).put("dyeColor",f.dyeColor).put("glowing",f.glowing)
                value.put("sign",JSONObject().put("front",face(s.front)).put("back",face(s.back)))}
            v.campfire?.let{items->value.put("campfire",JSONObject().put("slots",JSONArray(items.map{JSONObject().put("slot",it.slot).put("itemId",it.itemId).put("count",it.count)})))}
            v.emissiveKind?.let{value.put("emissiveKind",it)};v.emissiveLevel?.let{value.put("emissiveLevel",it)}
            return value
        }
        private fun boxJson(b:BlueprintBox)=JSONObject().put("minX",b.minX).put("maxX",b.maxX).put("minY",b.minY).put("maxY",b.maxY).put("minZ",b.minZ).put("maxZ",b.maxZ)
        private fun keys(value:JSONObject)=value.keys().asSequence().toSet()
        private fun integer(value:JSONObject,key:String):Long{
            val n=(value.get(key) as? Number)?.toDouble()?:error("Expected blueprint integer")
            require(n.isFinite()&&n in -9_007_199_254_740_991.0..9_007_199_254_740_991.0&&n==n.toLong().toDouble());return n.toLong()
        }
        private fun text(value:JSONObject,key:String)=nonBlank(value.get(key) as? String?:error("Expected blueprint text"))
        private fun nonBlank(value:String)=value.also{require(it.any{c->
            c !in '\u0009'..'\u000d'&&c !in '\u2000'..'\u200a'&&c !in setOf(' ','\u00a0','\u1680','\u2028','\u2029','\u202f','\u205f','\u3000','\ufeff')
        })}
        private fun optionalText(value:JSONObject,key:String)=if(value.has(key))text(value,key)else null
        private fun boolean(value:JSONObject,key:String)=value.get(key) as? Boolean?:error("Expected blueprint boolean")
        private fun properties(value:JSONObject):Map<String,String>?{
            val keys=keys(value);require(keys.size<=32)
            val result=keys.sorted().associateWith{key->require(key.length in 1..64&&keyPattern.matches(key)&&key !in forbidden)
                (value.get(key) as? String?:error("Expected block-state string")).also{require(it.length in 1..128)}}
            return if(result.isEmpty())null else Collections.unmodifiableMap(result)
        }
        private fun signFace(value:JSONObject):SignFace{
            require(keys(value)==setOf("lines","dyeColor","glowing"))
            val raw=value.getJSONArray("lines");require(raw.length()<=4)
            val lines=List(raw.length()){i->(raw.get(i) as? String?:error("Invalid sign line")).also{require(it.length<=256&&it.none{c->c.code<=31||c.code==127})}}
            val dye=text(value,"dyeColor");require(dye in dyes)
            return SignFace(Collections.unmodifiableList(lines),dye,boolean(value,"glowing"))
        }
        internal fun canonicalJson(value:Any?):String=buildString{appendCanonical(this,value)}
        private fun appendCanonical(out:StringBuilder,value:Any?){
            when(value){
                null,JSONObject.NULL->out.append("null")
                is JSONObject->{
                    out.append('{');value.keys().asSequence().toList().sorted().forEachIndexed{i,key->
                        if(i>0)out.append(',');SourceNumbers.appendQuoted(out,key);out.append(':');appendCanonical(out,value.get(key))
                    };out.append('}')
                }
                is JSONArray->{out.append('[');for(i in 0 until value.length()){if(i>0)out.append(',');appendCanonical(out,value.get(i))};out.append(']')}
                is String->SourceNumbers.appendQuoted(out,value)
                is Number->out.append(SourceNumbers.text(value.toDouble()))
                is Boolean->out.append(value)
                else->error("Unexpected blueprint value")
            }
        }
    }
}
