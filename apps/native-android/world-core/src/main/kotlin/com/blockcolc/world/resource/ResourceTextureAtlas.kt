package com.blockcolc.world.resource

import org.json.JSONObject
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import kotlin.math.ceil
import kotlin.math.sqrt

data class ResourceAtlasLimits(val maxTextures:Int=4096,val maxPageSize:Int=2048,val maxPages:Int=4,val gutter:Int=2,
    val maxPngBytes:Int=4194304,val maxSourcePixelsPerTexture:Int=1048576,val maxDecodedBytes:Long=134217728,
    val reservedAtlasBytes:Long=0,val additionalWorkingSetBytes:Long=0)
class ResourceAtlasException(val code:String,val resourceId:String?=null):IllegalArgumentException("$code${resourceId?.let{": $it"}?:""}")
data class ResourceAtlasUv(val u0:Double,val v0:Double,val u1:Double,val v1:Double){
    fun json()=JSONObject().put("u0",u0).put("v0",v0).put("u1",u1).put("v1",v1)
}
class ResourceAtlasFrame internal constructor(val textureIndex:Int,val page:Int,val pageTextureIndex:Int,val uv:ResourceAtlasUv,val time:Int){
    fun json()=JSONObject().put("textureIndex",textureIndex).put("page",page).put("pageTextureIndex",pageTextureIndex).put("uv",uv.json()).put("time",time)
}
class ResourceAtlasAnimation internal constructor(val interpolate:Boolean,frames:List<ResourceAtlasFrame>){
    val frames=resourceList(frames);val totalTicks=frames.sumOf{it.time.toLong()}
    fun json()=JSONObject().put("interpolate",interpolate).put("totalTicks",totalTicks).put("frames",jsonArray(frames.map{it.json()}))
}
class ResourceAtlasEntry internal constructor(val resourceId:String,val index:Int,val page:Int,val pageTextureIndex:Int,val x:Int,val y:Int,
    val width:Int,val uv:ResourceAtlasUv,val alphaMode:String,val animation:ResourceAtlasAnimation?){
    val height get()=width
    fun json()=JSONObject().put("resourceId",resourceId).put("index",index).put("page",page).put("pageTextureIndex",pageTextureIndex)
        .put("x",x).put("y",y).put("width",width).put("height",height).put("uv",uv.json()).put("alphaMode",alphaMode).also{if(animation!=null)it.put("animation",animation.json())}
}
class ResourceAtlasPage internal constructor(val index:Int,val textureSize:Int,val width:Int,val height:Int,val columns:Int,val rows:Int,private val data:ByteArray){
    val sha256=MessageDigest.getInstance("SHA-256").digest(data).joinToString(""){"%02x".format(it.toInt()and 255)}
    fun pixels():ByteBuffer=ByteBuffer.wrap(data).asReadOnlyBuffer()
    fun json()=JSONObject().put("index",index).put("textureSize",textureSize).put("width",width).put("height",height).put("columns",columns).put("rows",rows).put("rgbaSha256",sha256)
}
class ResourceTextureAtlas internal constructor(val textureSize:Int,val gutter:Int,val safeMipLevels:Int,pages:List<ResourceAtlasPage>,entries:List<ResourceAtlasEntry>,memory:Map<String,Long>){
    val pages=resourceList(pages);val entries=resourceList(entries);val memoryEstimate=resourceMap(memory)
    private val byId=this.entries.associateBy{it.resourceId}
    fun entry(resourceId:String)=byId[resourceId]
    fun json()=JSONObject().put("schemaVersion",1).put("textureSize",textureSize).put("gutter",gutter).put("safeMipLevels",safeMipLevels)
        .put("pages",jsonArray(pages.map{it.json()})).put("entries",jsonArray(entries.map{it.json()})).put("memoryEstimate",jsonMap(memoryEstimate))
}

