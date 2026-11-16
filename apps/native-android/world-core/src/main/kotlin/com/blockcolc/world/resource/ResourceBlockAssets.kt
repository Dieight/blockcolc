package com.blockcolc.world.resource

import org.json.JSONArray
import org.json.JSONObject
import java.util.Collections
import java.util.concurrent.CancellationException

internal fun <T> resourceList(values:Collection<T>):List<T> = Collections.unmodifiableList(values.toList())
internal fun <K,V> resourceMap(values:Map<K,V>):Map<K,V> = Collections.unmodifiableMap(LinkedHashMap(values))
internal val resourceFaces=listOf("down","up","north","south","west","east")
internal fun jsonArray(values:Iterable<Any>)=JSONArray().also{a->values.forEach{a.put(it)}}
internal fun jsonMap(values:Map<String,*>):JSONObject=JSONObject().also{o->values.forEach{(k,v)->o.put(k,v)}}

data class ResourceVector3(val x:Double,val y:Double,val z:Double){
    internal fun values()=listOf(x,y,z)
    internal fun json()=jsonArray(values())
}
data class ResourceFaceUv(val u0:Double,val v0:Double,val u1:Double,val v1:Double){
    internal fun json()=jsonArray(listOf(u0,v0,u1,v1))
}
sealed class ResourceElementRotation(val origin:ResourceVector3,val rescale:Boolean){
    class Axis internal constructor(origin:ResourceVector3,val axis:String,val angle:Double,rescale:Boolean):ResourceElementRotation(origin,rescale)
    class Euler internal constructor(origin:ResourceVector3,val angles:ResourceVector3):ResourceElementRotation(origin,false)
    fun json()=JSONObject().put("origin",origin.json()).put("rescale",rescale).also{out->when(this){
        is Axis->{out.put("axis",axis).put("angle",angle)}
        is Euler->{out.put("euler",angles.json())}
    }}
}
class ResourceModelFace internal constructor(val texture:String,val uv:ResourceFaceUv,val rotation:Int=0,val tintIndex:Int?=null,
    val cullFace:String?=null,val forceTranslucent:Boolean=false){
    fun json()=JSONObject().put("texture",texture).put("uv",uv.json()).put("rotation",rotation).also{
        if(tintIndex!=null)it.put("tintIndex",tintIndex);if(cullFace!=null)it.put("cullFace",cullFace);if(forceTranslucent)it.put("forceTranslucent",true)
    }
}
class ResourceBlockElement internal constructor(val from:ResourceVector3,val to:ResourceVector3,val shade:Boolean,
    val shadeDirectionOverride:String?,faces:Map<String,ResourceModelFace>,val rotation:ResourceElementRotation?=null,val blockRotation:Pair<Int,Int>?=null){
    val faces=resourceMap(faces)
    fun json()=JSONObject().put("from",from.json()).put("to",to.json()).put("shade",shade).put("faces",jsonMap(faces.mapValues{it.value.json()})).also{
        if(shadeDirectionOverride!=null)it.put("shadeDirectionOverride",shadeDirectionOverride)
        if(rotation!=null)it.put("rotation",rotation.json());if(blockRotation!=null)it.put("blockRotation",JSONObject().put("x",blockRotation.first).put("y",blockRotation.second))
    }
}
class ResourceModelReference internal constructor(val model:String,val x:Int,val y:Int,val uvlock:Boolean,val weight:Int){
    fun json()=JSONObject().put("model",model).put("x",x).put("y",y).put("uvlock",uvlock).put("weight",weight)
}
class ResourceBlockVariant internal constructor(val key:String,conditions:Map<String,String>,choices:List<ResourceModelReference>){
    val conditions=resourceMap(conditions);val choices=resourceList(choices)
    fun json()=JSONObject().put("key",key).put("conditions",jsonMap(conditions)).put("choices",jsonArray(choices.map{it.json()}))
}
class ResourceMultipartPart internal constructor(clauses:List<Map<String,List<String>>>,apply:List<ResourceModelReference>){
    val clauses=resourceList(clauses.map{clause->resourceMap(clause.mapValues{resourceList(it.value)})});val apply=resourceList(apply)
    fun json()=JSONObject().put("when",JSONObject().put("clauses",jsonArray(clauses.map{c->jsonMap(c.mapValues{jsonArray(it.value)})})))
        .put("apply",jsonArray(apply.map{it.json()}))
}
class ResourceBlockState internal constructor(val resourceId:String,val archivePath:String,variants:List<ResourceBlockVariant>,multipart:List<ResourceMultipartPart>?){
    val variants=resourceList(variants);val multipart=multipart?.let{resourceList(it)}
    fun json()=JSONObject().put("resourceId",resourceId).put("archivePath",archivePath).put("variants",jsonArray(variants.map{it.json()})).also{
        if(multipart!=null)it.put("multipart",jsonArray(multipart.map{p->p.json()}))
    }
}
class ResourceBlockModel internal constructor(val resourceId:String,val archivePath:String,val parent:String?,textures:Map<String,String>,
    forceTranslucentTextures:Set<String>,faces:Map<String,String>?,faceMetadata:Map<String,ResourceModelFace>?,elements:List<ResourceBlockElement>?){
    val textures=resourceMap(textures);val forceTranslucentTextures:Set<String> = Collections.unmodifiableSet(LinkedHashSet(forceTranslucentTextures))
    val faces=faces?.let{resourceMap(it)};val faceMetadata=faceMetadata?.let{resourceMap(it)};val elements=elements?.let{resourceList(it)}
    fun json()=JSONObject().put("resourceId",resourceId).put("archivePath",archivePath).put("textures",jsonMap(textures)).also{
        if(parent!=null)it.put("parent",parent);if(forceTranslucentTextures.isNotEmpty())it.put("forceTranslucentTextures",jsonMap(forceTranslucentTextures.associateWith{true}))
        if(faces!=null)it.put("faces",jsonMap(faces));if(faceMetadata!=null)it.put("faceMetadata",jsonMap(faceMetadata.mapValues{p->p.value.json()}))
        if(elements!=null)it.put("elements",jsonArray(elements.map{e->e.json()}))
    }
}
data class ResourceBlockIssue(val path:String,val code:String,val message:String)
class ResourceBlockCatalog internal constructor(val archiveSha256:String,states:List<ResourceBlockState>,models:List<ResourceBlockModel>,
    issues:List<ResourceBlockIssue>,recognizedPaths:Set<String>){
    val blockStates=resourceList(states);val models=resourceList(models);val issues=resourceList(issues)
    val recognizedPaths:Set<String> = Collections.unmodifiableSet(LinkedHashSet(recognizedPaths))
    private val byState=blockStates.associateBy{it.resourceId};private val byModel=this.models.associateBy{it.resourceId}
    fun state(id:String)=byState[id]
    fun model(id:String)=byModel[id]
}

