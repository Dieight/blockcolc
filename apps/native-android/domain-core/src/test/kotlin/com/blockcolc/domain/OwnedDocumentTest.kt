package com.blockcolc.domain

import org.junit.Assert.*
import org.junit.Test

class OwnedDocumentTest {
    @Test fun mutableNumbersCannotChangeASmallDocumentSnapshot(){
        val source=DomainEngine.initial().json();val number=java.util.concurrent.atomic.AtomicInteger(15);source.put("schemaVersion",number)
        val doc=DomainDocument.fromOwnedJson(source);number.set(999)
        assertEquals(15,doc.json().getInt("schemaVersion"));assertEquals(doc,DomainDocument.parse(doc.canonical))
        val outward=doc.json();val mutable=java.util.concurrent.atomic.AtomicInteger(999);outward.put("schemaVersion",mutable);mutable.set(3)
        assertEquals(15,doc.json().getInt("schemaVersion"))
    }
    @Test fun smallDocumentsCopyAPrivateSnapshotWithoutReparsingOrSharingChildren(){
        val original=DomainEngine.initial("Asia/Shanghai");val source=original.json()
        val doc=DomainDocument.fromJson(source);source.getJSONObject("calendar").put("timeZone","UTC")
        var parses=0
        PipelineCost.collect({name,_,_,_->if(name=="json.parse")parses++}){
            val first=doc.json();first.getJSONObject("calendar").getJSONArray("restWeekdays").put(2)
            first.getJSONObject("worldSettings").put("worldSeed","changed")
            assertEquals(original,DomainDocument.fromJson(doc.json()))
        }
        assertEquals(0,parses);assertEquals(original.sha256,doc.sha256)
    }
    @Test fun largeDocumentsDoNotRetainAnExtraParsedArchive(){
        val source=DomainEngine.initial().json();source.getJSONObject("worldSettings").put("worldSeed","x".repeat(DomainDocument.SNAPSHOT_CHARACTERS+1))
        val doc=DomainDocument.fromOwnedJson(source);source.getJSONObject("worldSettings").put("worldSeed","mutated")
        var parses=0
        PipelineCost.collect({name,_,_,_->if(name=="json.parse")parses++}){
            assertTrue(doc.json().getJSONObject("worldSettings").getString("worldSeed").length>DomainDocument.SNAPSHOT_CHARACTERS)
            doc.json().getJSONArray("projects").put("bad")
        }
        assertEquals(2,parses);assertEquals(doc,DomainDocument.parse(doc.canonical))
    }
    @Test fun aNormalCatalogueSizedDocumentStillUsesDetachedSnapshotCopies(){
        val source=DomainEngine.initial().json()
        source.getJSONObject("worldSettings").put("worldSeed","catalogue-seed".repeat(9000))
        val doc=DomainDocument.fromOwnedJson(source)
        assertTrue(doc.canonical.length in 100000..200000)
        var parses=0
        PipelineCost.collect({name,_,_,_->if(name=="json.parse")parses++}){
            val first=doc.json();first.getJSONObject("worldSettings").put("worldSeed","changed")
            assertNotEquals("changed",doc.json().getJSONObject("worldSettings").getString("worldSeed"))
        }
        assertEquals(0,parses)
        source.getJSONObject("calendar").put("timeZone","UTC")
        assertEquals(doc,DomainDocument.parse(doc.canonical))
    }
    @Test fun consumingFreshTreesRetainsNoMutableJsonAlias(){
        val original=DomainEngine.initial("Asia/Shanghai");val fresh=original.json()
        val consumed=DomainDocument.fromOwnedJson(fresh);assertEquals(original,consumed)
        fresh.put("schemaVersion",999);fresh.getJSONArray("projects").put("changed")
        assertEquals(original,consumed);assertEquals(15,consumed.json().getInt("schemaVersion"))
    }
    @Test fun largeViewsReadExactFieldSpansAndBlueprintHeadersWithoutKeepingHistoryCopies(){
        val root=DomainEngine.initial().json()
        val seed="海🎈\"\\".repeat(60000)
        root.getJSONObject("worldSettings").put("worldSeed",seed)
        val blueprint=org.json.JSONObject().put("schemaVersion",1).put("id","large-view").put("title","玻璃窗")
            .put("bounds",org.json.JSONObject().put("minX",0).put("maxX",0).put("minY",0).put("maxY",0).put("minZ",0).put("maxZ",0))
            .put("voxels",org.json.JSONArray().put(org.json.JSONObject().put("x",0).put("y",0).put("z",0).put("materialId","stone").put("stage","foundation").put("buildOrder",0)))
        root.getJSONArray("buildingBlueprintResources").put(org.json.JSONObject().put("id","large-view").put("displayName","玻璃窗")
            .put("blueprint",blueprint).put("importedAt","2026-01-01T00:00:00.000Z"))
        val doc=DomainDocument.fromOwnedJson(root)
        assertTrue(doc.canonical.length>DomainDocument.SNAPSHOT_CHARACTERS)
        val view=doc.projectionJson()
        assertEquals(seed,view.getJSONObject("worldSettings").getString("worldSeed"))
        val header=view.getJSONArray("buildingBlueprintResources").getJSONObject(0).getJSONObject("blueprint")
        assertEquals(1,header.getInt("voxelCount"));assertFalse(header.has("voxels"))
        assertEquals(StrictJson.render(blueprint),doc.blueprintCanonical("buildingBlueprintResources","large-view"))
        assertEquals(DomainEngine.initial().focusControlJson().toString(),doc.focusControlJson().toString())
        view.getJSONObject("worldSettings").put("worldSeed","changed")
        header.getJSONObject("bounds").put("maxX",20)
        assertEquals(seed,doc.projectionJson().getJSONObject("worldSettings").getString("worldSeed"))
        assertEquals(doc,DomainDocument.parse(doc.canonical))
    }
}
