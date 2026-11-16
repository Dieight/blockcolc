package com.blockcolc.world

import com.blockcolc.world.resource.*
import java.nio.ByteBuffer
import java.util.Collections

/** Frozen scheduling facts. Each renderer adoption gets its own mutable timeline. */
class NativeAtlasSchedule internal constructor(val identity:String,val texture:Int,val blendTexture:Int,val width:Int,val height:Int,val tileCount:Int,
    sequences:List<AtlasSequence>,active:Set<Int>,val initialFramesSha256:String,val initialBlendSha256:String){
    val sequences:List<AtlasSequence> = Collections.unmodifiableList(sequences.map{it.copy(frames=Collections.unmodifiableList(it.frames.toList()))})
    val active:Set<Int> = Collections.unmodifiableSet(LinkedHashSet(active))
    fun timeline()=AtlasTimeline(identity,texture,blendTexture,width,height,tileCount,sequences,active)
}
class NativeAtlasPageBinding internal constructor(val page:ResourceAtlasPage,val color:NativePixelTexture,val gutter:Int,val owner:String,
    private val sequences:List<AtlasSequence>,private val active:Set<Int>,val identity:String,val tileCount:Int,val lookupWidth:Int,val lookupHeight:Int){
    val animated=active.isNotEmpty()
    val key=identity+":"+AtlasTimeline.hash(active.sorted().joinToString(",").toByteArray(Charsets.UTF_8))
    val frames:NativePixelTexture?
    val blends:NativePixelTexture?
    init{
        require(PacketOwners.valid(owner))
        val timeline=if(animated)AtlasTimeline(identity,0,1,lookupWidth,lookupHeight,tileCount,sequences,active)else null
        frames=timeline?.let{NativePixelTexture(it.width,it.height,ByteBuffer.wrap(it.pixels),srgb=false,mipmaps=false,wrapS=1001,wrapT=1001,minFilter=1003,magFilter=1003,anisotropy=1f,dynamicIdentity="$owner:$key:frames")}
        blends=timeline?.let{NativePixelTexture(it.width,it.height,ByteBuffer.wrap(it.blendPixels),srgb=false,mipmaps=false,wrapS=1001,wrapT=1001,minFilter=1003,magFilter=1003,anisotropy=1f,dynamicIdentity="$owner:$key:blend")}
    }
    fun source(colorId:Int,framesId:Int?,blendId:Int?)=SourceAtlas(true,listOf(page.width.toFloat(),page.height.toFloat()),page.columns.toFloat(),(page.textureSize+gutter*2).toFloat(),
        framesId?:colorId,blendId?:colorId,if(animated)listOf(lookupWidth.toFloat(),lookupHeight.toFloat())else listOf(1f,1f),animated)
    fun schedule(framesId:Int,blendId:Int):NativeAtlasSchedule{
        require(animated&&framesId!=blendId);return NativeAtlasSchedule(identity,framesId,blendId,lookupWidth,lookupHeight,tileCount,sequences,active,checkNotNull(frames).sha256,checkNotNull(blends).sha256)
    }
}

