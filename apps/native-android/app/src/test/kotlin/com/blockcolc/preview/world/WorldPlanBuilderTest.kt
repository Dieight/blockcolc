package com.blockcolc.preview.world

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import com.blockcolc.presentation.WorldFacts
import com.blockcolc.world.generation.WorldEnvironment
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CancellationException

class WorldPlanBuilderTest {
    private val now=DomainTime.millis("2026-10-25T08:00:00.000Z")
    private fun apply(state:DomainDocument,type:String,vararg fields:Pair<String,Any?>,at:Long=now):DomainDocument {
        val result=DomainEngine.execute(state,DomainEngine.command(type,*fields),at)
        assertTrue("$type: ${result.error}",result.ok);return result.state
    }
    private fun small(material:String)=JSONObject().put("schemaVersion",1).put("id","shared-import").put("title","Saved building")
        .put("bounds",JSONObject().put("minX",0).put("maxX",1).put("minY",0).put("maxY",1).put("minZ",0).put("maxZ",0))
        .put("voxels",JSONArray().put(JSONObject().put("x",0).put("y",0).put("z",0).put("materialId","stone").put("stage","foundation").put("buildOrder",0))
            .put(JSONObject().put("x",1).put("y",1).put("z",0).put("materialId",material).put("stage","walls").put("buildOrder",4000)))
    private fun populated():DomainDocument {
        var state=DomainEngine.initial("UTC")
        for((id,material)in listOf("a" to "wood","b" to "glass"))state=apply(state,"CreateProject","projectId" to id,"title" to id,"blueprintId" to "shared-import",
            "importedBlueprint" to small(material),"subtasks" to JSONArray().put(JSONObject().put("id","t-$id").put("title","Task $id")))
        return state
    }

    @Test fun allFormalSnapshotsProducePlansFromRealOwnerSourcesAndQualifiedRewards() {
        val oracle=JSONObject(javaClass.getResource("/world-projection-oracle.json")!!.readText()).getJSONArray("cases")
        val commands=JSONObject(javaClass.getResource("/command-oracle.json")!!.readText()).getJSONArray("cases")
        val builder=WorldPlanBuilder();var buildings=0;var rewards=0;val environments=mutableSetOf<WorldEnvironment>()
        for(index in 0 until oracle.length()) {
            val input=oracle.getJSONObject(index)
            val canonical=if(input.isNull("caseIndex"))input.getString("inputCanonical")else commands.getJSONObject(input.getInt("caseIndex")).getString("canonical")
            val facts=WorldFacts.from(DomainDocument.parse(canonical));val plan=builder.prepare(facts)
            assertSame(facts,plan.facts);assertEquals(facts.buildings.size,plan.buildings.size)
            assertEquals(facts.buildings.map{it.settlementIndex},plan.spatial.village.placements.map{it.settlementIndex})
            assertEquals(facts.buildings.sumOf{it.rewards.size},plan.rewards.size)
            assertEquals(facts.buildings.size,plan.spatial.village.pads.size)
            assertEquals(plan.spatial.roads.size,plan.spatial.roadGeometry.cellCount)
            for(building in plan.buildings) {
                assertEquals(building.fact.settlementIndex,building.placement.settlementIndex)
                assertEquals(building.blueprint.geometrySha,building.recipe.blueprintGeometrySha)
                assertTrue(building.recipe.intact.all{it.buildOrder<=building.fact.completion})
                assertEquals(building.recipe.key,building.originalGeometry.inputKey)
                assertEquals(building.recipe.intact.size,building.originalGeometry.sourceCount)
                if(plan.spatial.environment==WorldEnvironment.OCEAN)assertTrue(building.placement.worldPosition.y>=4)
            }
            for(reward in plan.rewards) {
                assertEquals(reward.fact.rewardId,reward.horizontalPlacement.input.rewardId)
                assertTrue(reward.recipe.missing.isEmpty());assertTrue(reward.recipe.vines.isEmpty())
                assertEquals(reward.blueprint.id,reward.fact.blueprint.id)
                assertEquals(reward.recipe.key,reward.originalGeometry.inputKey)
            }
            buildings+=plan.buildings.size;rewards+=plan.rewards.size;environments+=plan.spatial.environment
        }
        assertTrue(buildings>1200);assertTrue(rewards>400);assertEquals(4,environments.size)
        builder.clear()
    }

