package com.blockcolc.preview.world

import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import com.blockcolc.presentation.WorldFacts
import com.blockcolc.world.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Verifies Point #8: both Single-Building backdrops (Maquette & Sky) respect
 * real/local/debug weather (including under ocean-island settlement!), debug
 * decay condition, and full restoration when debug overrides are turned off. */
class SingleBuildingWeatherAndDecayTest {
    private val now = DomainTime.millis("2026-11-28T04:00:00.000Z")

    private fun oceanWorldWithBuiltProject(): WorldFacts {
        var doc = DomainEngine.initial("Asia/Shanghai")
        doc = DomainEngine.execute(
            doc,
            DomainEngine.command(
                "CreateProject",
                "projectId" to "p1",
                "title" to "海岛工坊",
                "blueprintId" to "builtin-small-workshop",
                "subtasks" to JSONArray().put(JSONObject().put("id", "t1").put("title", "主体")),
            ),
            now,
        ).also { check(it.ok) }.state
        // Complete subtask so building is 100% built (making decay missing blocks & vines visible!)
        doc = DomainEngine.execute(doc, DomainEngine.command("StartFocus", "sessionId" to "s1", "projectId" to "p1", "subtaskId" to "t1", "plannedDurationMs" to 60_000L), now).also { check(it.ok) }.state
        doc = DomainEngine.execute(doc, DomainEngine.command("CompleteFocusEarly", "reportId" to "r1"), now + 10_000L).also { check(it.ok) }.state
        doc = DomainEngine.execute(doc, DomainEngine.command("ConfigureWorldEnvironment", "environmentStyle" to "ocean-island"), now + 20_000L).also { check(it.ok) }.state
        return WorldFacts.from(doc)
    }

    @Test fun singleBuildingSkyAndMaquetteApplyDebugWeatherDecayAndRestoreCleanlyUnderOceanSettlement() {
        val facts = oceanWorldWithBuiltProject()
        val builder = WorldPlanBuilder()
        val compiler = NativeWorldPacketCompiler()
        val id = WorldRequestIdentity("test-db", 0, 1)
        try {
            val normalInputs = NativeAtmosphereInputs(zone = "Asia/Shanghai", ocean = true)
            val normalFacts = normalInputs.sample(now)
            val stormDebug = NativeWorldDebug(enabled = true, weather = NativeDebugWeather.STORM, timeMinutes = 22 * 60, decayAmount = 0.75)
            val stormFacts = stormDebug.project(normalInputs).sample(now)
            val restoredDebug = stormDebug.copy(enabled = false)
            val restoredFacts = restoredDebug.project(normalInputs).sample(now)

            for (backdrop in listOf(SingleBuildingBackdrop.MAQUETTE, SingleBuildingBackdrop.SKY)) {
                val basePlan = builder.terrain(builder.prepare(facts, buildingCondition = null))
                val baseFrame = compiler.prepare(
                    id, basePlan,
                    WorldRenderOptions(now, zone = "Asia/Shanghai", quality = NativeLightingQuality.HIGH, atmosphere = normalFacts, narrative = WorldDisplayNarrative.SINGLE, singleBackdrop = backdrop, singleOwnerId = "p1"),
                )
                assertEquals(true, baseFrame.environmentContext.ocean)

                // Debug storm + night + 75% decay
                val decayPlan = builder.terrain(builder.prepare(facts, buildingCondition = stormDebug.buildingCondition))
                val stormFrame = compiler.prepare(
                    id, decayPlan,
                    WorldRenderOptions(now, zone = "Asia/Shanghai", quality = NativeLightingQuality.HIGH, atmosphere = stormFacts, narrative = WorldDisplayNarrative.SINGLE, singleBackdrop = backdrop, singleOwnerId = "p1"),
                )
                assertTrue("Backdrop $backdrop must adopt thunderstorm precipitation", stormFrame.precipitation.capacity > 0)
                assertTrue("Backdrop $backdrop must adopt thunderstorm flag", stormFrame.scene.environment.storm?.thunderstorm == true)
                assertTrue("Decay must create weathering > 0", decayPlan.input.buildings.first().recipe.weathering > 0.5)
                assertTrue("Decay must add vines", decayPlan.input.buildings.first().recipe.vines.isNotEmpty())
                // Plinth owner identity MUST remain unchanged between normal & decay so GPU performs clean local swap!
                val baseWorldId = baseFrame.scene.sources.first { it.owner == "world" }.ownerIdentity
                val stormWorldId = stormFrame.scene.sources.first { it.owner == "world" }.ownerIdentity
                assertEquals(baseWorldId, stormWorldId)

                // Turn debug OFF -> MUST restore clean building (weathering=0, vines empty) and normal atmosphere!
                assertNull(restoredDebug.buildingCondition)
                val restoredPlan = builder.terrain(builder.prepare(facts, buildingCondition = restoredDebug.buildingCondition))
                val restoredFrame = compiler.prepare(
                    id, restoredPlan,
                    WorldRenderOptions(now, zone = "Asia/Shanghai", quality = NativeLightingQuality.HIGH, atmosphere = restoredFacts, narrative = WorldDisplayNarrative.SINGLE, singleBackdrop = backdrop, singleOwnerId = "p1"),
                )
                assertEquals(0.0, restoredPlan.input.buildings.first().recipe.weathering, 1e-6)
                assertTrue(restoredPlan.input.buildings.first().recipe.vines.isEmpty())
                // Live atmosphere adopting on ocean-island single-building MUST succeed without throwing!
                val adopted = restoredFrame.environmentContext.adopting(stormFacts)
                assertEquals(NativeWeatherKind.RAIN, adopted.project(stormFacts).weather.kind)
                val adoptedBack = adopted.adopting(restoredFacts)
                assertEquals(restoredFacts.weather.kind, adoptedBack.project(restoredFacts).weather.kind)
            }
        } finally {
            compiler.close()
        }
    }
}
