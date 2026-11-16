package com.blockcolc.world.resource

import org.json.JSONObject
import java.util.Random

data class ResourceBlockPosition(val x:Double,val y:Double,val z:Double)
sealed class ResourceBlockResolution { abstract fun json():JSONObject }
class ResourceBlockFallback internal constructor(val reason:String,val resourceId:String?):ResourceBlockResolution(){
    override fun json()=JSONObject().put("status","fallback").put("reason",reason).also{if(resourceId!=null)it.put("resourceId",resourceId)}
}
class ResourceBlockGeometry internal constructor(val modelId:String,elements:List<ResourceBlockElement>):ResourceBlockResolution(){
    val elements=resourceList(elements)
    override fun json()=JSONObject().put("status","resolved_geometry").put("modelId",modelId).put("elements",jsonArray(elements.map{it.json()}))
}
class ResourceBlockTextures internal constructor(val modelId:String,faces:Map<String,ResourceModelFace>):ResourceBlockResolution(){
    val faceMetadata=resourceMap(faces)
    val faces=resourceMap(faces.mapValues{it.value.texture})
    override fun json()=JSONObject().put("status","resolved").put("modelId",modelId).put("faces",jsonMap(faces))
        .put("faceMetadata",jsonMap(faceMetadata.mapValues{it.value.json()}))
}

