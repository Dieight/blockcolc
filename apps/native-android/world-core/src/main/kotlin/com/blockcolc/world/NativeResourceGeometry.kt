package com.blockcolc.world

import com.blockcolc.world.generation.*
import com.blockcolc.world.resource.*
import java.nio.FloatBuffer
import java.nio.IntBuffer
import java.util.Collections
import java.util.concurrent.CancellationException
import kotlin.math.*

sealed interface NativeResourceModelResult{
    data class Fallback(val reason:String):NativeResourceModelResult
    class Model internal constructor(parts:List<NativeResourceModelPart>):NativeResourceModelResult{
        val parts:List<NativeResourceModelPart> = Collections.unmodifiableList(parts.toList())
    }
}
class NativeResourceModelPart internal constructor(val page:Int,val alphaMode:String,val geometry:BlockGeometry,resources:Set<String>){
    val resources:Set<String> = Collections.unmodifiableSet(LinkedHashSet(resources))
}

/** Compiles actual mapped Java model faces. Geometry is rebased around one
 * block, independently reusable by all instances of that appearance. */
object NativeResourceGeometry{
    private val faces=BlockFacing.entries
    private data class Reference(val element:ResourceMappedElement,val face:BlockFacing,val mapped:ResourceMappedFace,val tint:Int)
    fun compile(blockId:String,state:Map<String,String>,mapped:ResourceAtlasResolution,atlas:ResourceTextureAtlas,
        palette:ResourceBiomePalette=ResourceBiomePalette(),cancelled:()->Boolean={false}):NativeResourceModelResult{
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Resource geometry superseded")}
        checkpoint()
        if(mapped is ResourceAtlasFallback)return NativeResourceModelResult.Fallback(mapped.reason)
        require(mapped is ResourceAtlasGeometry)
        if(mapped.elements.isEmpty())return NativeResourceModelResult.Fallback("EMPTY_GEOMETRY")
        val references=ArrayList<Reference>()
        for(element in mapped.elements){checkpoint();for(face in faces){
            val r=element.faces[face.key]?:continue;val e=element.source
            require(atlas.entry(r.entry.resourceId)===r.entry){"Mapped geometry belongs to another atlas"}
            if(!hasArea(e.from,e.to,face))continue
            val kind=ResourceBiomePalette.tintKind(blockId,r.metadata.tintIndex)?:return NativeResourceModelResult.Fallback("UNRESOLVED_TINT")
            references+=Reference(element,face,r,kind)
        }}
        if(references.isEmpty())return NativeResourceModelResult.Fallback("EMPTY_GEOMETRY")
        val stateTint=ResourceBiomePalette.stateTint(blockId,state)
        if(references.any{it.tint in 8..10}&&stateTint==null)return NativeResourceModelResult.Fallback("INVALID_STATE_TINT")
        val output=ArrayList<NativeResourceModelPart>()
        for((page,rows)in references.groupBy{it.mapped.entry.page}.toSortedMap()){
            val slots=LinkedHashSet<Pair<Int,Int>>();val group=ArrayList<Reference>()
            fun flush(){if(group.isEmpty())return;checkpoint();output+=build(page,group,atlas,palette,stateTint);slots.clear();group.clear()}
            for(row in rows){val key=row.mapped.entry.pageTextureIndex to row.tint;if(key !in slots&&slots.size==6)flush();slots+=key;group+=row}
            flush()
        }
        checkpoint();return NativeResourceModelResult.Model(output)
    }
    private fun hasArea(a:ResourceVector3,b:ResourceVector3,f:BlockFacing)=when(f){
        BlockFacing.DOWN,BlockFacing.UP->a.x!=b.x&&a.z!=b.z
        BlockFacing.NORTH,BlockFacing.SOUTH->a.x!=b.x&&a.y!=b.y
        else->a.y!=b.y&&a.z!=b.z
    }
    private fun build(page:Int,rows:List<Reference>,atlas:ResourceTextureAtlas,palette:ResourceBiomePalette,stateTint:Int?):NativeResourceModelPart{
        val count=rows.size*4;val positions=FloatArray(count*3);val normals=FloatArray(count*3);val uv=FloatArray(count*2)
        val colors=FloatArray(count*3);val alpha=FloatArray(count);val indices=IntArray(rows.size*6)
        var mode="opaque";val resources=LinkedHashSet<String>();val pageInfo=atlas.pages.first{it.index==page}
        fun rank(m:String)=when(m){"translucent"->2;"cutout"->1;else->0}
        for((q,row)in rows.withIndex()){
            val e=row.element.source;val raw=positions(row.face,e.from,e.to);val final=raw.map{transformPoint(it,e)}
            val target=rotateFace(row.face,e.blockRotation)
            val shade=shade(e.shadeDirectionOverride?.let{key->faces.first{it.key==key}}?:if(e.shade)closest(final)?:target else BlockFacing.UP).toFloat().toDouble()
            val normal=transformNormal(winding(raw,row.face),e)
            val rgb=linear(palette.color(row.tint,stateTint));val metadata=row.mapped.metadata;val entry=row.mapped.entry
            for(v in 0..3){val at=q*4+v;val p=final[v]
                repeat(3){axis->positions[at*3+axis]=((p[axis]/16-.5)*.97).toFloat();normals[at*3+axis]=normal[axis].toFloat();colors[at*3+axis]=(rgb[axis]*shade).toFloat()}
                alpha[at]=target.ordinal.toFloat()
                var local=localUv(row.face,raw[v],e.from,e.to)
                local=when(metadata.rotation){90->doubleArrayOf(local[1],1-local[0]);180->doubleArrayOf(1-local[0],1-local[1]);270->doubleArrayOf(1-local[1],local[0]);else->local}
                val starts=doubleArrayOf(metadata.uv.u0,metadata.uv.v0);val ends=doubleArrayOf(metadata.uv.u1,metadata.uv.v1)
                repeat(2){axis->val delta=ends[axis]-starts[axis];val absolute=abs(delta)
                    // createAtlasGeometry narrows local UV attributes before the atlas shader bakes them.
                    val localFloat=((starts[axis]+(if(delta<0)-1 else 1)*(min(.5,absolute*.5)+local[axis]*max(absolute-1,0.0)))/16).toFloat().toDouble()
                    uv[at*2+axis]=((if(axis==0)entry.x else entry.y).toDouble().plus(localFloat*entry.width).div(if(axis==0)pageInfo.width else pageInfo.height)).toFloat()
                }
            }
            val base=q*4;val pattern=intArrayOf(0,1,2,0,2,3);repeat(6){indices[q*6+it]=base+pattern[it]}
            if(rank(row.mapped.alphaMode)>rank(mode))mode=row.mapped.alphaMode
            resources+=entry.resourceId
        }
        return NativeResourceModelPart(page,mode,Geometry(positions,normals,uv,colors,alpha,indices),resources)
    }
    private fun linear(rgb:Int)=DoubleArray(3){axis->val c=((rgb shr ((2-axis)*8))and 255)/255.0
        if(c<.04045)c*.0773993808 else(c*.9478672986+.0521327014).pow(2.4)}
    private fun positions(face:BlockFacing,a:ResourceVector3,b:ResourceVector3):List<DoubleArray>{
        val x=a.x;val y=a.y;val z=a.z;val X=b.x;val Y=b.y;val Z=b.z
        fun p(x:Double,y:Double,z:Double)=doubleArrayOf(x,y,z)
        return when(face){
            BlockFacing.DOWN->listOf(p(x,y,z),p(X,y,z),p(X,y,Z),p(x,y,Z))
            BlockFacing.UP->listOf(p(x,Y,Z),p(X,Y,Z),p(X,Y,z),p(x,Y,z))
            BlockFacing.NORTH->listOf(p(X,y,z),p(x,y,z),p(x,Y,z),p(X,Y,z))
            BlockFacing.SOUTH->listOf(p(x,y,Z),p(X,y,Z),p(X,Y,Z),p(x,Y,Z))
            BlockFacing.WEST->listOf(p(x,y,Z),p(x,Y,Z),p(x,Y,z),p(x,y,z))
            BlockFacing.EAST->listOf(p(X,y,z),p(X,Y,z),p(X,Y,Z),p(X,y,Z))
        }
    }
    private fun localUv(face:BlockFacing,p:DoubleArray,a:ResourceVector3,b:ResourceVector3):DoubleArray{
        fun ratio(v:Double,lo:Double,hi:Double)=if(lo==hi)0.0 else(v-lo)/(hi-lo)
        val x=ratio(p[0],a.x,b.x);val y=ratio(p[1],a.y,b.y);val z=ratio(p[2],a.z,b.z)
        return when(face){BlockFacing.DOWN->doubleArrayOf(x,1-z);BlockFacing.UP->doubleArrayOf(x,z);BlockFacing.NORTH->doubleArrayOf(1-x,1-y)
            BlockFacing.SOUTH->doubleArrayOf(x,1-y);BlockFacing.WEST->doubleArrayOf(z,1-y);BlockFacing.EAST->doubleArrayOf(1-z,1-y)}
    }
    private fun axis(p:DoubleArray,axis:String,angle:Double):DoubleArray{
        val c=cos(angle*PI/180);val s=sin(angle*PI/180);val x=p[0];val y=p[1];val z=p[2]
        return when(axis){"x"->doubleArrayOf(x,y*c-z*s,y*s+z*c);"y"->doubleArrayOf(x*c+z*s,y,-x*s+z*c);else->doubleArrayOf(x*c-y*s,x*s+y*c,z)}
    }
    private fun localRotate(p:DoubleArray,r:ResourceElementRotation):DoubleArray=when(r){
        is ResourceElementRotation.Axis->axis(p,r.axis,r.angle)
        is ResourceElementRotation.Euler->axis(axis(axis(p,"x",r.angles.x),"y",r.angles.y),"z",r.angles.z)
    }
    private fun blockRotate(p:DoubleArray,r:Pair<Int,Int>?):DoubleArray{
        if(r==null)return p;var result=p
        repeat(r.first/90){result=doubleArrayOf(result[0],result[2],-result[1])}
        repeat(r.second/90){result=doubleArrayOf(-result[2],result[1],result[0])};return result
    }
    private fun transformPoint(p:DoubleArray,e:ResourceBlockElement):DoubleArray{
        var result=p
        e.rotation?.let{r->val origin=doubleArrayOf(r.origin.x,r.origin.y,r.origin.z);var rel=DoubleArray(3){result[it]-origin[it]}
            if(r is ResourceElementRotation.Axis&&r.rescale){val factor=1/cos(abs(r.angle)*PI/180);rel=DoubleArray(3){i->rel[i]*if(i==when(r.axis){"x"->0;"y"->1;else->2})1.0 else factor}}
            rel=localRotate(rel,r);result=DoubleArray(3){rel[it]+origin[it]}}
        if(e.blockRotation!=null){val rotated=blockRotate(DoubleArray(3){result[it]-8},e.blockRotation);result=DoubleArray(3){rotated[it]+8}}
        return result
    }
    private fun transformNormal(p:DoubleArray,e:ResourceBlockElement):DoubleArray{
        val local=e.rotation?.let{localRotate(p,it)}?:p;val r=blockRotate(local,e.blockRotation);val len=hypot(hypot(r[0],r[1]),r[2])
        return if(len==0.0)p else DoubleArray(3){r[it]/len}
    }
    private fun cross(points:List<DoubleArray>):DoubleArray{val a=DoubleArray(3){points[1][it]-points[0][it]};val b=DoubleArray(3){points[2][it]-points[0][it]}
        return doubleArrayOf(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])}
    private fun winding(p:List<DoubleArray>,face:BlockFacing):DoubleArray{val c=cross(p);val len=hypot(hypot(c[0],c[1]),c[2]);return if(len==0.0)doubleArrayOf(face.dx.toDouble(),face.dy.toDouble(),face.dz.toDouble())else DoubleArray(3){c[it]/len}}
    private fun closest(p:List<DoubleArray>):BlockFacing?{val c=cross(p);val len=hypot(hypot(c[0],c[1]),c[2]);if(len==0.0||!len.isFinite())return null
        val n=DoubleArray(3){(c[it]/len).toFloat().toDouble()};var max=Double.NEGATIVE_INFINITY;var best:BlockFacing?=null
        for(f in faces){val d=n[0]*f.dx+n[1]*f.dy+n[2]*f.dz;if(d>max){max=d;best=f}};return best}
    private fun rotateFace(f:BlockFacing,r:Pair<Int,Int>?):BlockFacing{val n=blockRotate(doubleArrayOf(f.dx.toDouble(),f.dy.toDouble(),f.dz.toDouble()),r)
        return faces.first{it.dx.toDouble()==n[0]&&it.dy.toDouble()==n[1]&&it.dz.toDouble()==n[2]}}
    private fun shade(f:BlockFacing)=when(f){BlockFacing.DOWN->.5;BlockFacing.UP->1.0;BlockFacing.NORTH,BlockFacing.SOUTH->.8;else->.6}
    private class Geometry(private val p:FloatArray,private val n:FloatArray,private val uv:FloatArray,private val rgb:FloatArray,private val a:FloatArray,private val ix:IntArray):BlockGeometry{
        override val vertexCount=p.size/3
        override val byteSize=(p.size+n.size+uv.size+rgb.size+a.size+ix.size)*4L
        override val vertexPreparation="atlas-static-v1"
        override val bounds:BlockBox=BlockBox(BlockPoint((p.indices step 3).minOf{p[it]}.toDouble(),(1 until p.size step 3).minOf{p[it]}.toDouble(),(2 until p.size step 3).minOf{p[it]}.toDouble()),
            BlockPoint((p.indices step 3).maxOf{p[it]}.toDouble(),(1 until p.size step 3).maxOf{p[it]}.toDouble(),(2 until p.size step 3).maxOf{p[it]}.toDouble()))
        override fun positions()=FloatBuffer.wrap(p).asReadOnlyBuffer()
        override fun normals()=FloatBuffer.wrap(n).asReadOnlyBuffer()
        override fun textureCoordinates()=FloatBuffer.wrap(uv).asReadOnlyBuffer()
        override fun colors()=FloatBuffer.wrap(rgb).asReadOnlyBuffer()
        override fun colorAlpha()=FloatBuffer.wrap(a).asReadOnlyBuffer()
        override fun indices()=IntBuffer.wrap(ix).asReadOnlyBuffer()
    }
}