/** Native-resolution pages, whole animation strips on one page, and conservative pre-allocation admission. */
object NativeResourceAtlas {
    private data class Layout(val width:Int,val columns:Int,val rows:Int){val count get()=columns*rows}
    private class Plan(val texture:ResourceOwnedTexture,val layout:Layout){
        val frames=arrayOfNulls<Tile>(layout.count);var alpha="opaque"
    }
    private class Tile(val plan:Plan,val sourceFrame:Int,val localIndex:Int){var globalIndex=0;var x=0;var y=0;var uv:ResourceAtlasUv?=null;var page=0}
    private class Page(val index:Int,val size:Int,val cell:Int,val columns:Int,val rows:Int,val width:Int,val height:Int,
        val tiles:List<Tile>,val plans:List<Plan>,val mipBytes:Long,val lookupBytes:Long){val rgbaBytes=width.toLong()*height*4}
    private fun fail(code:String,id:String?=null):Nothing=throw ResourceAtlasException(code,id)
    private fun validate(l:ResourceAtlasLimits){
        if(listOf(l.maxTextures,l.maxPageSize,l.maxPages,l.gutter,l.maxPngBytes,l.maxSourcePixelsPerTexture).any{it<=0}||l.maxDecodedBytes<=0||l.reservedAtlasBytes<0||l.additionalWorkingSetBytes<0||
            listOf(l.maxDecodedBytes,l.reservedAtlasBytes,l.additionalWorkingSetBytes).any{it>9007199254740991L}||l.maxPageSize>4096||l.gutter>16)fail("INVALID_LIMITS")
    }
    private fun safeMips(gutter:Int)=32-Integer.numberOfLeadingZeros(gutter)
    private fun power(value:Int):Int{var out=1;while(out<value)out*=2;return out}
    private fun memory(l:ResourceAtlasLimits,png:Long=0,source:Long=0,decoder:Long=0,pages:Long=0,mips:Long=0,lookup:Long=0):Map<String,Long>{
        val gpu=pages+mips+lookup;val peak=l.reservedAtlasBytes+l.additionalWorkingSetBytes+png+gpu*2+decoder
        if(peak<0||peak>9007199254740991L)fail("ATLAS_TOO_LARGE")
        return linkedMapOf("limitBytes" to l.maxDecodedBytes,"reservedAtlasBytes" to l.reservedAtlasBytes,"additionalWorkingSetBytes" to l.additionalWorkingSetBytes,
            "sourcePngBytes" to png,"sourceRgbaBytes" to source,"decoderWorkingSetBytes" to decoder,"normalizationBytes" to 0L,
            "pageRgbaBytes" to pages,"mipmapRgbaBytes" to mips,"animationLookupRgbaBytes" to lookup,"estimatedGpuBytes" to gpu,"estimatedPeakBytes" to peak).mapValues{it.value.toLong()}
    }
    private fun layout(texture:ResourceTextureDescriptor):Layout{
        val a=texture.animation
        if(a==null){if(texture.width !in listOf(16,32,64,128,256)||texture.height!=texture.width)fail("INVALID_ANIMATION",texture.resourceId);return Layout(texture.width,1,1)}
        if(a.frameWidth !in listOf(16,32,64,128,256)||a.frameHeight!=a.frameWidth||a.sourceColumns<1||a.sourceRows<1||a.sourceColumns*a.frameWidth!=texture.width||a.sourceRows*a.frameHeight!=texture.height||a.sourceFrameCount !in 1..256||a.frames.isEmpty())fail("INVALID_ANIMATION",texture.resourceId)
        return Layout(a.frameWidth,a.sourceColumns,a.sourceRows)
    }
    private fun pages(plans:List<Plan>,l:ResourceAtlasLimits,cancelled:()->Boolean):List<Page>{
        val output=ArrayList<Page>()
        for(size in plans.map{it.layout.width}.distinct().sorted()){
            checkpoint(cancelled);val cell=size+l.gutter*2;val perAxis=l.maxPageSize/cell;if(perAxis<1)fail("INVALID_LIMITS")
            val capacity=perAxis*perAxis;var tiles=ArrayList<Tile>()
            fun flush(){
                if(tiles.isEmpty())return
                val columns=minOf(perAxis,ceil(sqrt(tiles.size.toDouble())).toInt());val rows=(tiles.size+columns-1)/columns;val width=power(columns*cell);val height=power(rows*cell)
                if(width>l.maxPageSize||height>l.maxPageSize)fail("ATLAS_TOO_LARGE")
                val textures=tiles.map{it.plan}.distinct();var lookup=0L
                if(textures.any{(it.texture.descriptor.animation?.frames?.size?:0)>1}){
                    var greatest=-1
                    for(p in textures){val a=p.texture.descriptor.animation;val referenced=if(a!=null&&a.frames.size>1)a.frames.map{it.index}else listOf(a?.frames?.firstOrNull()?.index?:0)
                        for(source in referenced){val index=tiles.find{it.plan===p&&it.sourceFrame==source}?.localIndex;if(index!=null)greatest=maxOf(greatest,index)}}
                    val count=greatest+1;if(count>0){val w=minOf(l.maxPageSize,count);lookup=w.toLong()*((count+w-1)/w)*8}
                }
                var mw=width;var mh=height;var mipBytes=0L;val levels=minOf(safeMips(l.gutter),31-Integer.numberOfLeadingZeros(minOf(width,height)))
                repeat(levels){mw=maxOf(1,mw/2);mh=maxOf(1,mh/2);mipBytes+=mw.toLong()*mh*4}
                output+=Page(output.size,size,cell,columns,rows,width,height,tiles,textures,mipBytes,lookup);tiles=ArrayList()
            }
            for(plan in plans)if(plan.layout.width==size){checkpoint(cancelled);if(plan.layout.count>capacity)fail("ATLAS_TOO_LARGE",plan.texture.resourceId)
                if(tiles.isNotEmpty()&&tiles.size+plan.layout.count>capacity)flush()
                repeat(plan.layout.count){tiles+=Tile(plan,it,tiles.size)}
            };flush()
        };return output
    }
    fun build(stack:ResourcePackStack,selectedIds:Set<String>?=null,limits:ResourceAtlasLimits=ResourceAtlasLimits(),cancelled:()->Boolean={false}):ResourceTextureAtlas{
        val selected=if(selectedIds==null)stack.textures.values.toList()else selectedIds.map{checkNotNull(stack.textures[it]){"Missing selected texture $it"}}
        return buildTextures(selected,limits,cancelled)
    }
    fun buildTextures(textures:Collection<ResourceOwnedTexture>,limits:ResourceAtlasLimits=ResourceAtlasLimits(),cancelled:()->Boolean={false}):ResourceTextureAtlas{
        validate(limits);checkpoint(cancelled);if(textures.size>limits.maxTextures)fail("TOO_MANY_TEXTURES")
        val sorted=textures.sortedBy{it.resourceId};val ids=HashSet<String>();for(t in sorted)if(!ids.add(t.resourceId))fail("DUPLICATE_TEXTURE_ID",t.resourceId)
        if(sorted.isEmpty())return ResourceTextureAtlas(16,limits.gutter,safeMips(limits.gutter),emptyList(),emptyList(),memory(limits))
        val plans=ArrayList<Plan>();var tiles=0L;var sourcePngBytes=0L;var sourceRgbaBytes=0L;var decoder=0L
        for(texture in sorted){checkpoint(cancelled);val d=texture.descriptor;val bytes=texture.source.archive.read(d.archivePath,cancelled)
            if(bytes.isEmpty()||bytes.size>limits.maxPngBytes)fail("INVALID_PNG_PIXELS",texture.resourceId)
            val dimensions=ResourcePng.inspect(bytes)?:fail("INVALID_PNG_PIXELS",texture.resourceId)
            if(dimensions.width!=d.width.toLong()||dimensions.height!=d.height.toLong())fail("INVALID_PNG_PIXELS",texture.resourceId)
            val pixels=dimensions.width*dimensions.height
            if(dimensions.width>4096||dimensions.height>4096||pixels>limits.maxSourcePixelsPerTexture)fail("ATLAS_TOO_LARGE",texture.resourceId)
            val layout=layout(d);tiles+=layout.count;if(tiles>limits.maxTextures)fail("TOO_MANY_TEXTURES")
            sourcePngBytes+=bytes.size;sourceRgbaBytes+=pixels*4
            // Keep the formal parser's conservative estimate although this decoder uses two row buffers.
            decoder=maxOf(decoder,bytes.size*3L+pixels*12+dimensions.height)
            plans+=Plan(texture,layout)
        }
        val pagePlans=pages(plans,limits,cancelled);if(pagePlans.size>limits.maxPages)fail("TOO_MANY_PAGES")
        val memory=memory(limits,sourcePngBytes,sourceRgbaBytes,decoder,pagePlans.sumOf{it.rgbaBytes},pagePlans.sumOf{it.mipBytes},pagePlans.sumOf{it.lookupBytes})
        if(memory.getValue("estimatedPeakBytes")>limits.maxDecodedBytes)fail("ATLAS_TOO_LARGE")
        val output=ArrayList<ResourceAtlasPage>();var nextGlobal=0
        for(page in pagePlans){checkpoint(cancelled);val rgba=ByteArray(page.rgbaBytes.toInt())
            for(plan in page.plans){checkpoint(cancelled);val d=plan.texture.descriptor
                val image=try{ResourcePng.decode(plan.texture.source.archive.read(d.archivePath,cancelled),
                    ResourcePngLimits(4096,4096,limits.maxSourcePixelsPerTexture,minOf(Int.MAX_VALUE.toLong(),limits.maxSourcePixelsPerTexture*4L).toInt()),d.width,d.height,cancelled)}
                    catch(e:CancellationException){throw e}catch(_:Exception){fail("INVALID_PNG_PIXELS",d.resourceId)}
                val pixels=image.rgba();var transparent=false;var translucent=false
                for(at in 3 until pixels.remaining() step 4){if(at%65536==3)checkpoint(cancelled);val a=pixels.get(at).toInt()and 255;if(a in 1..254){translucent=true;break};if(a==0)transparent=true}
                plan.alpha=if(translucent)"translucent"else if(transparent)"cutout"else "opaque"
                for(tile in page.tiles)if(tile.plan===plan){checkpoint(cancelled);val x=tile.localIndex%page.columns*page.cell+limits.gutter;val y=tile.localIndex/page.columns*page.cell+limits.gutter
                    val startX=tile.sourceFrame%plan.layout.columns*plan.layout.width;val startY=tile.sourceFrame/plan.layout.columns*plan.layout.width
                    for(dy in -limits.gutter until plan.layout.width+limits.gutter){checkpoint(cancelled)
                        for(dx in -limits.gutter until plan.layout.width+limits.gutter){val source=((startY+dy.coerceIn(0,plan.layout.width-1))*d.width+startX+dx.coerceIn(0,plan.layout.width-1))*4
                            val target=((y+dy)*page.width+x+dx)*4;repeat(4){rgba[target+it]=pixels.get(source+it)}}}
                    tile.globalIndex=nextGlobal++;tile.x=x;tile.y=y;tile.page=page.index;tile.uv=ResourceAtlasUv(x.toDouble()/page.width,y.toDouble()/page.height,(x+page.size).toDouble()/page.width,(y+page.size).toDouble()/page.height)
                    plan.frames[tile.sourceFrame]=tile
                }
            }
            output+=ResourceAtlasPage(page.index,page.size,page.width,page.height,page.columns,page.rows,rgba)
        }
        val entries=plans.map{plan->val d=plan.texture.descriptor;val playback=d.animation?.frames?:listOf(ResourceAnimationFrame(0,1))
            val frames=playback.map{f->val tile=plan.frames[f.index]?:fail("INVALID_ANIMATION",d.resourceId);ResourceAtlasFrame(tile.globalIndex,tile.page,tile.localIndex,tile.uv!!,f.time)}
            val first=plan.frames[playback.first().index]!!;ResourceAtlasEntry(d.resourceId,first.globalIndex,first.page,first.localIndex,first.x,first.y,plan.layout.width,first.uv!!,plan.alpha,
                if(d.animation==null)null else ResourceAtlasAnimation(d.animation.interpolate,frames))}
        checkpoint(cancelled);return ResourceTextureAtlas(plans.maxOf{it.layout.width}.coerceAtLeast(16),limits.gutter,safeMips(limits.gutter),output,entries,memory)
    }
}
