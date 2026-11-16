package com.blockcolc.preview.blueprints

import com.blockcolc.domain.DomainDocument
import com.blockcolc.world.generation.BuiltinBlueprintCatalog
import org.json.JSONObject
import java.util.Collections

data class NativeBlueprintItem(val id:String,val displayName:String,val description:String,val category:String,
    val localized:Boolean=false,val locked:Boolean=false,val canonical:String?=null,val voxelCount:Int=0,
    val width:Int=0,val depth:Int=0,val height:Int=0,val complexity:String="simple",val content:NativeBlueprintContent?=null) {
    val selectable get()=category in setOf("native","supplemental","user")&&!locked
    fun previewCanonical():String?=if(locked)null else canonical?:content?.read()
}

/** Library rows keep metadata until an actual preview/selection needs geometry.
 * The source is an immutable committed document, never a borrowed JSON tree. */
class NativeBlueprintContent(private val document:DomainDocument,private val section:String,private val id:String) {
    private val identity=document.sha256
    private val value=lazy{
        checkNotNull(document.blueprintCanonical(section,id))
    }
    val materialized get()=value.isInitialized()
    fun read():String=value.value
    override fun equals(other:Any?)=other is NativeBlueprintContent&&identity==other.identity&&section==other.section&&id==other.id
    override fun hashCode()=31*(31*identity.hashCode()+section.hashCode())+id.hashCode()
}
data class NativeBlueprintLibrary(val items:List<NativeBlueprintItem> = emptyList()) {
    val buildingCount get()=items.count{it.category=="user"}
    companion object {
        const val MAX_BUILDINGS=com.blockcolc.domain.MAX_BUILDING_BLUEPRINTS
        /** A read-only view of committed facts. Locked rewards expose neither
         * their actual name nor their geometry to the UI preview path. */
        fun from(document:DomainDocument,catalog:BuiltinBlueprintCatalog):NativeBlueprintLibrary = from(document.projectionJson(),catalog,document)
        fun from(state:JSONObject,catalog:BuiltinBlueprintCatalog,committed:DomainDocument?=null):NativeBlueprintLibrary {
            fun rows(key:String)=state.getJSONArray(key).let{a->List(a.length()){a.getJSONObject(it)}}
            fun voxelCount(body:JSONObject)=if(committed==null)body.getJSONArray("voxels").length()else body.optJSONArray("voxels")?.length()?:body.getInt("voxelCount")
            val unlocked=rows("holidayRewards").map{it.getString("holidayId")}.toSet()
            val birthday=rows("birthdayRewards").isNotEmpty()
            val dailyIds=rows("decorationBlueprintResources").map{it.getString("id")}.toSet()
            val result=catalog.entries.filter{it.category in setOf("native","supplemental","holiday","birthday")||it.category=="daily"&&it.id !in dailyIds}.map{e->
                val holidayId=e.holidayId
                val locked=e.category=="holiday"&&(holidayId==null||holidayId !in unlocked)||e.category=="birthday"&&!birthday
                NativeBlueprintItem(e.id,if(locked)"???" else e.displayName,
                    if(locked&&e.category=="holiday")"也许在某些特定节日启动方块钟会发现它" else e.description,e.category,true,locked,voxelCount=if(locked)0 else e.voxelCount,
                    width=if(locked)0 else (e.bounds.maxX-e.bounds.minX+1).toInt(),depth=if(locked)0 else (e.bounds.maxZ-e.bounds.minZ+1).toInt(),height=if(locked)0 else (e.bounds.maxY-e.bounds.minY+1).toInt(),complexity=e.complexity)
            }.toMutableList()
            result+=rows("buildingBlueprintResources").map{r->val b=r.getJSONObject("blueprint");val box=b.getJSONObject("bounds");val count=voxelCount(b)
                NativeBlueprintItem(r.getString("id"),r.getString("displayName"),"本机导入的建筑图纸","user",canonical=if(committed==null)b.toString()else null,voxelCount=count,
                    width=(box.getLong("maxX")-box.getLong("minX")+1).toInt(),depth=(box.getLong("maxZ")-box.getLong("minZ")+1).toInt(),height=(box.getLong("maxY")-box.getLong("minY")+1).toInt(),
                    complexity=if(count<1000)"simple"else if(count<4000)"moderate"else "detailed",content=committed?.let{NativeBlueprintContent(it,"buildingBlueprintResources",r.getString("id"))})}
            result+=rows("decorationBlueprintResources").map{r->val b=r.getJSONObject("blueprint");val e=catalog.find(r.getString("id"))
                NativeBlueprintItem(r.getString("id"),e?.displayName?:b.getString("title"),e?.description?:"完成每日目标可获得","daily",e!=null,canonical=if(committed==null)b.toString()else null,voxelCount=voxelCount(b),content=committed?.let{NativeBlueprintContent(it,"decorationBlueprintResources",r.getString("id"))})}
            return NativeBlueprintLibrary(Collections.unmodifiableList(result))
        }
        fun importedSnapshot(raw:JSONObject):JSONObject {
            val voxels=raw.getJSONArray("voxels")
            for(i in 0 until voxels.length()){val v=voxels.getJSONObject(i);val order=v.getInt("buildOrder")
                v.put("stage",when{order<1800->"foundation";order<3800->"frame";order<6500->"walls";order<8800->"roof";else->"details"})}
            return raw
        }
    }
}
