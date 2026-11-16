package com.blockcolc.world.resource

import org.json.JSONObject

class ResourceMappedFace internal constructor(val entry:ResourceAtlasEntry,val metadata:ResourceModelFace,val includeCullFace:Boolean){
    val alphaMode=if(metadata.forceTranslucent)"translucent"else entry.alphaMode
    fun json()=JSONObject().put("textureIndex",entry.pageTextureIndex).put("page",entry.page).put("uv",entry.uv.json()).put("alphaMode",alphaMode)
        .put("cropUv",jsonArray(listOf(metadata.uv.u0/16,metadata.uv.v0/16,metadata.uv.u1/16,metadata.uv.v1/16))).put("rotation",metadata.rotation).also{
            if(metadata.tintIndex!=null)it.put("tintIndex",metadata.tintIndex);if(includeCullFace&&metadata.cullFace!=null)it.put("cullFace",metadata.cullFace)
            if(entry.animation!=null)it.put("animation",entry.animation.json())
        }
}
class ResourceMappedElement internal constructor(val source:ResourceBlockElement,faces:Map<String,ResourceMappedFace>){
    val faces=resourceMap(faces)
    fun json()=source.json().put("faces",jsonMap(faces.mapValues{it.value.json()}))
}
sealed class ResourceAtlasResolution{abstract fun json():JSONObject}
class ResourceAtlasFallback internal constructor(val reason:String,val resourceId:String?):ResourceAtlasResolution(){
    override fun json()=JSONObject().put("status","fallback").put("reason",reason).also{if(resourceId!=null)it.put("resourceId",resourceId)}
}
class ResourceAtlasGeometry internal constructor(val modelId:String,elements:List<ResourceMappedElement>):ResourceAtlasResolution(){
    val elements=resourceList(elements)
    override fun json()=JSONObject().put("status","resolved_geometry").put("modelId",modelId).put("elements",jsonArray(elements.map{it.json()}))
}
class ResourceAtlasTextures internal constructor(val modelId:String,faces:Map<String,ResourceMappedFace>):ResourceAtlasResolution(){
    val faces=resourceMap(faces)
    override fun json()=JSONObject().put("status","resolved").put("modelId",modelId).put("faces",jsonMap(faces.mapValues{it.value.json()}))
}
object NativeResourceAtlasMapping {
    private fun valid(metadata:ResourceModelFace)=metadata.rotation in listOf(0,90,180,270)&&metadata.tintIndex?.let{it in 0..255}!=false&&
        listOf(metadata.uv.u0,metadata.uv.v0,metadata.uv.u1,metadata.uv.v1).all{it.isFinite()&&it in 0.0..16.0}
    fun textures(resolution:ResourceBlockResolution,atlas:ResourceTextureAtlas):ResourceAtlasResolution{
        if(resolution is ResourceBlockFallback)return ResourceAtlasFallback(resolution.reason,resolution.resourceId)
        require(resolution is ResourceBlockTextures);val out=LinkedHashMap<String,ResourceMappedFace>()
        for((face,metadata)in resolution.faceMetadata){val entry=atlas.entry(metadata.texture)?:return ResourceAtlasFallback("MISSING_ATLAS_TEXTURE",metadata.texture)
            if(!valid(metadata))return ResourceAtlasFallback("INVALID_FACE_METADATA",metadata.texture);out[face]=ResourceMappedFace(entry,metadata,false)}
        return ResourceAtlasTextures(resolution.modelId,out)
    }
    fun geometry(resolution:ResourceBlockResolution,atlas:ResourceTextureAtlas):ResourceAtlasResolution{
        if(resolution is ResourceBlockFallback)return ResourceAtlasFallback(resolution.reason,resolution.resourceId)
        require(resolution is ResourceBlockGeometry)
        // The parser admits rotation origins up to -32..48; the formal atlas route currently admits -16..32.
        if(resolution.elements.isEmpty()||resolution.elements.size>128||resolution.elements.sumOf{it.faces.size}>768||resolution.elements.any{e->
            e.from.values().plus(e.to.values()).any{!it.isFinite()||it !in -16.0..32.0}||e.rotation?.origin?.values()?.any{it !in -16.0..32.0}==true})
            return ResourceAtlasFallback("INVALID_GEOMETRY_METADATA",resolution.modelId)
        val output=ArrayList<ResourceMappedElement>()
        for(element in resolution.elements){val faces=LinkedHashMap<String,ResourceMappedFace>()
            for((face,metadata)in element.faces){if(!valid(metadata))return ResourceAtlasFallback("INVALID_FACE_METADATA",metadata.texture)
                val entry=atlas.entry(metadata.texture)?:return ResourceAtlasFallback("MISSING_ATLAS_TEXTURE",metadata.texture);faces[face]=ResourceMappedFace(entry,metadata,true)}
            output+=ResourceMappedElement(element,faces)
        };return ResourceAtlasGeometry(resolution.modelId,output)
    }
}
