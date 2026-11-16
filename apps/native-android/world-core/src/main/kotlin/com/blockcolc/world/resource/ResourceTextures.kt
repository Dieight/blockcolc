package com.blockcolc.world.resource

import org.json.JSONArray
import org.json.JSONObject
import java.util.Collections
import java.util.concurrent.CancellationException

data class ResourceAnimationFrame(val index:Int,val time:Int)
class ResourceTextureAnimation internal constructor(val frameWidth:Int,val frameHeight:Int,val sourceColumns:Int,val sourceRows:Int,
    val frametime:Int,val interpolate:Boolean,frames:List<ResourceAnimationFrame>){
    val sourceFrameCount=sourceColumns*sourceRows
    val frames:List<ResourceAnimationFrame> = Collections.unmodifiableList(frames.toList())
    fun json()=JSONObject().put("frameWidth",frameWidth).put("frameHeight",frameHeight).put("sourceColumns",sourceColumns).put("sourceRows",sourceRows)
        .put("sourceFrameCount",sourceFrameCount).put("frametime",frametime).put("interpolate",interpolate)
        .put("frames",JSONArray().also{out->for(frame in frames)out.put(JSONObject().put("index",frame.index).put("time",frame.time))})
}
object ResourceAnimationParser{
    private fun integer(raw:Any?,low:Int,high:Int):Int{
        require(raw is Number);val v=raw.toDouble();require(v.isFinite()&&v%1.0==0.0&&v in low.toDouble()..high.toDouble());return v.toInt()
    }
    private fun nullable(row:JSONObject,key:String):Any?=row.opt(key).takeUnless{it==JSONObject.NULL}
    private fun size(raw:Any?):Int=integer(raw,16,256).also{require(it in listOf(16,32,64,128,256))}
    fun normalize(metadata:JSONObject?,sheetWidth:Int,sheetHeight:Int):ResourceTextureAnimation?{
        require(sheetWidth>0&&sheetHeight>0)
        if(metadata==null||!metadata.has("animation"))return null
        val raw=metadata.get("animation") as? JSONObject?:throw IllegalArgumentException("animation must be an object")
        val defaultSize=minOf(sheetWidth,sheetHeight)
        val width=size(nullable(raw,"width")?:nullable(raw,"height")?:defaultSize)
        val height=size(nullable(raw,"height")?:nullable(raw,"width")?:defaultSize)
        require(width==height&&sheetWidth%width==0&&sheetHeight%height==0)
        val columns=sheetWidth/width;val rows=sheetHeight/height;val count=columns.toLong()*rows;require(count in 1..256)
        val time=integer(nullable(raw,"frametime")?:1,1,1000000)
        val interpolate=if(raw.has("interpolate"))raw.get("interpolate").also{require(it is Boolean)} as Boolean else false
        val frames=if(!raw.has("frames"))List(count.toInt()){ResourceAnimationFrame(it,time)}else{
            val input=raw.get("frames") as? JSONArray?:throw IllegalArgumentException("animation.frames must be an array")
            require(input.length() in 1..4096)
            List(input.length()){i->when(val f=input.get(i)){
                is Number->ResourceAnimationFrame(integer(f,0,count.toInt()-1),time)
                is JSONObject->ResourceAnimationFrame(integer(f.opt("index"),0,count.toInt()-1),integer(nullable(f,"time")?:time,1,1000000))
                else->throw IllegalArgumentException("Invalid animation frame")
            }}
        }
        return ResourceTextureAnimation(width,height,columns,rows,time,interpolate,frames)
    }
}
data class ResourceAssetIssue(val path:String,val code:String)
class ResourceTextureDescriptor internal constructor(val resourceId:String,val namespace:String,val texturePath:String,val archivePath:String,
    val width:Int,val height:Int,val animation:ResourceTextureAnimation?,private val metadataJson:String?){
    fun json()=JSONObject().put("resourceId",resourceId).put("namespace",namespace).put("texturePath",texturePath).put("archivePath",archivePath).put("width",width).put("height",height).also{
        animation?.let{a->it.put("animation",a.json())};metadataJson?.let{m->it.put("metadata",ResourceJson.objectValue(m.toByteArray(Charsets.UTF_8)))}
    }
}
class ResourceTextureCatalog internal constructor(val archiveSha256:String,textures:List<ResourceTextureDescriptor>,issues:List<ResourceAssetIssue>,val candidates:Int){
    val textures:List<ResourceTextureDescriptor> = Collections.unmodifiableList(textures.toList())
    val issues:List<ResourceAssetIssue> = Collections.unmodifiableList(issues.toList())
    private val byId=this.textures.associateBy{it.resourceId}
    fun find(id:String):ResourceTextureDescriptor?=byId[id]
    fun decode(archive:NativeResourceArchive,id:String,cancelled:()->Boolean={false}):ResourcePngImage{
        require(archive.inputSha256==archiveSha256){"Texture belongs to a different resource archive"}
        val texture=checkNotNull(byId[id]);return ResourcePng.decode(archive.read(texture.archivePath,cancelled),expectedWidth=texture.width,expectedHeight=texture.height,cancelled=cancelled)
    }
}
/** Indexing checks image structure and animation metadata but does not retain
 * PNGs or decoded sheets. The later atlas producer decodes only used entries. */
