package com.blockcolc.world.resource

import org.json.JSONObject
import java.util.concurrent.CancellationException

class ResourceSpecialTexture internal constructor(val resourceId:String,val namespace:String,val texturePath:String,val archivePath:String,val width:Int,val height:Int){
    fun json()=JSONObject().put("resourceId",resourceId).put("namespace",namespace).put("texturePath",texturePath).put("archivePath",archivePath).put("width",width).put("height",height)
}
class ResourceColormap internal constructor(val kind:String,val archivePath:String){
    val resourceId="minecraft:colormap/$kind"
    fun json()=JSONObject().put("kind",kind).put("resourceId",resourceId).put("archivePath",archivePath).put("width",256).put("height",256)
}
class ResourcePackExtraCatalog internal constructor(val archiveSha256:String,specialTextures:List<ResourceSpecialTexture>,colormaps:List<ResourceColormap>,
    issues:List<ResourceAssetIssue>,recognizedPaths:List<String>,val candidateSpecialTextures:Int){
    val specialTextures=resourceList(specialTextures);val colormaps=resourceList(colormaps);val issues=resourceList(issues);val recognizedPaths=resourceList(recognizedPaths)
    fun decodeSpecial(archive:NativeResourceArchive,resourceId:String,cancelled:()->Boolean={false}):ResourcePngImage{
        require(archive.inputSha256==archiveSha256);val value=checkNotNull(specialTextures.find{it.resourceId==resourceId})
        return ResourcePng.decode(archive.read(value.archivePath,cancelled),ResourcePngLimits(1024,1024),value.width,value.height,cancelled)
    }
    fun decodeColormap(archive:NativeResourceArchive,kind:String,cancelled:()->Boolean={false}):ResourcePngImage{
        require(archive.inputSha256==archiveSha256);val value=checkNotNull(colormaps.find{it.kind==kind})
        return ResourcePng.decode(archive.read(value.archivePath,cancelled),ResourcePngLimits(256,256,65536,262144),256,256,cancelled)
    }
}
object NativeResourcePackExtras {
    private val entity=Regex("^assets/([^/]+)/textures/entity/(.+)\\.png$")
    private val namespace=Regex("[a-z0-9_.-]+")
    private val pathPattern=Regex("[a-z0-9._/-]+")
    private val roots=setOf("banner","chest","conduit","copper_golem","creeper","decorated_pot","end_portal","enderdragon","piglin","shulker","skeleton","zombie")
    fun isAllowedSpecialTexturePath(path:String):Boolean{
        if(path.length>256||!pathPattern.matches(path)||path.split('/').any{it.isEmpty()||it=="."||it==".."})return false
        val parts=path.split('/');return if(parts[0]=="player")parts.size==3&&parts[1] in setOf("wide","slim")else parts[0] in roots
    }
    fun prepare(archive:NativeResourceArchive,maxSingleFileBytes:Int=4194304,cancelled:()->Boolean={false}):ResourcePackExtraCatalog{
        require(maxSingleFileBytes>0);checkpoint(cancelled)
        val candidates=archive.paths.filter{p->entity.matchEntire(p)?.let{isAllowedSpecialTexturePath(it.groupValues[2])}==true}.sorted()
        val textures=ArrayList<ResourceSpecialTexture>();val maps=ArrayList<ResourceColormap>();val issues=ArrayList<ResourceAssetIssue>();val recognized=ArrayList(candidates)
        var bytesTotal=0L;var pixelsTotal=0L
        for(path in candidates){checkpoint(cancelled)
            if(textures.size>=512){issues+=ResourceAssetIssue(path,"SPECIAL_TEXTURE_LIMIT_EXCEEDED");break}
            val match=entity.matchEntire(path)!!;val ns=match.groupValues[1];val texturePath=match.groupValues[2]
            if(ns.length>128||!namespace.matches(ns)){issues+=ResourceAssetIssue(path,"INVALID_SPECIAL_TEXTURE_PATH");continue}
            val bytes=archive.read(path,cancelled)
            if(bytes.isEmpty()||bytes.size>minOf(maxSingleFileBytes,4194304)){issues+=ResourceAssetIssue(path,"INVALID_SPECIAL_TEXTURE_PNG");continue}
            if(bytesTotal+bytes.size>16777216){issues+=ResourceAssetIssue(path,"SPECIAL_TEXTURE_LIMIT_EXCEEDED");break}
            try{val image=ResourcePng.decode(bytes,ResourcePngLimits(1024,1024),cancelled=cancelled);val pixels=image.width.toLong()*image.height
                if(pixelsTotal+pixels>4194304){issues+=ResourceAssetIssue(path,"SPECIAL_TEXTURE_PIXEL_LIMIT_EXCEEDED");break}
                textures+=ResourceSpecialTexture("$ns:entity/$texturePath",ns,texturePath,path,image.width,image.height);bytesTotal+=bytes.size;pixelsTotal+=pixels
            }catch(e:CancellationException){throw e}catch(_:Exception){issues+=ResourceAssetIssue(path,"INVALID_SPECIAL_TEXTURE_PNG")}
        }
        for(kind in listOf("grass","foliage","dry_foliage")){checkpoint(cancelled);val path="assets/minecraft/textures/colormap/$kind.png";if(path !in archive.paths)continue;recognized+=path
            try{ResourcePng.decode(archive.read(path,cancelled),ResourcePngLimits(256,256,65536,262144),256,256,cancelled);maps+=ResourceColormap(kind,path)}
            catch(e:CancellationException){throw e}catch(_:Exception){issues+=ResourceAssetIssue(path,"INVALID_COLORMAP")}
        }
        return ResourcePackExtraCatalog(archive.inputSha256,textures,maps,issues,recognized,candidates.size)
    }
}
