package com.blockcolc.world

import com.blockcolc.world.generation.*
import com.blockcolc.world.generation.StaticBlockEntityGeometry.Mounting
import java.nio.FloatBuffer
import java.util.Collections
import java.util.concurrent.CancellationException
import kotlin.math.*

fun interface NativeSignRasterizer { fun rasterize(face:SignFace):NativePixelTexture }
data class NativeBlockEntityRequest(val owner:String,val voxels:List<RenderVoxel>,val fallbackIndices:Set<Int>?=null,val metadataIndices:List<Int>?=null)
data class NativeSignDisplay(val index:Int,val voxel:RenderVoxel,val mounting:Mounting,val yaw:Double,val front:SignFace?,val back:SignFace?,val fallback:Boolean)
data class NativeItemAppearance(val hash:Long,val hueDegrees:Int,val saturation:Double,val lightness:Double,val scale:Double,val yaw:Double) {
    fun color():LinearRgb {
        val h=hueDegrees/360.0;val q=if(lightness<=.5)lightness*(1+saturation)else lightness+saturation-lightness*saturation;val p=2*lightness-q
        fun hue(value:Double):Float {val t=(value%1+1)%1;return(when{t<1.0/6->p+(q-p)*6*t;t<.5->q;t<2.0/3->p+(q-p)*6*(2.0/3-t);else->p}).toFloat()}
        return LinearRgb(hue(h+1.0/3),hue(h),hue(h-1.0/3))
    }
}
data class NativeCampfireMarker(val slot:Int,val itemId:String,val count:Int,val x:Double,val y:Double,val z:Double,val tokens:Int,val appearance:NativeItemAppearance)
data class NativeCampfireDisplay(val index:Int,val voxel:RenderVoxel,val yaw:Double,val markers:List<NativeCampfireMarker>,val fallback:Boolean)
@ConsistentCopyVisibility
data class NativeStaticEntityPlan internal constructor(val signs:List<NativeSignDisplay>,val campfires:List<NativeCampfireDisplay>,val replacedIndices:Set<Int>,
    val pendingBlocks:Int,val omittedTextFaces:Int)

/** One generation-worker display owner. The admission budget is world-wide,
 * while immutable text tiles and packets remain independently replaceable.
 * A resource-pack model supplies its own body; only fallback instances are
 * removed. Metadata and text/items still apply to either route. */