object NativeResourceTextures{
    private val texturePath=Regex("^assets/([^/]+)/textures/block/(.+)\\.png$")
    private val metadataPath=Regex("^assets/([^/]+)/textures/block/(.+)\\.png\\.mcmeta$")
    private val namespace=Regex("[a-z0-9_.-]+")
    private val resourcePath=Regex("[a-z0-9._/-]+")
    fun prepare(archive:NativeResourceArchive,cancelled:()->Boolean={false}):ResourceTextureCatalog{
        val candidates=archive.paths.filter{texturePath.matches(it)};val metadata=archive.paths.filter{metadataPath.matches(it)}.toSet();val consumed=HashSet<String>()
        val textures=ArrayList<ResourceTextureDescriptor>();val issues=ArrayList<ResourceAssetIssue>()
        fun issue(path:String,code:String){issues+=ResourceAssetIssue(path,code)}
        for(path in candidates){checkpoint(cancelled);val match=texturePath.matchEntire(path)!!;val ns=match.groupValues[1];val name=match.groupValues[2]
            if(!namespace.matches(ns)){issue(path,"INVALID_NAMESPACE");continue}
            if(!resourcePath.matches(name)||name.startsWith('/')||name.endsWith('/')||name.split('/').any{it.isEmpty()||it=="."||it==".."}){issue(path,"INVALID_RESOURCE_PATH");continue}
            val png=archive.read(path,cancelled);val dimensions=ResourcePng.inspect(png,cancelled)
            if(dimensions==null){issue(path,"INVALID_PNG");continue}
            val sidecar="$path.mcmeta";var parsed:JSONObject?=null
            if(sidecar in metadata){consumed+=sidecar
                if(checkNotNull(archive.entry(sidecar)).bytes>65536){issue(sidecar,"INVALID_TEXTURE_MCMETA");continue}
                parsed=try{ResourceJson.objectValue(archive.read(sidecar,cancelled),cancelled)}catch(error:CancellationException){throw error}catch(_:Exception){issue(sidecar,"INVALID_TEXTURE_MCMETA");continue}
            }
            if(dimensions.width>4096||dimensions.height>4096||dimensions.width*dimensions.height>1048576){issue(path,"INVALID_PNG");continue}
            val width=dimensions.width.toInt();val height=dimensions.height.toInt();val square=width in listOf(16,32,64,128,256)&&height==width
            val animation=try{ResourceAnimationParser.normalize(parsed,width,height)}catch(_:IllegalArgumentException){
                issue(if(parsed==null)path else sidecar,"INVALID_TEXTURE_ANIMATION");if(!square)continue;parsed=null;null
            }
            if(animation==null&&!square){
                if(width in listOf(16,32,64,128,256)&&height>width&&height%width==0&&height/width<=256)issue(path,"INVALID_TEXTURE_ANIMATION")else issue(path,"NOT_16X16")
                continue
            }
            textures+=ResourceTextureDescriptor("$ns:block/$name",ns,name,path,width,height,animation,parsed?.toString())
        }
        for(path in metadata.sorted())if(path !in consumed)issue(path,"ORPHAN_TEXTURE_MCMETA")
        checkpoint(cancelled);return ResourceTextureCatalog(archive.inputSha256,textures,issues.sortedWith(compareBy<ResourceAssetIssue>{it.path}.thenBy{it.code}),candidates.size)
    }
}
