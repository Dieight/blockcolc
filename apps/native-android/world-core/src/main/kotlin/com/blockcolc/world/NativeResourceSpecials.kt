package com.blockcolc.world

import com.blockcolc.world.generation.*
import com.blockcolc.world.resource.*
import org.json.JSONObject
import org.json.JSONArray
import java.nio.FloatBuffer
import java.util.concurrent.CancellationException
import kotlin.math.*

/** Finite static model definitions exported from the formal renderer. User
 * blueprints/states, textures and world instances are never baked here. */
object NativeResourceSpecialModels {
    internal val root:JSONObject by lazy {
        val text=checkNotNull(javaClass.getResourceAsStream("/native-resource-special-models.json")).use{it.readBytes()};require(text.size<=4*1024*1024)
        JSONObject(text.toString(Charsets.UTF_8)).also{require(it.getInt("schema")==1)}
    }
    class Part internal constructor(val key:String,internal val source:JSONObject,val geometry:BlockGeometry)
    private val models=HashMap<String,List<Part>>()
    @Synchronized internal fun parts(key:String):List<Part> = models.getOrPut(key){val data=root.getJSONObject("models").getJSONArray(key)
        java.util.Collections.unmodifiableList(List(data.length()){i->val row=data.getJSONObject(i)
            fun floats(k:String)=row.getJSONArray(k).let{a->FloatArray(a.length()){a.getDouble(it).toFloat()}}
            val ix=if(row.isNull("indices"))null else row.getJSONArray("indices").let{a->IntArray(a.length()){a.getInt(it)}}
            val geometry=AttributeBlockGeometry(floats("position"),floats("normal"),floats("uv"),index=ix)
            Part("$key:$i",row,geometry)})}
    data class Request(val model:String,val texture:String?=null,val pose:BlockTransform=BlockTransform.IDENTITY,val dye:Int?=null)
    private val directions=mapOf("north" to Triple(0,-1,0.0),"east" to Triple(1,0,-PI/2),"south" to Triple(0,1,PI),"west" to Triple(-1,0,PI/2))
    private fun rotation(value:String?,fallback:Boolean):Double?{
        if(value==null)return 0.0
        val raw=value.trim();val n=if(raw.isEmpty())0.0 else if(Regex("0[xX][0-9a-fA-F]+").matches(raw))raw.substring(2).toLongOrNull(16)?.toDouble()
            else if(Regex("0[bB][01]+").matches(raw))raw.substring(2).toLongOrNull(2)?.toDouble() else if(Regex("0[oO][0-7]+").matches(raw))raw.substring(2).toLongOrNull(8)?.toDouble()else raw.toDoubleOrNull()
        return if(n!=null&&n.isFinite()&&n==floor(n)&&n in 0.0..15.0)n else if(fallback)0.0 else null
    }
    fun resolve(v:RenderVoxel):Request?{
        val id=v.sourceBlockId?:return null;val s=v.sourceBlockState.orEmpty();val lower=id.lowercase()
        if(lower.startsWith("minecraft:")){
            val name=lower.removePrefix("minecraft:");val chests=root.getJSONObject("chests");val base=name.removePrefix("waxed_")
            if(chests.has(base)){
                val facing=s["facing"]?:"north";if(facing !in directions)return null
                val shape=if(name=="ender_chest")"single" else s["type"]?:"single";if(shape !in setOf("single","left","right"))return null
                val texture="minecraft:entity/chest/"+chests.getString(base)+(if(shape=="single")""else "_$shape")
                return Request("chest:$shape",texture,BlockTransform.rotationY(NativeStaticBlockEntities.facingYaw(facing)))
            }
            val color=if(name=="shulker_box")"" else name.removeSuffix("_shulker_box").takeIf{name.endsWith("_shulker_box")&&root.getJSONObject("dyes").has(it)}
            if(color!=null){
                val facing=s["facing"]?:"up";if(facing !in directions&&facing !in setOf("up","down"))return null
                fun rotate(x:Double,y:Double,z:Double)=when(facing){"down"->doubleArrayOf(x,-y,-z);"north"->doubleArrayOf(-x,-z,-y);"south"->doubleArrayOf(x,-z,y);"west"->doubleArrayOf(-y,-z,x);"east"->doubleArrayOf(y,-z,-x);else->doubleArrayOf(x,y,z)}
                val a=rotate(1.0,0.0,0.0);val b=rotate(0.0,1.0,0.0);val c=rotate(0.0,0.0,1.0)
                val pose=BlockTransform.fromElements(doubleArrayOf(a[0],a[1],a[2],0.0,b[0],b[1],b[2],0.0,c[0],c[1],c[2],0.0,0.0,0.0,0.0,1.0))
                return Request("shulker","minecraft:entity/shulker/shulker"+(if(color.isEmpty())""else "_$color"),pose)
            }
        }
        val skulls=root.getJSONObject("skulls")
        if(skulls.has(id)){
            val skull=skulls.getJSONObject(id);val wall=id.endsWith("_wall_head")||id.endsWith("_wall_skull")
            val pose=if(wall){val direction=directions[s["facing"]?:"north"]?:return null;BlockTransform.translation(-direction.first*.25,-.25,-direction.second*.25)*BlockTransform.rotationY(direction.third)}
                else BlockTransform.translation(0.0,-.5,0.0)*BlockTransform.rotationY((rotation(s["rotation"],false)?:return null)*PI/8)
            return Request(skull.getString("model"),skull.getString("textureId"),pose)
        }
        val copper=root.getJSONObject("copper")
        if(copper.has(id)){
            val pose=s["pose"]?:"standing";if(pose !in setOf("standing","running","sitting","star"))return null
            val direction=directions[s["facing"]?:"north"]?:return null
            return Request("copper:$pose",copper.getString(id),BlockTransform.translation(0.0,-.5,0.0)*BlockTransform.rotationY(direction.third))
        }
        val banner=Regex("^minecraft:(.+?)(?:_(wall))?_banner$").matchEntire(id)
        if(banner!=null&&root.getJSONObject("dyes").has(banner.groupValues[1])){
            val wall=banner.groupValues[2]=="wall";val yaw=if(wall)NativeStaticBlockEntities.facingYaw(s["facing"]?:"south")else -rotation(s["rotation"],true)!!*PI/8
            return Request(if(wall)"wall_banner"else "banner",pose=BlockTransform.rotationY(yaw),dye=root.getJSONObject("dyes").getInt(banner.groupValues[1]))
        }
        return when(id){
            "minecraft:decorated_pot"->Request("pot",pose=BlockTransform.rotationY(directions[s["facing"]?:"north"]?.third?:0.0))
            "minecraft:conduit"->Request("conduit")
            "minecraft:end_portal"->Request("portal",pose=BlockTransform.translation(0.0,.0625,0.0))
            "minecraft:end_gateway"->Request("gateway")
            else->null
        }
    }
}
class NativeResourceSpecialDraw internal constructor(val member:Int,val part:NativeResourceSpecialModels.Part,val material:NativeRenderMaterial,val pose:BlockTransform)
/** Decode only a requested source texture, retaining bounded immutable pixels.
 * Required-part validation precedes adoption, so missing assets never create a
 * half chest/banner/pot. Invalid assets remain on the ordinary fallback path. */
