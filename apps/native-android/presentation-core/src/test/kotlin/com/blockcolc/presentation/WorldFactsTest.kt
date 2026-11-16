package com.blockcolc.presentation

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.StrictJson
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class WorldFactsTest {
    companion object {
        private val oracle by lazy { JSONObject(WorldFactsTest::class.java.getResource("/world-projection-oracle.json")!!.readText()) }
        private val corpus by lazy { JSONObject(WorldFactsTest::class.java.getResource("/command-oracle.json")!!.readText()).getJSONArray("cases") }
    }

    private fun WorldBlueprintReference.json()=JSONObject().put("id",id).put("kind",kind.name)
        .put("embeddedCanonical",embeddedCanonical?:JSONObject.NULL).put("holidayId",holidayId?:JSONObject.NULL).put("year",year?:JSONObject.NULL)

    private fun input(testCase:JSONObject)=if(testCase.isNull("caseIndex"))testCase.getString("inputCanonical")
        else corpus.getJSONObject(testCase.getInt("caseIndex")).getString("canonical")

    private fun WorldFacts.json()=JSONObject().put("activeProjectId",activeProjectId?:JSONObject.NULL).put("seed",seed)
        .put("environment",environment).put("terrainVersion",terrainVersion).put("buildings",JSONArray(buildings.map { building ->
            JSONObject().put("id",building.id).put("title",building.title).put("cycleNumber",building.cycleNumber?:JSONObject.NULL)
                .put("status",building.status).put("kind",building.kind).put("active",building.active).put("settlementIndex",building.settlementIndex)
                .put("blueprint",building.blueprint.json()).put("completion",building.completion).put("condition",building.condition)
                .put("decorationDates",JSONArray(building.decorationDates)).put("rewards",JSONArray(building.rewards.map { reward ->
                    JSONObject().put("rewardId",reward.rewardId).put("resourceId",reward.resourceId).put("date",reward.date)
                        .put("blueprint",reward.blueprint.json()).put("localX",reward.localX).put("localZ",reward.localZ).put("quarterTurns",reward.quarterTurns)
                }))
        }))

    @Test fun sourceFingerprintsMatchTheFormalProjectionAndCommandHistory() {
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first { File(it,"packages/application/src/model.ts").isFile }
        val hashes=oracle.getJSONObject("sourceHashes")
        for(name in hashes.keys()) {
            val hash=MessageDigest.getInstance("SHA-256").digest(File(root,name).readBytes()).joinToString(""){"%02x".format(it.toInt() and 255)}
            assertEquals("Stale world projection oracle: $name",hashes.getString(name),hash)
        }
    }

    @Test fun currentTasksHabitMonumentsAndIndependentRewardsMatchTheRealApplication() {
        val cases=oracle.getJSONArray("cases")
        assertTrue(cases.length()>300)
        var monuments=0;var rewards=0;var embedded=0
        for(index in 0 until cases.length()) {
            val expected=JSONObject(cases.getJSONObject(index).toString())
            val name=expected.getString("name")
            val document=DomainDocument.parse(input(expected))
            expected.remove("caseIndex");expected.remove("name");expected.remove("inputCanonical")
            val before=document.canonical
            val actual=WorldFacts.from(document)
            assertEquals(name,StrictJson.render(expected),StrictJson.render(actual.json()))
            assertEquals(before,document.canonical)
            monuments+=actual.buildings.count{it.status=="monument"}
            rewards+=actual.buildings.sumOf{it.rewards.size}
            embedded+=actual.buildings.count{it.blueprint.kind==WorldAssetKind.EMBEDDED}
        }
        assertTrue("Habit monuments must be covered",monuments>0)
        assertTrue("Reward history must be covered",rewards>0)
        assertTrue("Owner-specific embedded blueprints must be covered",embedded>0)
    }

    @Test fun projectedCollectionsDoNotExposeMutableDomainOrCrossOwnerBlueprintOverrides() {
        val cases=oracle.getJSONArray("cases")
        var checked=false;var distinctOwnerSources=false
        for(index in 0 until cases.length()) {
            val document=DomainDocument.parse(input(cases.getJSONObject(index)))
            val facts=WorldFacts.from(document)
            if(facts.buildings.isEmpty())continue
            assertThrows(UnsupportedOperationException::class.java){(facts.buildings as MutableList).clear()}
            val building=facts.buildings.first()
            assertThrows(UnsupportedOperationException::class.java){(building.rewards as MutableList).clear()}
            assertThrows(UnsupportedOperationException::class.java){(building.decorationDates as MutableList).clear()}
            val copy=document.json();val projects=copy.getJSONArray("projects")
            if(projects.length()>0)projects.getJSONObject(0).put("title","outside mutation")
            assertNotEquals("outside mutation",facts.buildings.first().title)
            for(owner in facts.buildings.filter{it.blueprint.kind==WorldAssetKind.EMBEDDED}) {
                val reference=owner.blueprint
                assertEquals(StrictJson.sha(reference.embeddedCanonical!!),reference.sourceSha)
                val original=document.json()
                val field=if(owner.cycleNumber!=null)"habitBuildings" else "projects"
                val rows=original.getJSONArray(field)
                val saved=(0 until rows.length()).map{rows.getJSONObject(it)}.first{it.getString("id")==owner.id}
                assertEquals(StrictJson.render(saved.getJSONObject("importedBlueprint")),reference.embeddedCanonical)
            }
            if(facts.buildings.groupBy{it.blueprint.id}.values.any { owners ->
                owners.mapNotNull{it.blueprint.sourceSha}.distinct().size>1
            })distinctOwnerSources=true
            checked=true
        }
        assertTrue(checked)
        assertTrue("A catalog entry cannot overwrite two different saved owner sources",distinctOwnerSources)
    }
}
