package com.blockcolc.preview.world

import com.blockcolc.domain.StrictJson
import com.blockcolc.presentation.WorldBuildingFact
import com.blockcolc.presentation.WorldFacts
import com.blockcolc.presentation.WorldRewardFact
import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.Collections
import java.util.concurrent.CancellationException

data class PreparedBuilding(val fact:WorldBuildingFact,val blueprint:BlueprintSnapshot,val placement:VillagePlacement,val recipe:BuildingInputRecipe,val originalGeometry:OriginalStructure)

/** x/z placement only. A subsequent terrain stage must lift rewards with the
 * actual surface sampler and create bottom support; the legacy y here is not
 * an adopted render transform and must never become a terrain-flattening pad. */
data class RewardBeforeTerrain(val fact:WorldRewardFact,val blueprint:BlueprintSnapshot,val horizontalPlacement:DecorationPlacement,val recipe:BuildingInputRecipe,val originalGeometry:OriginalStructure)

class WorldSpatialPlan internal constructor(val key:String,val environment:WorldEnvironment,val village:SupportedVillage,roads:List<RoadCell>,val roadGeometry:RoadGeometry) {
    val roads:List<RoadCell> = Collections.unmodifiableList(roads.toList())
}

/** CPU planning result, not a completed terrain mesh or ready GPU scene. */
class WorldCpuPlan internal constructor(val facts:WorldFacts,val spatial:WorldSpatialPlan,buildings:List<PreparedBuilding>,rewards:List<RewardBeforeTerrain>) {
    val buildings:List<PreparedBuilding> = Collections.unmodifiableList(buildings.toList())
    val rewards:List<RewardBeforeTerrain> = Collections.unmodifiableList(rewards.toList())
}

data class WorldTerrainOptions(val minimumRadius:Position2?=null,val refinedFar:Boolean?=null,val rendering:WorldRenderOptions?=null,val buildingCondition:Int?=null,
    val resourceSelection:com.blockcolc.preview.resources.ResourceWorldSelection?=null) {
    init {require(buildingCondition==null||buildingCondition in 0..10000)}
}
data class PreparedReward(val source:RewardBeforeTerrain,val support:SupportedDecoration)
class WorldTerrainPlan internal constructor(val input:WorldCpuPlan,val terrain:TerrainMesh,val surfaces:TerrainSurfaceTable,rewards:List<PreparedReward>,val reuse:TerrainReuse,val cacheKey:String,
    val scenery:WorldScenery,val sceneryKey:String,val sceneryReuse:SceneryReuse) {
    val rewards:List<PreparedReward> = Collections.unmodifiableList(rewards.toList())
}

/** Application adapter from business facts to engine-independent generation.
 * Run on its dedicated worker, never on the single database writer or in a
 * Composable. It neither reads storage nor creates GPU resources. */
