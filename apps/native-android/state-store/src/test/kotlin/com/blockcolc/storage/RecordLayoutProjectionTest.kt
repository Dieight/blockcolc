package com.blockcolc.storage

import com.blockcolc.domain.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RecordLayoutProjectionTest {
    @Test fun headerBasedSplittingRetainsEveryFullCanonicalBlueprintAndRoundTripsFormalStates(){
        val cases=JSONObject(javaClass.getResource("/state-oracle.json")!!.readText()).getJSONArray("cases")
        var blueprints=0
        for(i in 0 until cases.length()){
            val case=cases.getJSONObject(i);if(!case.getBoolean("ok"))continue
            val doc=DomainDocument.parse(case.getString("canonical"));val full=doc.json()
            val expected=linkedMapOf<String,String>()
            for((section,slot)in listOf("projects" to "importedBlueprint","habitBuildings" to "importedBlueprint",
                "buildingBlueprintResources" to "blueprint","decorationBlueprintResources" to "blueprint")){
                val rows=full.getJSONArray(section)
                for(j in 0 until rows.length())if(!rows.getJSONObject(j).isNull(slot)){
                    val body=StrictJson.render(rows.getJSONObject(j).getJSONObject(slot))
                    expected[StrictJson.sha(body)]=body;blueprints++
                }
            }
            val split=RecordLayout.split(doc)
            assertEquals(case.getString("name"),expected,split.assets)
            val ordered=split.records.sortedWith(compareBy<StateRecord>{it.section}.thenBy{it.ordinal})
            assertEquals(case.getString("name"),doc.canonical,RecordLayout.checkpointParts(split.values,ordered,split.assets).joinToString(""))
            assertEquals(doc,RecordLayout.join(split.values,split.records){sha->split.assets.getValue(sha)})
        }
        assertTrue("The formal inputs must cover embedded blueprints",blueprints>0)
    }
}