/** Resolves a frozen catalog without Android, global random state, or GPU assets. */
class ResourceBlockResolver private constructor(private val catalog:ResourceBlockCatalog,private val textureIds:Set<String>){
    constructor(catalog:ResourceBlockCatalog,textures:ResourceTextureCatalog):this(catalog,textures.textures.map{it.resourceId}.toHashSet()){
        require(catalog.archiveSha256==textures.archiveSha256){"Block and texture catalogs belong to different archives"}
    }
    internal constructor(stack:ResourcePackStack):this(stack.blocks,stack.textures.keys.toHashSet())
    private class Failure(val reason:String,val id:String?=null):RuntimeException(null,null,false,false)
    private data class Model(val faces:Map<String,String> = emptyMap(),val metadata:Map<String,ResourceModelFace> = emptyMap(),
        val elements:List<ResourceBlockElement>?=null,val textures:Map<String,String> = emptyMap(),val translucent:Set<String> = emptySet())
    private fun fail(reason:String,id:String?=null):Nothing=throw Failure(reason,id)
    private fun boundary(block:()->ResourceBlockResolution):ResourceBlockResolution=try{block()}catch(f:Failure){ResourceBlockFallback(f.reason,f.id)}
    private fun model(id:String,chain:Set<String>,depth:Int,cancelled:()->Boolean):Model{
        checkpoint(cancelled);if(depth>=32||id in chain)fail("MODEL_REFERENCE_CYCLE",id)
        val value=catalog.model(id)?:return builtin(id)?:fail("MISSING_MODEL",id)
        val parent=value.parent?.let{model(it,chain+id,depth+1,cancelled)}?:Model()
        val textures=parent.textures+value.textures;val translucent=parent.translucent+value.forceTranslucentTextures
        if(value.elements!=null)return Model(value.faces?:emptyMap(),value.faceMetadata?:emptyMap(),value.elements,textures,translucent)
        val metadata=LinkedHashMap(parent.metadata)
        for((face,texture)in value.faces?:emptyMap())metadata[face]=value.faceMetadata?.get(face)?:defaultFace(texture)
        return Model(parent.faces+(value.faces?:emptyMap()),metadata,parent.elements,textures,translucent)
    }
    private fun builtin(id:String):Model?{
        if(id=="minecraft:block/block")return Model()
        val refs=when(id){
            "minecraft:block/cube","minecraft:block/cube_directional","minecraft:block/cube_mirrored","minecraft:block/cube_north_west_mirrored"->resourceFaces.associateWith{"#$it"}
            "minecraft:block/cube_all"->resourceFaces.associateWith{"#all"}
            "minecraft:block/cube_column"->resourceFaces.associateWith{if(it in listOf("down","up"))"#end"else "#side"}
            "minecraft:block/cube_bottom_top"->resourceFaces.associateWith{when(it){"down"->"#bottom";"up"->"#top";else->"#side"}}
            "minecraft:block/cube_top"->resourceFaces.associateWith{if(it=="up")"#top"else "#side"}
            "minecraft:block/orientable"->resourceFaces.associateWith{when(it){"down","up"->"#top";"north"->"#front";else->"#side"}}
            "minecraft:block/orientable_with_bottom"->resourceFaces.associateWith{when(it){"down"->"#bottom";"up"->"#top";"north"->"#front";else->"#side"}}
            else->return null
        }
        val directional=id=="minecraft:block/cube_directional"
        val mirrored=if(id=="minecraft:block/cube_mirrored")resourceFaces.toSet()else if(id=="minecraft:block/cube_north_west_mirrored")setOf("north","west")else emptySet()
        val metadata=refs.mapValues{(f,t)->ResourceModelFace(t,if(f in mirrored)ResourceFaceUv(16.0,0.0,0.0,16.0)else fullUv,
            if(directional)when(f){"down"->180;"west"->270;"east"->90;else->0}else 0)}
        return Model(refs,metadata,listOf(ResourceBlockElement(zero,full,true,null,metadata)))
    }
    private fun resolveTexture(raw:String,model:Model,modelId:String):Pair<String,Boolean>{
        var current=raw;var translucent=false;val visited=HashSet<String>();var depth=0
        while(current.startsWith('#')){val variable=current.substring(1);if(depth++>=32||!visited.add(variable))fail("TEXTURE_REFERENCE_CYCLE",modelId)
            current=model.textures[variable]?:fail("MISSING_TEXTURE_VARIABLE",modelId);translucent=translucent||variable in model.translucent}
        if(current !in textureIds)fail("MISSING_TEXTURE",current);return current to translucent
    }
    private fun variant(state:ResourceBlockState,values:Map<String,String>)=state.variants.filter{v->v.conditions.all{values[it.key]==it.value}}
        .sortedWith(compareByDescending<ResourceBlockVariant>{it.conditions.size}.thenBy{it.key}).firstOrNull()
    private fun choose(id:String,state:Map<String,String>,choices:List<ResourceModelReference>,position:ResourceBlockPosition?,multipart:Boolean=false):ResourceModelReference?{
        val total=choices.sumOf{it.weight};if(total<=0)return null
        var selected=if(position!=null&&listOf(position.x,position.y,position.z).all{it.isFinite()&&it%1.0==0.0&&it in Int.MIN_VALUE.toDouble()..Int.MAX_VALUE.toDouble()}){
            var seed=(position.x.toInt()*3129871).toLong() xor (position.z.toInt().toLong()*116129781L) xor position.y.toInt().toLong()
            seed=seed*seed*42317861L+seed*11L;seed=seed shr 16
            if(multipart)seed=Random(seed).nextLong();Random(seed).nextInt(total)
        }else{
            val input=id+state.entries.sortedBy{it.key}.joinToString(",","[","]"){"${it.key}=${it.value}"};var hash=0x811c9dc5.toInt()
            for(c in input)hash=(hash xor c.code)*0x01000193
            ((hash.toLong()and 0xffffffffL)%total).toInt()
        }
        for(choice in choices){if(selected<choice.weight)return choice;selected-=choice.weight};return choices.lastOrNull()
    }
    fun textures(blockId:String,state:Map<String,String> = emptyMap(),position:ResourceBlockPosition?=null,cancelled:()->Boolean={false}):ResourceBlockResolution=boundary{
        checkpoint(cancelled);val block=catalog.state(blockId)?:fail("UNKNOWN_BLOCKSTATE",blockId)
        val v=variant(block,state)?:fail("NO_MATCHING_VARIANT",blockId);val choice=choose(blockId,state,v.choices,position)?:fail("NO_MATCHING_VARIANT",blockId)
        val resolved=model(choice.model,emptySet(),0,cancelled)
        if(resolved.elements!=null&&resourceFaces.any{it !in resolved.faces})fail("COMPLEX_GEOMETRY",choice.model)
        val out=LinkedHashMap<String,ResourceModelFace>()
        for(face in resourceFaces){val ref=resolved.faces[face]?:fail("MISSING_FACE",choice.model);val (texture,translucent)=resolveTexture(ref,resolved,choice.model)
            val metadata=resolved.metadata[face]?:defaultFace(ref)
            out[rotateFace(face,choice.x,choice.y)]=ResourceModelFace(texture,metadata.uv,faceTextureRotation(face,choice.x,choice.y,choice.uvlock,metadata.rotation),metadata.tintIndex,null,translucent)
        };ResourceBlockTextures(choice.model,out)
    }
    private fun selectedChoices(blockId:String,state:Map<String,String>,position:ResourceBlockPosition?,cancelled:()->Boolean):Pair<String,List<ResourceModelReference>>{
        checkpoint(cancelled);val block=catalog.state(blockId)?:fail("UNKNOWN_BLOCKSTATE",blockId)
        val choices:ArrayList<ResourceModelReference> = arrayListOf();val id:String
        if(block.multipart!=null){
            val required=block.multipart.flatMap{it.clauses.flatMap{c->c.keys}}.toSet()
            if(required.any{it !in state})fail("NO_MATCHING_VARIANT",blockId)
            for((i,part)in block.multipart.withIndex()){checkpoint(cancelled)
                if(part.clauses.any{clause->clause.all{(key,values)->state[key] in values}})
                    choices+=choose("$blockId#multipart-$i",state,part.apply,position,true)?:fail("INVALID_MULTIPART",blockId)
            };if(choices.isEmpty())fail("NO_MATCHING_VARIANT",blockId);id=blockId
        }else{
            val v=variant(block,state)?:fail("NO_MATCHING_VARIANT",blockId);val choice=choose(blockId,state,v.choices,position)?:fail("NO_MATCHING_VARIANT",blockId)
            choices+=choice;id=choice.model
        }
        return id to choices
    }
    /** Cache the actual selected variants, not every coordinate that selected
     * them. Position randomization still runs through the same source rule. */
    internal fun geometryChoiceKey(blockId:String,state:Map<String,String>,position:ResourceBlockPosition?,cancelled:()->Boolean):String=try{
        val (id,choices)=selectedChoices(blockId,state,position,cancelled)
        id+";"+choices.joinToString(";"){"${it.model}:${it.x}:${it.y}:${it.uvlock}"}
    }catch(f:Failure){"fallback:${f.reason}:${f.id}"}
    fun geometry(blockId:String,state:Map<String,String> = emptyMap(),position:ResourceBlockPosition?=null,cancelled:()->Boolean={false}):ResourceBlockResolution=boundary{
        val (id,choices)=selectedChoices(blockId,state,position,cancelled)
        val output=ArrayList<ResourceBlockElement>();var quads=0
        for(choice in choices){val resolved=model(choice.model,emptySet(),0,cancelled)
            val elements=resolved.elements?:if(resourceFaces.all{it in resolved.faces})listOf(ResourceBlockElement(zero,full,true,null,
                resourceFaces.associateWith{resolved.metadata[it]?:defaultFace(resolved.faces.getValue(it))}))else null
            if(elements==null||output.size+elements.size>128)fail("GEOMETRY_LIMIT_EXCEEDED",id)
            for(element in elements){checkpoint(cancelled);quads+=element.faces.size;if(quads>768)fail("GEOMETRY_LIMIT_EXCEEDED",id)
                val rotated=choice.x!=0||choice.y!=0
                val reversed=element.rotation==null&&rotated&&element.from.values().zip(element.to.values()).any{it.first>it.second}
                val bounds=if(element.rotation==null&&!reversed&&rotated)rotateBounds(element.from,element.to,choice.x,choice.y)else null
                val faces=LinkedHashMap<String,ResourceModelFace>()
                for((face,metadata)in element.faces){val (texture,translucent)=resolveTexture(metadata.texture,resolved,choice.model)
                    val target=if(element.rotation==null&&!reversed)rotateFace(face,choice.x,choice.y)else face
                    val rotation=if(reversed){if(!choice.uvlock)metadata.rotation else (metadata.rotation-faceTextureRotation(face,choice.x,choice.y,false,0)+360)%360}
                        else faceTextureRotation(face,choice.x,choice.y,choice.uvlock,metadata.rotation)
                    faces[target]=ResourceModelFace(texture,metadata.uv,rotation,metadata.tintIndex,
                        if(metadata.cullFace!=null&&element.rotation==null)rotateFace(metadata.cullFace,choice.x,choice.y)else null,translucent)
                }
                output+=ResourceBlockElement(bounds?.first?:element.from,bounds?.second?:element.to,element.shade,element.shadeDirectionOverride,faces,element.rotation,
                    if(element.rotation!=null||reversed)choice.x to choice.y else null)
            }
        };ResourceBlockGeometry(id,output)
    }
    companion object{
        private val zero=ResourceVector3(0.0,0.0,0.0);private val full=ResourceVector3(16.0,16.0,16.0);private val fullUv=ResourceFaceUv(0.0,0.0,16.0,16.0)
        private fun defaultFace(texture:String)=ResourceModelFace(texture,fullUv)
        private fun rotate(v:ResourceVector3,x:Int,y:Int):ResourceVector3{
            var a=v.x;var b=v.y;var c=v.z
            repeat(x/90){val old=b;b=c;c=-old};repeat(y/90){val old=a;a=-c;c=old}
            return ResourceVector3(if(a==0.0)0.0 else a,if(b==0.0)0.0 else b,if(c==0.0)0.0 else c)
        }
        private fun normal(face:String)=when(face){"down"->ResourceVector3(0.0,-1.0,0.0);"up"->ResourceVector3(0.0,1.0,0.0);"north"->ResourceVector3(0.0,0.0,-1.0)
            "south"->ResourceVector3(0.0,0.0,1.0);"west"->ResourceVector3(-1.0,0.0,0.0);else->ResourceVector3(1.0,0.0,0.0)}
        private fun rotateFace(face:String,x:Int,y:Int):String{val v=rotate(normal(face),x,y);return when{v.y== -1.0->"down";v.y==1.0->"up";v.z== -1.0->"north";v.z==1.0->"south";v.x== -1.0->"west";else->"east"}}
        private fun basis(face:String):Pair<ResourceVector3,ResourceVector3> = when(face){
            "down"->ResourceVector3(1.0,0.0,0.0) to ResourceVector3(0.0,0.0,-1.0);"up"->ResourceVector3(1.0,0.0,0.0) to ResourceVector3(0.0,0.0,1.0)
            "north"->ResourceVector3(-1.0,0.0,0.0) to ResourceVector3(0.0,-1.0,0.0);"south"->ResourceVector3(1.0,0.0,0.0) to ResourceVector3(0.0,-1.0,0.0)
            "west"->ResourceVector3(0.0,0.0,1.0) to ResourceVector3(0.0,-1.0,0.0);else->ResourceVector3(0.0,0.0,-1.0) to ResourceVector3(0.0,-1.0,0.0)
        }
        private fun negate(v:ResourceVector3)=ResourceVector3(if(v.x==0.0)0.0 else -v.x,if(v.y==0.0)0.0 else -v.y,if(v.z==0.0)0.0 else -v.z)
        fun faceTextureRotation(face:String,x:Int,y:Int,uvlock:Boolean,faceRotation:Int=0):Int{
            require(face in resourceFaces&&listOf(x,y,faceRotation).all{it in listOf(0,90,180,270)})
            if(uvlock)return faceRotation
            val target=basis(rotateFace(face,x,y));val u=rotate(basis(face).first,x,y)
            val induced=when(u){target.first->0;target.second->90;negate(target.first)->180;else->270}
            return (faceRotation+induced)%360
        }
        private fun rotateBounds(from:ResourceVector3,to:ResourceVector3,x:Int,y:Int):Pair<ResourceVector3,ResourceVector3>{
            val points=ArrayList<ResourceVector3>()
            for(a in listOf(from.x,to.x))for(b in listOf(from.y,to.y))for(c in listOf(from.z,to.z)){
                val v=rotate(ResourceVector3(a-8,b-8,c-8),x,y);points+=ResourceVector3(v.x+8,v.y+8,v.z+8)}
            return ResourceVector3(points.minOf{it.x},points.minOf{it.y},points.minOf{it.z}) to ResourceVector3(points.maxOf{it.x},points.maxOf{it.y},points.maxOf{it.z})
        }
    }
}
