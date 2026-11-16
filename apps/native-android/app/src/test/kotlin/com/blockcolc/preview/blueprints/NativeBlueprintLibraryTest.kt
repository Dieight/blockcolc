package com.blockcolc.preview.blueprints

import com.blockcolc.domain.*
import com.blockcolc.world.generation.BuiltinBlueprintCatalog
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeBlueprintLibraryTest {
    @Test fun completeLibraryHidesUnacquiredRewardsAndChangesOnlyFromCommittedFacts(){
        val catalog=BuiltinBlueprintCatalog.load();var state=DomainEngine.initial("UTC")
        val before=NativeBlueprintLibrary.from(state,catalog)
        assertEquals(20,before.items.count{it.category=="holiday"&&it.locked&&it.displayName=="???"&&it.canonical==null})
        assertTrue(before.items.single{it.category=="birthday"}.locked)
        assertEquals(catalog.entries.count{it.category=="daily"},before.items.count{it.category=="daily"})
        assertEquals(catalog.entries.count{it.category in setOf("native","supplemental")},before.items.count{it.selectable})
        val now=DomainTime.millis("2026-10-01T12:00:00.000Z")
        fun commit(type:String,vararg values:Pair<String,Any?>){val result=DomainEngine.execute(state,DomainEngine.command(type,*values),now);assertTrue("$type: ${result.error}",result.ok);state=result.state}
        commit("ConfigureBirthday","enabled" to true,"month" to 10,"day" to 1)
        commit("ObserveBirthday")
        commit("CreateProject","projectId" to "p","title" to "P","blueprintId" to "builtin-small-workshop","subtasks" to JSONArray().put(JSONObject().put("id","t").put("title","T")))
        commit("StartFocus","sessionId" to "focus","subtaskId" to "t","plannedDurationMs" to 1)
        val completed=DomainEngine.execute(state,DomainEngine.command("CompleteFocus"),now+1);assertTrue(completed.ok);state=completed.state
        val after=NativeBlueprintLibrary.from(state,catalog)
        assertFalse(after.items.single{it.category=="birthday"}.locked)
        assertTrue(after.items.filter{it.category=="holiday"&&!it.locked}.isNotEmpty())
        for(item in after.items.filter{it.category=="holiday"&&!it.locked})assertEquals(catalog.find(item.id)!!.displayName,item.displayName)
        assertTrue(before.items.filter{it.category=="holiday"}.all{it.locked})
    }
    @Test fun importedNamesRemainUserTextAndSupplementalSnapshotsRemainIndependent(){
        val catalog=BuiltinBlueprintCatalog.load();val entry=catalog.entries.first{it.category=="supplemental"}
        val source=NativeBlueprintLibrary.importedSnapshot(catalog.content(entry.id).json())
        var state=DomainEngine.initial()
        val bp=JSONObject(source.toString()).put("id","user-test").put("title","不翻译 User 名称")
        val imported=DomainEngine.execute(state,DomainEngine.command("ImportBuildingBlueprint","blueprint" to bp),0);assertTrue(imported.ok);state=imported.state
        val renamed=DomainEngine.execute(state,DomainEngine.command("RenameBuildingBlueprint","blueprintId" to "user-test","displayName" to "手写中文 Custom"),0);assertTrue(renamed.ok)
        val item=NativeBlueprintLibrary.from(renamed.state,catalog).items.single{it.id=="user-test"}
        assertFalse(item.localized);assertEquals("手写中文 Custom",item.displayName);assertTrue(item.selectable)
        val restored=DomainDocument.parse(renamed.state.canonical)
        assertEquals(item,NativeBlueprintLibrary.from(restored,catalog).items.single{it.id==item.id})
        assertFalse(item.content!!.materialized)
        assertFalse(catalog.content(entry.id).json().getJSONArray("voxels").getJSONObject(0).has("stage"))
        assertTrue(JSONObject(item.previewCanonical()!!).getJSONArray("voxels").getJSONObject(0).has("stage"))
        assertTrue(item.content.materialized)
    }
}