class NativeResourceSpecialCompiler(private val stack:ResourcePackStack,private val workingBudget:Long=16L*1024*1024){
    private val pixels=LinkedHashMap<String,NativePixelTexture>(16,.75f,true);private var bytes=0L
    fun compile(v:RenderVoxel,index:Int,cancelled:()->Boolean={false}):List<NativeResourceSpecialDraw>?{
        fun check(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Special resource superseded")}
        check();val request=NativeResourceSpecialModels.resolve(v)?:return null;val parts=NativeResourceSpecialModels.parts(request.model)
        val ids=parts.map{request.texture?:it.source.getString("texture")};if(ids.any{it !in stack.specialTextures})return null
        val prepared=ArrayList<NativeResourceSpecialDraw>()
        for((i,part)in parts.withIndex()){
            check();val id=ids[i];val row=part.source
            val policy="$id:${row.getInt("minFilter")}:${row.getInt("magFilter")}:${row.getBoolean("mipmaps")}:${row.getInt("wrapS")}:${row.getInt("wrapT")}:${row.getDouble("anisotropy")}" 
            val texture=pixels[policy]?:run{
                val source=stack.specialTextures.getValue(id);val size=source.descriptor.width.toLong()*source.descriptor.height*4
                val mip=if(row.getBoolean("mipmaps"))GpuFootprint.mipBytes(source.descriptor.width,source.descriptor.height)else size
                if(size*4+mip*2>workingBudget)return null
                val decoded=try{source.decode(cancelled)}catch(e:CancellationException){throw e}catch(_:Exception){return null}
                val value=NativePixelTexture(decoded.width,decoded.height,decoded.rgba(),mipmaps=row.getBoolean("mipmaps"),wrapS=row.getInt("wrapS"),wrapT=row.getInt("wrapT"),minFilter=row.getInt("minFilter"),magFilter=row.getInt("magFilter"),anisotropy=row.getDouble("anisotropy").toFloat())
                while(pixels.isNotEmpty()&&bytes+size>workingBudget/2){val iterator=pixels.entries.iterator();val old=iterator.next().value;bytes-=old.width.toLong()*old.height*4;iterator.remove()}
                if(size<=workingBudget/2){pixels[policy]=value;bytes+=size};value
            }
            val dye=request.dye?.takeIf{row.getString("kind").endsWith("_dye")}
            val color=if(dye!=null)LinearRgb.fromSrgb(dye)else row.getJSONArray("color").let{LinearRgb(it.getDouble(0).toFloat(),it.getDouble(1).toFloat(),it.getDouble(2).toFloat())}
            val material=NativeRenderMaterial(color=color,texture=texture,roughness=row.getDouble("roughness").toFloat(),metalness=row.getDouble("metalness").toFloat(),transparent=row.getBoolean("transparent"),alphaCutoff=row.getDouble("alphaTest").toFloat(),unlit=row.getBoolean("unlit"),flipY=row.getBoolean("flipY"),side=NativeFaceSide.entries.first{it.code==row.getInt("side")})
            prepared+=NativeResourceSpecialDraw(index,part,material,request.pose)
        }
        check();return java.util.Collections.unmodifiableList(prepared)
    }
    fun clear(){pixels.clear();bytes=0}
}
object NativeResourceSpecialPackets {
    fun append(target:NativePacketBuilder,draws:List<NativeResourceSpecialDraw>,voxels:List<RenderVoxel>,origin:BlockPoint,placement:NativeStructurePlacement,lod:SceneryLod?,cancelled:()->Boolean){
        val parent=placement.parent(origin)
        for(group in draws.groupBy{it.part to it.material}.values)for(chunk in group.chunked(4096)){
            if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Special packets superseded")
            val first=chunk.first();val row=first.part.source;val matrices=FloatArray(chunk.size*16)
            for((i,entry)in chunk.withIndex()){val v=voxels[entry.member];val pose=parent*BlockTransform.translation(v.x-origin.x,v.y-origin.y,v.z-origin.z)*entry.pose;repeat(16){matrices[i*16+it]=pose[it].toFloat()}}
            target.add(first.part.geometry,first.material,FloatBuffer.wrap(matrices),castShadow=row.getBoolean("castShadow"),receiveShadow=row.getBoolean("receiveShadow"),priority=if(row.getInt("order")>=12)7 else if(first.material.transparent)5 else 4,lod=lod)
        }
    }
}