    @Test fun noteTitleAndSelectionReuseSpatialWorkAndOnlyTheAdvancedOwnerGetsANewRecipe() {
        var state=populated();val builder=WorldPlanBuilder();val first=builder.prepare(WorldFacts.from(state));val firstTerrain=builder.terrain(first)
        assertTrue(firstTerrain.terrain.cellCount>1000)
        assertEquals(4.0,firstTerrain.surfaces.sample(0.0,0.0)!!.supportY,0.0)
        assertNotEquals(first.buildings[0].blueprint.geometrySha,first.buildings[1].blueprint.geometrySha)
        state=apply(state,"RenameProject","title" to "Renamed B")
        state=apply(state,"AddQuickNote","noteId" to "n","text" to "Independent note")
        state=apply(state,"SwitchActiveProject","projectId" to "a")
        val metadata=builder.prepare(WorldFacts.from(state))
        assertSame(first.spatial,metadata.spatial)
        val metadataTerrain=builder.terrain(metadata);assertSame(firstTerrain.terrain,metadataTerrain.terrain);assertSame(firstTerrain.surfaces,metadataTerrain.surfaces)
        assertSame(firstTerrain.scenery,metadataTerrain.scenery);assertEquals(SceneryReuse.MEMORY,metadataTerrain.sceneryReuse)
        for(index in first.buildings.indices){assertSame(first.buildings[index].recipe,metadata.buildings[index].recipe);assertSame(first.buildings[index].originalGeometry,metadata.buildings[index].originalGeometry)}
        assertEquals("Renamed B",metadata.buildings.first{it.fact.id=="b"}.fact.title)
        state=apply(state,"StartFocus","sessionId" to "s","subtaskId" to "t-a","plannedDurationMs" to 1000)
        state=apply(state,"CompleteFocus",at=now+1000)
        state=apply(state,"ReportSubtaskProgress","reportId" to "r","subtaskId" to "t-a","focusSessionIds" to JSONArray(listOf("s")),"progressBasisPoints" to 5000,at=now+1000)
        val progressed=builder.prepare(WorldFacts.from(state))
        val progressedTerrain=builder.terrain(progressed)
        assertSame(firstTerrain.terrain,progressedTerrain.terrain);assertSame(firstTerrain.scenery,progressedTerrain.scenery)
        assertSame(metadata.spatial,progressed.spatial)
        assertNotSame(metadata.buildings[0].recipe,progressed.buildings[0].recipe)
        assertSame(metadata.buildings[1].recipe,progressed.buildings[1].recipe)
        assertNotSame(metadata.buildings[0].originalGeometry,progressed.buildings[0].originalGeometry)
        assertSame(metadata.buildings[1].originalGeometry,progressed.buildings[1].originalGeometry)
        assertEquals(2,progressed.buildings[0].recipe.intact.size)
        state=apply(state,"ConfigureWorldEnvironment","environmentStyle" to "natural-valley",at=now+1000)
        val environment=builder.prepare(WorldFacts.from(state))
        assertNotSame(progressed.spatial,environment.spatial)
        val valley=builder.terrain(environment);assertNotSame(firstTerrain.terrain,valley.terrain)
        assertNotSame(firstTerrain.scenery,valley.scenery);assertNotEquals(firstTerrain.sceneryKey,valley.sceneryKey)
        val coarse=builder.terrain(environment,WorldTerrainOptions(refinedFar=false));assertNotSame(valley.terrain,coarse.terrain)
        assertEquals(environment.spatial.village.placements,valley.input.spatial.village.placements)
        for(index in progressed.buildings.indices){assertSame(progressed.buildings[index].recipe,environment.buildings[index].recipe);assertSame(progressed.buildings[index].originalGeometry,environment.buildings[index].originalGeometry)}
    }

    @Test fun cancellationOrBadSourcesCannotPublishAPartialPlanOrMutateAnOlderOne() {
        val real=NativeBlueprintSources();var fail=false
        val builder=WorldPlanBuilder(BlueprintSources { reference,reward,cancelled -> if(fail)throw IllegalArgumentException("Bad asset")else real.resolve(reference,reward,cancelled) })
        val facts=WorldFacts.from(populated());val initial=builder.prepare(facts)
        val initialTerrain=builder.terrain(initial)
        fail=true;assertThrows(IllegalArgumentException::class.java){builder.prepare(facts)}
        fail=false
        var checks=0;assertThrows(CancellationException::class.java){builder.prepare(facts){++checks>4}}
        val after=builder.prepare(facts);assertSame(initial.spatial,after.spatial)
        var terrainChecks=0
        assertThrows(CancellationException::class.java){builder.terrain(after,WorldTerrainOptions(minimumRadius=com.blockcolc.world.generation.Position2(64.0,64.0))){++terrainChecks>10}}
        val recovered=builder.terrain(after)
        assertEquals(initialTerrain.cacheKey,recovered.cacheKey)
        assertEquals(initialTerrain.terrain.positions(),recovered.terrain.positions())
        for(index in initial.buildings.indices)assertSame(initial.buildings[index].recipe,after.buildings[index].recipe)
        assertThrows(UnsupportedOperationException::class.java){(initial.buildings as MutableList).clear()}
        assertThrows(UnsupportedOperationException::class.java){(initial.rewards as MutableList).clear()}
        assertEquals(2,initial.buildings.size)
    }
}
