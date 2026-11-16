package com.blockcolc.world.resource

import org.json.JSONArray
import org.json.JSONObject
import java.util.Collections

class ResourcePackException(val code:String,val assetPath:String?=null,detail:String=code,cause:Throwable?=null):IllegalArgumentException(detail,cause)
internal fun packRequire(condition:Boolean,code:String,path:String?=null,detail:String=code){if(!condition)throw ResourcePackException(code,path,detail)}

data class ResourceFormat(val major:Long,val minor:Int):Comparable<ResourceFormat>{
    override fun compareTo(other:ResourceFormat):Int=major.compareTo(other.major).takeIf{it!=0}?:minor.compareTo(other.minor)
    fun json()=JSONArray().put(major).put(minor)
}
class ResourcePackMetadata internal constructor(val packFormat:Long,private val description:String,val minFormat:ResourceFormat?=null,val maxFormat:ResourceFormat?=null){
    /** Every caller receives its own JSON tree. */
    fun json():JSONObject=JSONObject().put("packFormat",packFormat).put("description",ResourceJson.parse(description.toByteArray(Charsets.UTF_8))).also{
        minFormat?.let{v->it.put("minFormat",v.json())};maxFormat?.let{v->it.put("maxFormat",v.json())}
    }
}
internal data class ResourceOverlay(val directory:String,val applies:Boolean)
internal data class ParsedResourceMetadata(val pack:ResourcePackMetadata,val overlays:List<ResourceOverlay>)
internal object ResourceMetadataParser {
    val TARGET=ResourceFormat(97,1)
    private const val CODE="INVALID_PACK_MCMETA"
    private fun valid(ok:Boolean){packRequire(ok,CODE,"pack.mcmeta")}
    private fun integer(raw:Any?,min:Long=1,max:Long=9007199254740991L):Long{
        valid(raw is Number);val v=(raw as Number).toDouble();valid(v.isFinite()&&v%1.0==0.0&&v>=min.toDouble()&&v<=max.toDouble());return v.toLong()
    }
    private fun bound(raw:Any?,integerMinor:Int):ResourceFormat{
        val values=if(raw is JSONArray)List(raw.length()){raw.get(it)}else listOf(raw)
        valid(values.size in 1..2)
        return ResourceFormat(integer(values[0]),if(values.size==2)integer(values[1],0,Int.MAX_VALUE.toLong()).toInt()else integerMinor)
    }
    fun parse(bytes:ByteArray,cancelled:()->Boolean):ParsedResourceMetadata{
        val value=try{ResourceJson.objectValue(bytes,cancelled)}catch(e:java.util.concurrent.CancellationException){throw e}catch(e:Exception){throw ResourcePackException(CODE,"pack.mcmeta",cause=e)}
        val pack=value.optJSONObject("pack");valid(pack!=null);pack!!
        val legacy=if(pack.has("pack_format"))integer(pack.get("pack_format"))else null
        val modern=pack.has("min_format")||pack.has("max_format");valid(!modern||(pack.has("min_format")&&pack.has("max_format")))
        val low=if(modern)bound(pack.get("min_format"),0)else null;val high=if(modern)bound(pack.get("max_format"),Int.MAX_VALUE)else null
        if(low!=null){valid(low<=high!!);valid(low.major>=65||legacy!=null)}else valid(legacy!=null)
        valid(pack.has("description"));val wrapped=JSONArray().put(pack.get("description")).toString();val description=wrapped.substring(1,wrapped.length-1)
        return ParsedResourceMetadata(ResourcePackMetadata(legacy?:high!!.major,description,low,high),overlays(value))
    }
    private fun overlays(root:JSONObject):List<ResourceOverlay>{
        if(!root.has("overlays"))return emptyList()
        val rows=root.optJSONObject("overlays")?.optJSONArray("entries");valid(rows!=null&&rows.length()<=64);rows!!
        val names=HashSet<String>();val values=ArrayList<ResourceOverlay>()
        repeat(rows.length()){i->val row=rows.optJSONObject(i);valid(row!=null);row!!
            val name=row.opt("directory");valid(name is String&&name.length in 1..64&&Regex("[a-z0-9_-]+").matches(name));name as String;valid(names.add(name))
            valid(row.has("min_format")==row.has("max_format"));val modern=row.has("min_format");val legacy=row.has("formats");valid(modern||legacy)
            var applies=true
            if(modern){val low=bound(row.get("min_format"),0);val high=bound(row.get("max_format"),Int.MAX_VALUE)
                valid(low<=high);valid(low.major>=65||legacy);applies=TARGET>=low&&TARGET<=high}
            if(legacy){val raw=row.get("formats");val pair=when(raw){
                is JSONArray->{valid(raw.length()==2);integer(raw.get(0)) to integer(raw.get(1))}
                is JSONObject->integer(raw.opt("min_inclusive")) to integer(raw.opt("max_inclusive"))
                else->integer(raw).let{it to it}
            };valid(pair.first<=pair.second);applies=applies&&TARGET.major in pair.first..pair.second}
            values+=ResourceOverlay(name,applies)
        };return Collections.unmodifiableList(values)
    }
    fun client():ResourcePackMetadata=ResourcePackMetadata(97,"{\"text\":\"Minecraft Java Edition 26.3 client assets\"}",TARGET,TARGET)
    fun isClient(bytes:ByteArray,cancelled:()->Boolean):Boolean=try{
        val v=ResourceJson.objectValue(bytes,cancelled);val p=v.optJSONObject("pack_version")
        v.opt("id")=="26.3"&&p?.opt("resource_major")==97.0&&p.opt("resource_minor")==1.0
    }catch(e:java.util.concurrent.CancellationException){throw e}catch(_:Exception){false}
}