class NativeStaticBlockEntities(private val rasterizer:NativeSignRasterizer?=null) {
    companion object {
        const val MAX_SIGNS=256;const val MAX_CAMPFIRES=256;const val MAX_FACES=64
        val dyeColors:Map<String,Int> = mapOf("white" to 0xf9fffe,"orange" to 0xf9801d,"magenta" to 0xc74ebd,"light_blue" to 0x3ab3da,"yellow" to 0xfed83d,"lime" to 0x80c71f,
            "pink" to 0xf38baa,"gray" to 0x474f52,"light_gray" to 0x9d9d97,"cyan" to 0x169c9c,"purple" to 0x8932b8,"blue" to 0x3c44aa,"brown" to 0x835432,"green" to 0x5e7c16,"red" to 0xb02e26,"black" to 0x1d1d21)
        fun facingYaw(value:String?):Double=when(value){"west"->-PI/2;"north"->PI;"east"->PI/2;else->0.0}
        fun standingYaw(value:String?):Double {
            val raw=value?.trim()?:return 0.0
            val n=if(raw.length>2&&raw[0]=='0'&&raw[1].lowercaseChar() in "xob")raw.substring(2).toLongOrNull(when(raw[1].lowercaseChar()){'x'->16;'o'->8;else->2})?.toDouble()
                else if(raw.isEmpty())0.0 else raw.toDoubleOrNull()
            return if(n!=null&&n.isFinite()&&n==floor(n)&&n>=0&&n<16)-n*PI/8 else 0.0
        }
        fun appearance(itemId:String):NativeItemAppearance {
            var hash=2166136261L;for(c in itemId)hash=((hash xor c.code.toLong())*16777619L)and 0xffffffffL
            return NativeItemAppearance(hash,(hash%360).toInt(),.58+((hash ushr 9)and 3)*.06,.43+((hash ushr 11)and 3)*.035,.84+((hash ushr 13)and 7)*.045,((hash ushr 16)and 15)*PI/8)
        }
        fun markers(voxel:RenderVoxel):List<NativeCampfireMarker> {
            if(voxel.sourceBlockId !in setOf("minecraft:campfire","minecraft:soul_campfire"))return emptyList()
            val yaw=facingYaw(voxel.sourceBlockState?.get("facing"));val c=cos(yaw);val s=sin(yaw)
            return voxel.campfire.orEmpty().filter{it.slot in 0..3&&it.count>0&&it.itemId.isNotEmpty()}.sortedBy{it.slot}.map{item->
                val x=if(item.slot<2)-.125 else .125;val z=if(item.slot==0||item.slot==3)-.125 else .125
                NativeCampfireMarker(item.slot,item.itemId,item.count,c*x+s*z,-.23828125,-s*x+c*z,min(3,item.count),appearance(item.itemId))}
        }
    }
    private val faces=LinkedHashMap<SignFace,NativePixelTexture>()
    private val bodies=Mounting.entries.associateWith{StaticBlockEntityGeometry.sign(it)}
    private val faceGeometry=Mounting.entries.flatMap{m->listOf(false,true).map{b->(m to b) to StaticBlockEntityGeometry.signFace(m,b)}}.toMap()
    private val logs=StaticBlockEntityGeometry.campfireLogs();private val coal=StaticBlockEntityGeometry.coals();private val fire=StaticBlockEntityGeometry.fire();private val token=StaticBlockEntityGeometry.itemToken()
    private val woodMaterial=NativeRenderMaterial(color=LinearRgb.fromSrgb(0x855a3a),roughness=.92f,emissionStrength=1f)
    private val logMaterial=NativeRenderMaterial(color=LinearRgb.fromSrgb(0x5f402d),roughness=.94f,emissionStrength=1f)
    private val coalMaterial=NativeRenderMaterial(color=LinearRgb.fromSrgb(0x302a25),roughness=1f,emissionStrength=1f)
    private val itemMaterial=NativeRenderMaterial(roughness=.72f,metalness=.02f,vertexColors=true,emissionStrength=1f)
    val retainedTextBytes get()=faces.values.sumOf{it.width.toLong()*it.height*4}
    private fun checkpoint(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Static entity display superseded")}
    fun prepare(requests:List<NativeBlockEntityRequest>,cancelled:()->Boolean={false}):Map<String,NativeStaticEntityPlan> {
        checkpoint(cancelled);require(requests.map{it.owner}.toSet().size==requests.size)
        val used=LinkedHashSet<SignFace>();var signCount=0;var fireCount=0;var tokenCount=0;val result=LinkedHashMap<String,NativeStaticEntityPlan>()
        for(request in requests){require(PacketOwners.valid(request.owner));require(request.fallbackIndices?.all{it in request.voxels.indices}!=false)
            request.metadataIndices?.let{indices->require(indices.all{it in request.voxels.indices}&&indices.zipWithNext().all{(a,b)->a<b})}
            val signs=ArrayList<NativeSignDisplay>();val fires=ArrayList<NativeCampfireDisplay>();val replaced=LinkedHashSet<Int>();var pending=0;var omitted=0
            fun face(value:SignFace):SignFace? {
                if(value.lines.none{it.isNotEmpty()})return null
                if(value !in used&&used.size>=MAX_FACES){omitted++;return null}
                val immutable=value.copy(lines=Collections.unmodifiableList(value.lines.toList()));used+=immutable;return immutable
            }
            for(index in request.metadataIndices?:request.voxels.indices){
                if(index%128==0)checkpoint(cancelled);val v=request.voxels[index];if(v.sign==null&&v.campfire==null)continue
                val fallback=request.fallbackIndices?.contains(index)?:true
                val path=v.sourceBlockId?.removePrefix("minecraft:")
                if(v.sign!=null&&v.sourceBlockId?.startsWith("minecraft:")==true&&path!=null&&Regex("[a-z0-9_]*sign").matches(path)){
                    if(signCount>=MAX_SIGNS){pending++;continue};signCount++
                    val wall=path.contains("wall_");val hanging=path.contains("hanging_sign")
                    val mounting=if(wall)if(hanging)Mounting.WALL_HANGING else Mounting.WALL else if(hanging)Mounting.HANGING else Mounting.STANDING
                    signs+=NativeSignDisplay(index,v,mounting,if(wall)facingYaw(v.sourceBlockState?.get("facing"))else standingYaw(v.sourceBlockState?.get("rotation")),face(v.sign.front),face(v.sign.back),fallback)
                    if(fallback)replaced+=index
                }else if(v.campfire!=null&&v.sourceBlockId in setOf("minecraft:campfire","minecraft:soul_campfire")){
                    if(fireCount>=MAX_CAMPFIRES){pending++;continue};fireCount++
                    val slots=markers(v).mapNotNull{m->val emitted=min(m.tokens,MAX_CAMPFIRES*4*3-tokenCount);tokenCount+=emitted;if(emitted==0)null else m.copy(tokens=emitted)}
                    fires+=NativeCampfireDisplay(index,v,facingYaw(v.sourceBlockState?.get("facing")),Collections.unmodifiableList(slots),fallback);if(fallback)replaced+=index
                }else pending++
            }
            result[request.owner]=NativeStaticEntityPlan(Collections.unmodifiableList(signs),Collections.unmodifiableList(fires),Collections.unmodifiableSet(replaced),pending,omitted)
        }
        checkpoint(cancelled);faces.keys.retainAll(used);return Collections.unmodifiableMap(result)
    }
    private fun texture(face:SignFace):NativePixelTexture=faces.getOrPut(face){
        val pixels=checkNotNull(rasterizer){"A native sign text rasterizer is required for nonempty sign faces"}.rasterize(face)
        require(pixels.width==128&&pixels.height==64&&pixels.srgb&&!pixels.mipmaps&&pixels.wrapS==1001&&pixels.wrapT==1001&&pixels.minFilter==1006&&pixels.magFilter==1006&&pixels.anisotropy==1f)
        pixels
    }
    fun append(target:NativePacketBuilder,plan:NativeStaticEntityPlan,origin:BlockPoint,placement:NativeStructurePlacement,cancelled:()->Boolean={false}) {
        checkpoint(cancelled);val parent=placement.parent(origin)
        fun matrix(v:RenderVoxel,yaw:Double=0.0,dx:Double=0.0,dy:Double=0.0,dz:Double=0.0,scale:Double=1.0):BlockTransform {
            val local=BlockTransform.translation((v.x-origin.x)+dx,(v.y-origin.y)+dy,(v.z-origin.z)+dz)*BlockTransform.rotationY(yaw)
            return parent*if(scale==1.0)local else local*BlockTransform.fromElements(doubleArrayOf(scale,0.0,0.0,0.0,0.0,scale,0.0,0.0,0.0,0.0,scale,0.0,0.0,0.0,0.0,1.0))
        }
        fun rows(transforms:List<BlockTransform>)=FloatBuffer.wrap(FloatArray(transforms.size*16){i->transforms[i/16][i%16].toFloat().also{require(it.isFinite())}})
        for((mounting,signs)in plan.signs.filter{it.fallback}.groupBy{it.mounting}){
            checkpoint(cancelled);target.add(bodies.getValue(mounting),woodMaterial,rows(signs.map{matrix(it.voxel,it.yaw)}))}
        val fallback=plan.campfires.filter{it.fallback}
        if(fallback.isNotEmpty()){
            target.add(logs,logMaterial,rows(fallback.map{matrix(it.voxel,it.yaw)}))
            target.add(coal,coalMaterial,rows(fallback.map{matrix(it.voxel,dy=-.3)}),castShadow=false)
            for((id,color)in listOf("minecraft:campfire" to 0xe97532,"minecraft:soul_campfire" to 0x5bc2d2)){
                val lit=fallback.filter{it.voxel.sourceBlockId==id&&it.voxel.sourceBlockState?.get("lit")!="false"};if(lit.isEmpty())continue
                val rgb=LinearRgb.fromSrgb(color);val material=NativeRenderMaterial(color=rgb,roughness=.76f,emission=rgb,emissionStrength=if(id.endsWith(":soul_campfire")) .55f else .32f)
                target.add(fire,material,rows(lit.map{matrix(it.voxel,dy=-.14)}),castShadow=false,receiveShadow=false)
            }
        }
        for(sign in plan.signs){checkpoint(cancelled)
            for((back,face)in listOf(false to sign.front,true to sign.back)){if(face==null)continue
                val material=NativeRenderMaterial(texture=texture(face),unlit=true,side=NativeFaceSide.DOUBLE,flipY=true,toneMapped=false)
                target.add(faceGeometry.getValue(sign.mounting to back),material,rows(listOf(matrix(sign.voxel,sign.yaw))),castShadow=false,receiveShadow=false,priority=5)
            }
        }
        val transforms=ArrayList<BlockTransform>();val colors=ArrayList<Float>()
        for(display in plan.campfires)for(marker in display.markers){checkpoint(cancelled);val color=marker.appearance.color()
            repeat(marker.tokens){stack->transforms+=matrix(display.voxel,marker.appearance.yaw,marker.x,marker.y+stack*.045,marker.z,.2*marker.appearance.scale)
                colors.addAll(listOf(color.red,color.green,color.blue,1f))}}
        if(transforms.isNotEmpty())target.add(token,itemMaterial,rows(transforms),FloatBuffer.wrap(colors.toFloatArray()))
        checkpoint(cancelled)
    }
    fun clear(){faces.clear()}
}