/** Shared immutable colour pages; tiny animation tables are scoped to each world owner. */
class NativeAtlasTextures private constructor(val atlas:ResourceTextureAtlas,private val colors:Map<Int,NativePixelTexture>,val estimatedPeakBytes:Long){
    fun forOwner(owner:String,activeResourceIds:Set<String>?=null):Map<Int,NativeAtlasPageBinding>{
        require(PacketOwners.valid(owner));val bindings=linkedMapOf<Int,NativeAtlasPageBinding>()
        for(page in atlas.pages){val entries=atlas.entries.filter{it.page==page.index}
            val sequences=entries.mapNotNull{entry->entry.animation?.takeIf{it.frames.size>=2&&it.frames.all{f->f.page==page.index}}?.let{a->
                AtlasSequence(entry.pageTextureIndex,a.totalTicks,a.interpolate,a.frames.map{AtlasFrame(it.pageTextureIndex,it.time.toLong())})}}
            val active=entries.filter{(activeResourceIds==null||it.resourceId in activeResourceIds)&&it.animation?.frames?.size?.let{n->n>=2}==true}.map{it.pageTextureIndex}.toSet()
            val count=(entries.map{it.pageTextureIndex}+sequences.flatMap{s->s.frames.map{it.index}}).maxOrNull()?.plus(1)?:1
            require(count in 1..65536);val width=minOf(2048,count);val height=(count+width-1)/width
            val code="${page.index}/$width/$height/$count;"+sequences.joinToString(";"){s->"${s.index}:${s.total}:${if(s.interpolate)1 else 0}:"+s.frames.joinToString("/"){"${it.index},${it.ticks}"}}
            val identity=AtlasTimeline.hash(code.toByteArray(Charsets.UTF_8))
            bindings[page.index]=NativeAtlasPageBinding(page,colors.getValue(page.index),atlas.gutter,owner,sequences,active,identity,count,width,height)
        };return Collections.unmodifiableMap(bindings)
    }
    companion object{
        fun prepare(atlas:ResourceTextureAtlas,cancelled:()->Boolean={false}):NativeAtlasTextures{
            // NativePixelTexture owns a frozen copy and Filament uploads through direct buffers.
            // Reserve these additional copies as well as the formal atlas admission estimate.
            val memory=atlas.memoryEstimate
            val extra=2*(memory.getValue("pageRgbaBytes")+memory.getValue("mipmapRgbaBytes")+memory.getValue("animationLookupRgbaBytes"))
            val peak=memory.getValue("estimatedPeakBytes")+extra
            if(atlas.pages.isNotEmpty()&&peak>memory.getValue("limitBytes"))throw ResourceAtlasException("ATLAS_TOO_LARGE")
            val colors=linkedMapOf<Int,NativePixelTexture>()
            for(page in atlas.pages){checkCancelled(cancelled);var w=page.width;var h=page.height;var pixels=page.pixels();val levels=ArrayList<NativePixelLevel>()
                val count=minOf(atlas.safeMipLevels,31-Integer.numberOfLeadingZeros(minOf(w,h)))
                repeat(count){val nw=maxOf(1,w/2);val nh=maxOf(1,h/2);val next=ByteArray(nw*nh*4)
                    for(y in 0 until nh){checkCancelled(cancelled);for(x in 0 until nw){
                        var alpha=0;var red=0;var green=0;var blue=0
                        for(dy in 0..1)for(dx in 0..1){val sample=(minOf(h-1,y*2+dy)*w+minOf(w-1,x*2+dx))*4;val a=pixels.get(sample+3).toInt()and 255;alpha+=a
                            red+=(pixels.get(sample).toInt()and 255)*a;green+=(pixels.get(sample+1).toInt()and 255)*a;blue+=(pixels.get(sample+2).toInt()and 255)*a}
                        val target=(y*nw+x)*4;next[target+3]=((alpha+2)/4).toByte()
                        if(alpha>0){next[target]=kotlin.math.floor(red.toDouble()/alpha+.5).toInt().toByte();next[target+1]=kotlin.math.floor(green.toDouble()/alpha+.5).toInt().toByte();next[target+2]=kotlin.math.floor(blue.toDouble()/alpha+.5).toInt().toByte()}
                    }}
                    levels+=NativePixelLevel(nw,nh,ByteBuffer.wrap(next));pixels=ByteBuffer.wrap(next);w=nw;h=nh
                }
                colors[page.index]=NativePixelTexture(page.width,page.height,page.pixels(),wrapS=1001,wrapT=1001,minFilter=1008,magFilter=1003,manualMipmaps=levels)
            };checkCancelled(cancelled);return NativeAtlasTextures(atlas,Collections.unmodifiableMap(colors),peak)
        }
        private fun checkCancelled(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw java.util.concurrent.CancellationException("Atlas texture preparation superseded")}
    }
}