class WorldPlanBuilder(private val sources:BlueprintSources=NativeBlueprintSources(),private val recipes:BuildingRecipeCache=BuildingRecipeCache(),
    private val terrainCache:TerrainCachePort?=null,private val sceneryCache:SceneryCachePort?=null,private val structures:OriginalStructureCache=OriginalStructureCache()) {
    private var lastSpatial:WorldSpatialPlan?=null
    private data class CachedTerrain(val key:String,val terrain:TerrainMesh,val surfaces:TerrainSurfaceTable)
    private var lastTerrain:CachedTerrain?=null
    private data class CachedScenery(val key:String,val scenery:WorldScenery)
    private var lastScenery:CachedScenery?=null
    private fun checkpoint(cancelled:()->Boolean) {
        if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("World planning superseded")
    }

    fun prepare(facts:WorldFacts,buildingCondition:Int?=null,cancelled:()->Boolean={false}):WorldCpuPlan {
        require(buildingCondition==null||buildingCondition in 0..10000)
        checkpoint(cancelled)
        require(facts.terrainVersion==4){"Only the current V4 world generator is supported"}
        val environment=WorldEnvironment.fromWire(facts.environment)
        val blueprints=linkedMapOf<String,BlueprintSnapshot>()
        val rewardInputs=ArrayList<Triple<WorldBuildingFact,WorldRewardFact,BlueprintSnapshot>>()
        com.blockcolc.preview.NativeStartupTrace.measure("layout-sources"){
        for(building in facts.buildings) {
            checkpoint(cancelled)
            require(!blueprints.containsKey(building.id)){"Duplicate world owner"}
            blueprints[building.id]=sources.resolve(building.blueprint,false,cancelled)
            for(reward in building.rewards) {
                checkpoint(cancelled)
                rewardInputs+=Triple(building,reward,sources.resolve(reward.blueprint,true,cancelled))
            }
        }
        }
        require(rewardInputs.map{it.second.rewardId}.distinct().size==rewardInputs.size){"Duplicate reward owner"}
        // Support-field ties deliberately prefer later rectangles. Preserve
        // the formal projection order (including appended habit monuments).
        val ordered=facts.buildings
        val input=JSONObject().put("revision",1).put("environment",facts.environment).put("seed",facts.seed).put("terrainVersion",facts.terrainVersion)
            .put("plots",JSONArray(ordered.map { building ->
                val b=blueprints.getValue(building.id).bounds
                JSONObject().put("id",building.id).put("index",building.settlementIndex).put("minX",b.minX).put("maxX",b.maxX).put("minZ",b.minZ).put("maxZ",b.maxZ)
            }))
        val key=StrictJson.sha(StrictJson.render(input))
        val spatial=lastSpatial?.takeIf{it.key==key}?:run {
            val placements=VillageLayout.generate(ordered.map{VillageInput(it.settlementIndex,blueprints.getValue(it.id).bounds.footprint)},cancelled)
            val supported=SettlementSupport.align(placements,environment,cancelled)
            val roads=VillageLayout.roads(supported.placements,cancelled)
            WorldSpatialPlan(key,environment,supported,roads,SettlementSupport.roads(roads,supported.placements,supported.pads,environment,cancelled))
        }
        val byIndex=spatial.village.placements.associateBy{it.settlementIndex}
        val owners=linkedSetOf<String>()
        val buildings=com.blockcolc.preview.NativeStartupTrace.measure("layout-buildings"){facts.buildings.map { fact ->
            checkpoint(cancelled)
            val owner="building:${fact.id}";owners+=owner
            val blueprint=blueprints.getValue(fact.id)
            val recipe=com.blockcolc.preview.NativeStartupTrace.measure("layout-building-recipe"){recipes.prepare(owner,blueprint,fact.id,fact.completion,buildingCondition?:fact.condition,cancelled)}
            val origin=blueprint.bounds.let{BlockPoint(it.minX.toDouble(),it.minY.toDouble(),it.minZ.toDouble())}
            val geometry=com.blockcolc.preview.NativeStartupTrace.measure("layout-building-geometry"){structures.prepare(owner,recipe,origin,cancelled)}
            PreparedBuilding(fact,blueprint,byIndex.getValue(fact.settlementIndex),recipe,geometry)
        }}
        val horizontal=VillageLayout.decorations(rewardInputs.map { (building,reward,blueprint) ->
            DecorationInput(reward.rewardId,reward.resourceId,reward.date,building.id,blueprint.bounds.footprint,Position2(reward.localX,reward.localZ),reward.quarterTurns)
        },facts.buildings.map{DecorationHost(it.id,byIndex.getValue(it.settlementIndex))},spatial.roads,cancelled).associateBy{it.input.rewardId}
        val rewards=com.blockcolc.preview.NativeStartupTrace.measure("layout-rewards"){rewardInputs.map { (_,fact,blueprint) ->
            checkpoint(cancelled)
            val owner="reward:${fact.rewardId}";owners+=owner
            val recipe=recipes.prepare(owner,blueprint,owner,10000,10000,cancelled)
            val origin=blueprint.bounds.let{BlockPoint(it.minX.toDouble(),it.minY.toDouble(),it.minZ.toDouble())}
            RewardBeforeTerrain(fact,blueprint,horizontal.getValue(fact.rewardId),recipe,structures.prepare(owner,recipe,origin,cancelled))
        }}
        checkpoint(cancelled)
        val result=WorldCpuPlan(facts,spatial,buildings,rewards)
        recipes.retainOwners(owners);structures.retainOwners(owners);lastSpatial=spatial
        return result
    }

    fun terrain(input:WorldCpuPlan,options:WorldTerrainOptions=WorldTerrainOptions(),cancelled:()->Boolean={false}):WorldTerrainPlan {
        checkpoint(cancelled)
        val p=input.spatial.village
        val generatorOptions=TerrainOptions(input.spatial.environment,input.facts.seed,input.facts.terrainVersion,options.refinedFar)
        val key=TerrainInputKey.key(p.placements,input.spatial.roads,p.pads,options.minimumRadius,generatorOptions)
        var reuse=TerrainReuse.MEMORY
        val cached=lastTerrain?.takeIf{it.key==key}?:run {
            // These are optional CPU caches, not the displayed GPU scene.
            // Retiring the previous environment here avoids retaining two
            // full terrains while preparing a replacement. Failure still
            // leaves the renderer's last published world intact.
            lastTerrain=null;lastScenery=null
            val restored=try{terrainCache?.read(key,cancelled)}catch(_:CancellationException){checkpoint(cancelled);null}catch(_:Exception){null}
            checkpoint(cancelled)
            reuse=if(restored==null)TerrainReuse.GENERATED else TerrainReuse.PERSISTENT
            val terrain=(restored?:SteppedTerrain.generate(p.placements,input.spatial.roads,p.pads,options.minimumRadius,generatorOptions,cancelled)).inNativeStorage(cancelled)
            CachedTerrain(key,terrain,TerrainSurfaceTable.from(terrain,cancelled))
        }
        val rewards=input.rewards.map{reward->checkpoint(cancelled);PreparedReward(reward,DecorationSupport.place(reward.horizontalPlacement,reward.blueprint,cached.surfaces,cancelled))}
        val protected=input.buildings.map{it.placement.let{p->SceneryRect(p.worldPosition.x,p.worldPosition.z,p.footprint.width+5,p.footprint.depth+5)}}+
            rewards.map{it.support.placement.let{p->SceneryRect(p.worldPosition.x,p.worldPosition.z,p.footprint.width+5,p.footprint.depth+5)}}
        val sceneryInput=WorldSceneryInput(input.spatial.environment,input.facts.seed,cached.surfaces,protected,input.spatial.roads,cached.terrain.naturalTrees,cached.terrain.nearDetailBounds,
            maxOf(kotlin.math.abs(cached.terrain.framingBounds.minX),kotlin.math.abs(cached.terrain.framingBounds.maxX)))
        val sceneryKey=SceneryInputKey.key(key,sceneryInput);var sceneryReuse=SceneryReuse.MEMORY
        // A newly earned reward changes exclusion areas without changing the
        // terrain. Retire the optional old CPU scenery before rebuilding it,
        // as on terrain replacement; the displayed GPU scene stays resident.
        // Keeping both complete reefs here can exhaust a small Android heap.
        if(lastScenery?.key!=sceneryKey)lastScenery=null
        val scenery=lastScenery?:run {
            val restored=try{sceneryCache?.readScenery(sceneryKey,cancelled)}catch(_:CancellationException){checkpoint(cancelled);null}catch(_:Exception){null}
            checkpoint(cancelled);sceneryReuse=if(restored==null)SceneryReuse.GENERATED else SceneryReuse.PERSISTENT
            CachedScenery(sceneryKey,restored?:WorldSceneryPlanner.plan(sceneryInput,cancelled))
        }
        checkpoint(cancelled)
        val result=WorldTerrainPlan(input,cached.terrain,cached.surfaces,rewards,reuse,key,scenery.scenery,sceneryKey,sceneryReuse)
        lastTerrain=cached;lastScenery=scenery
        if(reuse==TerrainReuse.GENERATED)try{terrainCache?.write(key,cached.terrain)}catch(_:Exception){/* Optional cache cannot fail a live world. */}
        if(sceneryReuse==SceneryReuse.GENERATED)try{sceneryCache?.writeScenery(sceneryKey,scenery.scenery)}catch(_:Exception){/* Same optional derived-only contract. */}
        checkpoint(cancelled)
        return result
    }

    fun clear(){lastSpatial=null;lastTerrain=null;lastScenery=null;structures.clear();recipes.clear();sources.clear()}
}