/** The normalized representation is immutable. Only one bounded JSON asset is transient at a time. */
object NativeResourceBlocks {
    private val statePath=Regex("^assets/([^/]+)/blockstates/(.+)\\.json$")
    private val modelPath=Regex("^assets/([^/]+)/models/block/(.+)\\.json$")
    private val nsPattern=Regex("[a-z0-9_.-]+")
    private val pathPattern=Regex("[a-z0-9._/-]+")
    private val safePattern=Regex("[a-z0-9_.-]+")
    private fun safe(value:String)=value.length<=64&&safePattern.matches(value)&&value !in setOf("__proto__","prototype","constructor")
    private fun valid(ns:String,path:String)=nsPattern.matches(ns)&&pathPattern.matches(path)&&path.split('/').all{it.isNotEmpty()&&it!="."&&it!=".."}
    private fun obj(raw:Any?,name:String)=raw as? JSONObject?:throw IllegalArgumentException("$name must be a plain object.")
    private fun bool(raw:Any?,name:String)=raw as? Boolean?:throw IllegalArgumentException("$name must be boolean.")
    private fun entries(o:JSONObject)=o.keys().asSequence().map{it to o.get(it)}.toList()
    private fun number(raw:Any?,min:Double,max:Double,name:String):Double{
        require(raw is Number){"$name must be numeric."};val value=raw.toDouble();require(value.isFinite()&&value in min..max){"$name out of range."};return if(value==0.0)0.0 else value
    }
    private fun integer(raw:Any?,min:Int,max:Int,name:String)=number(raw,min.toDouble(),max.toDouble(),name).also{require(it%1.0==0.0){"$name must be an integer."}}.toInt()
    private fun rotation(raw:Any?):Int=if(raw==null)0 else integer(raw,0,270,"rotation").also{require(it%90==0){"Model rotation must be 0, 90, 180, or 270."}}
    private fun location(raw:Any?,model:Boolean):String{
        require(raw is String&&raw.isNotEmpty()){"Resource location must be a non-empty string."}
        val sep=raw.indexOf(':');val ns=if(sep<0)"minecraft"else raw.substring(0,sep);val p=if(sep<0)raw else raw.substring(sep+1)
        require(valid(ns,p)){"Invalid resource location: $raw"};require(!model||p.startsWith("block/")){"Only block models are supported: $raw"};return "$ns:$p"
    }
    private fun variable(raw:String):String{require(raw.startsWith('#')&&safe(raw.substring(1))){"Invalid texture variable reference."};return raw}
    private fun texture(raw:Any?,name:String):Pair<String,Boolean>{
        if(raw is String)return (if(raw.startsWith('#'))variable(raw)else location(raw,false)) to false
        val o=obj(raw,name);require(entries(o).all{it.first in setOf("sprite","force_translucent")}&&o.opt("sprite") is String){"$name must be a sprite string or a supported texture descriptor."}
        val sprite=o.getString("sprite");return (if(sprite.startsWith('#'))variable(sprite)else location(sprite,false)) to if(o.has("force_translucent"))bool(o.get("force_translucent"),"$name.force_translucent")else false
    }
    private fun faceTexture(raw:Any?):String{
        require(raw is String){"Face texture must be a texture variable or resource location."}
        return if(raw.startsWith('#'))variable(raw)else if(':' !in raw&&'/' !in raw)variable("#$raw")else location(raw,false)
    }
    private fun face(raw:Any?):String{require(raw is String&&raw in resourceFaces){"Expected a block face."};return raw}
    private fun vector(raw:Any?,min:Double,max:Double,name:String):ResourceVector3{
        require(raw is JSONArray&&raw.length()==3){"$name must contain exactly three numbers."}
        return ResourceVector3(number(raw.get(0),min,max,name),number(raw.get(1),min,max,name),number(raw.get(2),min,max,name))
    }
    private fun uv(raw:Any?):ResourceFaceUv{
        require(raw is JSONArray&&raw.length()==4){"Face uv must contain exactly four numbers."}
        val v=List(4){number(raw.get(it),0.0,16.0,"Face uv")};return ResourceFaceUv(v[0],v[1],v[2],v[3])
    }
    private fun defaultUv(face:String,f:ResourceVector3,t:ResourceVector3):ResourceFaceUv=when(face){
        "down"->ResourceFaceUv(f.x,16-t.z,t.x,16-f.z);"up"->ResourceFaceUv(f.x,f.z,t.x,t.z)
        "north"->ResourceFaceUv(16-t.x,16-t.y,16-f.x,16-f.y);"south"->ResourceFaceUv(f.x,16-t.y,t.x,16-f.y)
        "west"->ResourceFaceUv(f.z,16-t.y,t.z,16-f.y);else->ResourceFaceUv(16-t.z,16-t.y,16-f.z,16-f.y)
    }
    private fun elementRotation(raw:Any?,name:String):ResourceElementRotation{
        val o=obj(raw,name);val axis=o.has("axis")||o.has("angle");val euler=o.has("x")||o.has("y")||o.has("z")
        require(axis!=euler){"$name must use exactly one supported rotation format."}
        val allowed=if(axis)setOf("origin","axis","angle","rescale")else setOf("origin","x","y","z","rescale")
        require(entries(o).all{it.first in allowed}){"$name contains unsupported properties."}
        val origin=vector(o.opt("origin"),-32.0,48.0,"$name.origin");val rescale=if(o.has("rescale"))bool(o.get("rescale"),"$name.rescale")else false
        if(euler){require(!rescale){"$name Euler rotations cannot use rescale."};return ResourceElementRotation.Euler(origin,ResourceVector3(
            number(o.opt("x"),-180.0,180.0,name),number(o.opt("y"),-180.0,180.0,name),number(o.opt("z"),-180.0,180.0,name)))}
        val a=o.opt("axis");require(a is String&&a in listOf("x","y","z")){"$name.axis must be x, y, or z."}
        val angle=number(o.opt("angle"),-90.0,90.0,name);require(!rescale||kotlin.math.abs(angle)<=45){"$name.rescale is limited to rotations within 45 degrees."}
        return ResourceElementRotation.Axis(origin,a,angle,rescale)
    }
    private fun element(raw:Any?,index:Int):ResourceBlockElement{
        val o=obj(raw,"elements[$index]");val from=vector(o.opt("from"),-16.0,32.0,"from");val to=vector(o.opt("to"),-16.0,32.0,"to")
        require(from.values().zip(to.values()).count{it.first==it.second}<=1){"elements[$index] may be zero-thickness on at most one axis."}
        val shade=if(o.has("shade"))bool(o.get("shade"),"shade")else true
        val override=if(o.has("shade_direction_override"))face(o.get("shade_direction_override"))else if(!shade)"up"else null
        val elementRotation=if(o.has("rotation"))elementRotation(o.get("rotation"),"elements[$index].rotation")else null
        val faces=obj(o.opt("faces"),"element.faces");require(faces.length() in 1..6&&entries(faces).all{it.first in resourceFaces}){"element.faces must contain 1-6 known block faces."}
        val normalized=LinkedHashMap<String,ResourceModelFace>()
        for(f in resourceFaces)if(faces.has(f)){val v=obj(faces.get(f),"element.faces.$f")
            normalized[f]=ResourceModelFace(faceTexture(v.opt("texture")),if(v.has("uv"))uv(v.get("uv"))else defaultUv(f,from,to),rotation(v.opt("rotation")),
                if(v.has("tintindex"))integer(v.get("tintindex"),0,255,"tintindex")else null,if(v.has("cullface"))face(v.get("cullface"))else null)
        }
        return ResourceBlockElement(from,to,shade,override,normalized,elementRotation)
    }
    private fun choices(raw:Any?,maximum:Int=128,name:String="variant"):List<ResourceModelReference>{
        val values=if(raw is JSONArray)List(raw.length()){raw.get(it)}else listOf(raw)
        require(values.size in 1..maximum){"$name must contain 1-$maximum model choices."}
        return values.map{val o=obj(it,"$name model");ResourceModelReference(location(o.opt("model"),true),rotation(o.opt("x")),rotation(o.opt("y")),
            if(o.has("uvlock"))bool(o.get("uvlock"),"uvlock")else false,if(o.has("weight"))integer(o.get("weight"),1,10000,"weight")else 1)}
    }
    private fun conditions(raw:String):Map<String,String>{
        if(raw.isEmpty())return emptyMap();val out=LinkedHashMap<String,String>();val parts=raw.split(',')
        require(parts.size<=32){"Invalid or excessive variant conditions."}
        for(condition in parts){val at=condition.indexOf('=');require(at>0&&at<condition.length-1){"Invalid variant condition: $condition"}
            val k=condition.substring(0,at);val v=condition.substring(at+1);require(safe(k)&&v.length<=128&&!out.containsKey(k)){"Invalid variant condition: $condition"};out[k]=v}
        return out.toSortedMap()
    }
    private fun quote(value:String):String=buildString{
        append('"');for(c in value)when(c){'"'->append("\\\"");'\\'->append("\\\\");'\b'->append("\\b");'\u000c'->append("\\f");'\n'->append("\\n");'\r'->append("\\r");'\t'->append("\\t")
            else->if(c.code<32)append("\\u"+c.code.toString(16).padStart(4,'0'))else append(c)};append('"')
    }
    private fun clauseKey(c:Map<String,List<String>>)=c.entries.joinToString(",","{","}"){(key,values)->quote(key)+":"+values.joinToString(",","[","]"){quote(it)}}
    private fun canonical(clauses:List<Map<String,List<String>>>)=clauses.distinctBy{clauseKey(it)}.sortedBy{clauseKey(it)}
    private fun expression(raw:Any?,depth:Int):List<Map<String,List<String>>>{
        require(depth<8){"Multipart condition nesting limit."};val o=obj(raw,"multipart.when");val keys=entries(o).map{it.first}
        if(keys.size==1&&keys[0] in listOf("OR","AND")){
            val operator=keys[0];val operands=o.get(operator);require(operands is JSONArray&&operands.length() in 1..16){"Invalid multipart operands."}
            val parsed=List(operands.length()){expression(operands.get(it),depth+1)}
            if(operator=="OR"){val flat=parsed.flatten();require(flat.size<=16){"Multipart OR clause limit."};return canonical(flat)}
            var clauses:List<Map<String,List<String>>> = listOf(emptyMap())
            for(operand in parsed){val combined=ArrayList<Map<String,List<String>>>()
                for(left in clauses)for(right in operand){val merged=LinkedHashMap(left);var valid=true
                    for((k,rv)in right){val values=merged[k]?.filter{it in rv}?:rv;if(values.isEmpty()){valid=false;break};merged[k]=values.distinct().sorted()}
                    if(valid&&merged.size<=16)combined+=merged.toSortedMap();require(combined.size<=16){"Multipart AND clause limit."}}
                clauses=combined
            };require(clauses.isNotEmpty()){"Contradictory multipart condition."};return canonical(clauses)
        }
        require(keys.none{it in listOf("OR","AND")}&&keys.size in 1..16){"Invalid multipart properties."}
        val output=linkedMapOf<String,List<String>>()
        for((key,v)in entries(o)){require(safe(key)&&v is String&&v.length in 1..512){"Invalid multipart property."}
            val values=v.split('|');require(values.size in 1..16&&values.all{it.length in 1..128}){"Invalid multipart alternatives."};output[key]=values.distinct().sorted()}
        return listOf(output.toSortedMap())
    }
    private fun state(o:JSONObject,id:String,path:String):ResourceBlockState{
        if(o.has("multipart")){
            val raw=o.get("multipart");require(raw is JSONArray&&raw.length() in 1..64){"multipart must contain 1-64 parts."}
            var references=0;val parts=List(raw.length()){i->val part=obj(raw.get(i),"multipart[$i]");val apply=choices(part.opt("apply"),32,"multipart[$i].apply")
                references+=apply.size;require(references<=512){"multipart exceeds 512 model references."}
                ResourceMultipartPart(if(part.has("when"))expression(part.get("when"),0)else listOf(emptyMap()),apply)}
            return ResourceBlockState(id,path,emptyList(),parts)
        }
        val raw=obj(o.opt("variants"),"variants");require(raw.length() in 1..512){"variants must contain 1-512 entries."}
        val variants=entries(raw).map{(key,v)->val c=conditions(key);ResourceBlockVariant(c.entries.joinToString(","){"${it.key}=${it.value}"},c,choices(v))}.sortedBy{it.key}
        return ResourceBlockState(id,path,variants,null)
    }
    private fun model(o:JSONObject,id:String,path:String):ResourceBlockModel{
        val parent=if(o.has("parent"))location(o.get("parent"),true)else null
        val raw=if(o.has("textures"))obj(o.get("textures"),"textures")else JSONObject();require(raw.length()<=128){"textures exceeds 128 entries."}
        val textures=LinkedHashMap<String,String>();val translucent=LinkedHashSet<String>()
        for((key,value)in entries(raw).sortedBy{it.first}){require(safe(key)){"Model texture variable names must be safe."};val normalized=texture(value,"textures.$key");textures[key]=normalized.first;if(normalized.second)translucent+=key}
        val elements=if(o.has("elements")){val e=o.get("elements");require(e is JSONArray&&e.length() in 1..64){"elements must contain 1-64 entries."};List(e.length()){element(e.get(it),it)}}else null
        val cube=elements?.singleOrNull()?.takeIf{it.from==ResourceVector3(0.0,0.0,0.0)&&it.to==ResourceVector3(16.0,16.0,16.0)&&it.rotation==null}
        return ResourceBlockModel(id,path,parent,textures,translucent,cube?.faces?.mapValues{it.value.texture},cube?.faces,elements)
    }
    fun prepare(archive:NativeResourceArchive,cancelled:()->Boolean={false}):ResourceBlockCatalog{
        val states=ArrayList<ResourceBlockState>();val models=ArrayList<ResourceBlockModel>();val issues=ArrayList<ResourceBlockIssue>();val recognized=LinkedHashSet<String>()
        for(path in archive.paths.sorted()){
            checkpoint(cancelled);val stateMatch=statePath.matchEntire(path);val match=stateMatch?:modelPath.matchEntire(path)?:continue;recognized+=path
            val ns=match.groupValues[1];val p=match.groupValues[2];val code=if(stateMatch!=null)"INVALID_BLOCKSTATE_JSON"else "INVALID_MODEL_JSON"
            if(!valid(ns,p)){issues+=ResourceBlockIssue(path,code,"Invalid namespace or resource path.");continue}
            try{
                val o=ResourceJson.objectValue(archive.read(path,cancelled),cancelled)
                if(stateMatch!=null){if(o.has("variants")&&o.has("multipart")){issues+=ResourceBlockIssue(path,"UNSUPPORTED_MULTIPART","A blockstate cannot mix variants and multipart.");continue}
                    states+=state(o,"$ns:$p",path)}else models+=model(o,"$ns:block/$p",path)
            }catch(e:CancellationException){throw e}catch(e:Exception){issues+=ResourceBlockIssue(path,code,e.message?:e.javaClass.simpleName)}
        }
        return ResourceBlockCatalog(archive.inputSha256,states.sortedBy{it.resourceId},models.sortedBy{it.resourceId},issues.sortedWith(compareBy({it.path},{it.code})),recognized)
    }
}
