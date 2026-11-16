package com.blockcolc.presentation

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.StrictJson
import org.json.JSONObject
import java.util.Collections

enum class WorldAssetKind { BUILTIN,EMBEDDED,HOLIDAY,BIRTHDAY }
data class WorldBlueprintReference(val id:String,val kind:WorldAssetKind,val embeddedCanonical:String?=null,val holidayId:String?=null,val year:Int?=null){
    init{require((kind==WorldAssetKind.EMBEDDED)==(embeddedCanonical!=null));require(kind!=WorldAssetKind.HOLIDAY||holidayId!=null&&year!=null);require(kind!=WorldAssetKind.BIRTHDAY||year!=null)}
    val sourceSha:String? by lazy{embeddedCanonical?.let(StrictJson::sha)}
}
data class WorldRewardFact(val rewardId:String,val resourceId:String,val date:String,val blueprint:WorldBlueprintReference,val localX:Double,val localZ:Double,val quarterTurns:Int)
data class WorldBuildingFact(val id:String,val title:String,val cycleNumber:Long?,val status:String,val kind:String,val active:Boolean,val settlementIndex:Long,
    val blueprint:WorldBlueprintReference,val completion:Int,val condition:Int,val decorationDates:List<String>,val rewards:List<WorldRewardFact>)

/** Business-to-world projection only. No layout, GPU work, location request or
 * second timer is allowed here. The host invokes it off the business writer;
 * this immutable request keeps each owner's embedded blueprint, not a mutable
 * global blueprint-ID override shared between different buildings. */
class WorldFacts private constructor(val activeProjectId:String?,val seed:String,val environment:String,val terrainVersion:Int,buildings:List<WorldBuildingFact>){
    val buildings:List<WorldBuildingFact> = Collections.unmodifiableList(buildings.toList())
    companion object {
        private fun <T> owned(values:List<T>):List<T> = Collections.unmodifiableList(values.toList())
        fun from(domain:DomainDocument):WorldFacts{
            val s=domain.projectionJson()
            fun rows(key:String)=s.getJSONArray(key).let{a->List(a.length()){a.getJSONObject(it)}}
            fun reference(owner:JSONObject,section:String):WorldBlueprintReference{
                val id=owner.getString("blueprintId")
                val embedded=owner.optJSONObject("importedBlueprint")
                return if(embedded==null)WorldBlueprintReference(id,WorldAssetKind.BUILTIN)else WorldBlueprintReference(id,WorldAssetKind.EMBEDDED,
                    checkNotNull(domain.blueprintCanonical(section,owner.getString("id"))))
            }
            val projects=rows("projects");val habits=rows("habitBuildings");val birthdays=rows("birthdayRewards");val holidays=rows("holidayRewards")
            val conditions=rows("projectConditions").associateBy{it.getString("projectId")}
            val decorations=rows("decorationRewards");val resources=rows("decorationBlueprintResources").associateBy{it.getString("id")}
            val plots=(projects.filter{it.getString("status")!="deleted"&&it.optJSONObject("habit")?.getBoolean("awaitingNextBuilding")!=true}.map{it.getLong("settlementIndex")}+
                habits.map{it.getLong("settlementIndex")}).sorted()
            val importedDates=decorations.map{it.getString("date")}.toSet()
            val projectAtCompletion=linkedMapOf<String,String>()
            for(session in rows("focusHistory"))if(session.getString("status")!="interrupted"){
                val completedAt=session.getString("completedAt")
                if(!projectAtCompletion.containsKey(completedAt))projectAtCompletion[completedAt]=session.getString("projectId")
            }
            val dates=linkedMapOf<String,MutableList<String>>()
            for(goal in rows("dailyGoals")){
                if(goal.isNull("reachedAt")||goal.getString("date")in importedDates)continue
                projectAtCompletion[goal.getString("reachedAt")]?.let{dates.getOrPut(it){arrayListOf()}.add(goal.getString("date"))}
            }
            fun keepsakes(plot:Long):List<WorldRewardFact>{
                val birthday= birthdays.mapIndexedNotNull{index,reward->
                    val original=if(reward.isNull("settlementIndex"))null else reward.getLong("settlementIndex")
                    val anchor=if(original!=null&&original in plots)original else plots.firstOrNull()
                    if(anchor!=plot)null else{
                        val year=reward.getInt("year");val id="builtin-birthday-cake-v1"
                        WorldRewardFact("birthday:$year",id,reward.getString("date"),WorldBlueprintReference(id,WorldAssetKind.BIRTHDAY,year=year),54+index*12.0,-54.0,0)
                    }
                }
                val seasonal=holidays.filter{it.getLong("settlementIndex")==plot}.map{reward->
                    val year=reward.getInt("year");val holiday=reward.getString("holidayId");val id="builtin-holiday-$holiday-v1";val position=reward.getJSONObject("position")
                    WorldRewardFact("holiday:$holiday:$year",id,reward.getString("date"),WorldBlueprintReference(id,WorldAssetKind.HOLIDAY,holidayId=holiday,year=year),position.getDouble("x"),position.getDouble("z"),reward.getInt("rotationQuarterTurns"))
                }
                return birthday+seasonal
            }
            val active=if(s.isNull("activeProjectId"))null else s.getString("activeProjectId")
            val result=ArrayList<WorldBuildingFact>()
            for(project in projects){
                if(project.getString("status")=="deleted"||project.optJSONObject("habit")?.getBoolean("awaitingNextBuilding")==true)continue
                val id=project.getString("id");val plot=project.getLong("settlementIndex")
                val rewards=decorations.filter{it.getString("projectId")==id}.mapNotNull{reward->
                    val resource=resources[reward.getString("resourceId")]?:return@mapNotNull null
                    val position=reward.getJSONObject("position");val resourceId=resource.getString("id")
                    WorldRewardFact("${reward.getString("date")}:$resourceId",resourceId,reward.getString("date"),WorldBlueprintReference(resourceId,WorldAssetKind.EMBEDDED,checkNotNull(domain.blueprintCanonical("decorationBlueprintResources",resourceId))),
                        position.getDouble("x"),position.getDouble("z"),reward.getInt("rotationQuarterTurns"))
                }
                result+=WorldBuildingFact(id,project.getString("title"),null,project.getString("status"),project.getString("kind"),id==active,plot,reference(project,"projects"),
                    DomainEngine.progress(project),conditions.getValue(id).getInt("conditionBasisPoints"),owned(dates[id].orEmpty()),owned(keepsakes(plot)+rewards))
            }
            for(habit in habits){
                val plot=habit.getLong("settlementIndex")
                result+=WorldBuildingFact(habit.getString("id"),habit.getString("habitTitle"),habit.getLong("cycleNumber"),"monument","habit",false,plot,reference(habit,"habitBuildings"),10000,10000,
                    owned(dates[habit.getString("id")].orEmpty()),owned(keepsakes(plot)))
            }
            val settings=s.getJSONObject("worldSettings")
            return WorldFacts(active,settings.getString("worldSeed"),settings.getString("environmentStyle"),settings.getInt("terrainGenerationVersion"),result)
        }
    }
}
