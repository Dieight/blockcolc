package com.blockcolc.domain

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class StateOracleTest {
    private fun oracle() = JSONObject(javaClass.getResource("/state-oracle.json")!!.readText())
    @Test fun completeStateAndLegacyMigrationsMatchFormalParser() {
        val cases = oracle().getJSONArray("cases")
        val errors = ArrayList<String>()
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i); val name = c.getString("name")
            val result = runCatching { DomainDocument.fromJson(c.getJSONObject("input")) }
            if (c.getBoolean("ok") != result.isSuccess) errors.add("$name: acceptance mismatch: ${result.exceptionOrNull()}")
            else if (result.isSuccess && c.getString("canonical") != result.getOrThrow().canonical) errors.add("$name: complete normalized output differs")
            else if (result.isFailure && result.exceptionOrNull() !is StateInputException) errors.add("$name: failed outside validation: ${result.exceptionOrNull()}")
        }
        assertTrue(errors.take(30).joinToString("\n"), errors.isEmpty())
    }
    @Test fun offlineHolidayDatesMatchFormalDomain() {
        val cases = oracle().getJSONArray("holidayDates")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            assertEquals(c.toString(), c.getString("date"), HolidayDates.date(c.getString("id"), c.getInt("year")).toString())
        }
    }
    @Test fun exposedJsonCannotMutateValidatedState() {
        val state = DomainDocument.fromJson(oracle().getJSONObject("states").getJSONObject("notes"))
        val expected = state.canonical; state.json().getJSONArray("quickNotes").getJSONObject(0).put("text", "changed")
        assertEquals(expected, state.canonical); assertNotEquals("changed", state.json().getJSONArray("quickNotes").getJSONObject(0).getString("text"))
    }
    @Test fun focusControlsRetainSchedulingFactsWithoutExposingMutableBlueprints(){
        for(name in listOf("empty","notes","active","decay")){
            val doc=DomainDocument.fromJson(oracle().getJSONObject("states").getJSONObject(name));val full=doc.json();val controls=doc.focusControlJson()
            for(key in listOf("activeProjectId","activeFocusSession","focusHistory","progressReports"))
                assertEquals(name+key,StrictJson.render(full.get(key)),StrictJson.render(controls.get(key)))
            for(section in listOf("projects","habitBuildings")){
                val rows=controls.getJSONArray(section);val source=full.getJSONArray(section);assertEquals(source.length(),rows.length())
                for(i in 0 until rows.length()){
                    val expected=source.getJSONObject(i);expected.remove("importedBlueprint")
                    assertEquals(StrictJson.render(expected),StrictJson.render(rows.getJSONObject(i)))
                    rows.getJSONObject(i).put("title","changed")
                }
            }
            val active=doc.activeFocusSession();assertEquals(doc.json().optJSONObject("activeFocusSession")?.let(StrictJson::render),active?.let(StrictJson::render))
            active?.put("id","changed")
            assertEquals(doc.canonical,StrictJson.render(doc.json()))
            assertNotEquals("changed",doc.activeFocusSession()?.optString("id"))
        }
    }
    @Test fun strictWireRejectsAmbiguousJsonAndInvalidUtf8() {
        for (wire in listOf("{\"a\":1,\"a\":2}", "[1,]", "01", "1e999", "\"\\ud800\"", "{\"a\":NaN}", "{} trailing")) {
            assertTrue(wire, runCatching { StrictJson.parse(wire) }.exceptionOrNull() is StateInputException)
        }
        assertTrue(runCatching { StrictJson.decode(byteArrayOf(0xc0.toByte(), 0xaf.toByte())) }.exceptionOrNull() is StateInputException)
        assertTrue(runCatching { StrictJson.parse("[0,1,2]", 4) }.exceptionOrNull() is StateInputException)
        assertEquals(100 * 1024 * 1024, StrictJson.FILE_LIMIT); assertEquals(512 * 1024 * 1024, StrictJson.EXPANDED_LIMIT)
    }
    @Test fun birthdayPreflightCannotExposeOrMutateBuildingFacts(){
        val doc=DomainDocument.fromJson(oracle().getJSONObject("states").getJSONObject("notes"))
        val expected=doc.canonical;val controls=doc.birthdayObservationJson()
        assertEquals(setOf("birthday","birthdayRewards","calendar"),controls.keys().asSequence().toSet())
        for(key in controls.keys())assertEquals(StrictJson.render(doc.json().get(key)),StrictJson.render(controls.get(key)))
        controls.getJSONObject("birthday").put("enabled",true)
        controls.getJSONObject("calendar").put("timeZone","Pacific/Honolulu")
        controls.getJSONArray("birthdayRewards").put(JSONObject().put("year",2026))
        assertEquals(expected,doc.canonical)
        assertEquals(StrictJson.render(doc.json().getJSONObject("birthday")),StrictJson.render(doc.birthdayObservationJson().getJSONObject("birthday")))
        assertEquals(0,doc.birthdayObservationJson().getJSONArray("birthdayRewards").length())
    }
    @Test fun projectionHeadersAndScopedBlueprintSlicesKeepTheCompleteWireAndOwnership(){
        val cases=oracle().getJSONArray("cases");var embedded=0
        val fields=mapOf("projects" to "importedBlueprint","habitBuildings" to "importedBlueprint",
            "buildingBlueprintResources" to "blueprint","decorationBlueprintResources" to "blueprint")
        for(index in 0 until cases.length()){
            val row=cases.getJSONObject(index);if(!row.getBoolean("ok"))continue
            val doc=DomainDocument.fromJson(row.getJSONObject("input"));val full=doc.json();val headers=doc.projectionJson()
            var hasBody=false
            for((section,slot) in fields){
                val entries=full.getJSONArray(section);val projected=headers.getJSONArray(section)
                assertEquals(entries.length(),projected.length())
                for(i in 0 until entries.length()){
                    val item=entries.getJSONObject(i);val id=item.getString("id");val header=projected.getJSONObject(i)
                    if(item.isNull(slot)){assertNull(doc.blueprintCanonical(section,id));assertTrue(header.isNull(slot));continue}
                    hasBody=true;embedded++
                    val body=item.getJSONObject(slot);val metadata=header.getJSONObject(slot);val wire=doc.blueprintCanonical(section,id)
                    assertEquals(StrictJson.render(body),wire)
                    assertEquals(setOf("id","title","bounds","voxelCount"),metadata.keys().asSequence().toSet())
                    assertEquals(body.getJSONArray("voxels").length(),metadata.getInt("voxelCount"))
                    assertEquals(StrictJson.render(body.getJSONObject("bounds")),StrictJson.render(metadata.getJSONObject("bounds")))
                    metadata.getJSONObject("bounds").put("minX",-123)
                    assertEquals(wire,doc.blueprintCanonical(section,id))
                    assertEquals(StrictJson.render(body.getJSONObject("bounds")),StrictJson.render(doc.projectionJson().getJSONArray(section).getJSONObject(i).getJSONObject(slot).getJSONObject("bounds")))
                }
            }
            assertEquals(doc.canonical,StrictJson.render(doc.json()))
            if(hasBody)assertThrows(StateInputException::class.java){DomainDocument.fromJson(doc.projectionJson())}
            assertNull(doc.blueprintCanonical("projects","not-a-stored-owner"))
        }
        assertTrue("The source corpus must exercise embedded blueprint bodies",embedded>0)
    }
    @Test fun ecmascriptCanonicalNumbersAndUnicode() {
        assertEquals("{\"a\":0.3,\"big\":1e+30,\"emoji\":\"😀\",\"tiny\":1e-7,\"zero\":0}", StrictJson.render(StrictJson.parse("{\"zero\":-0,\"tiny\":0.0000001,\"big\":1e30,\"emoji\":\"😀\",\"a\":0.30}")))
        assertEquals(4, StrictJson.utf8Size("😀").toInt())
    }
    @Test fun numericScannerPreservesBinary64AndRejectsNonJsonJavaNumbers() {
        val numbers=listOf("-0","0","1.0","-1e-300","4.9e-324","1.7976931348623157e308","9007199254740993","1e-9999","999999999999999","-99999999999999","-128","512","513")+
            List(1000){i->"${i-500}.${(i*7919)%10000}e${i%41-20}"}
        for(wire in numbers){
            val expected=java.lang.Double.parseDouble(wire)
            val actual=StrictJson.parse(wire) as Double
            assertEquals(wire,java.lang.Double.doubleToRawLongBits(expected),java.lang.Double.doubleToRawLongBits(actual))
        }
        for(wire in listOf("+1",".1","1.","0x1.0p0","1f","01","-01","NaN","Infinity","1e+","1e9999"))
            assertTrue(wire,runCatching{StrictJson.parse(wire)}.exceptionOrNull() is StateInputException)
        for(wire in listOf("{\"a\":null,\"a\":1}","{\"a\":1,\"\\u0061\":2}"))
            assertTrue(wire,runCatching{StrictJson.parse(wire)}.exceptionOrNull() is StateInputException)
    }
    @Test fun plainAndEscapedStringsRemainExactAfterTheBoundedSymbolPoolFills(){
        val values=org.json.JSONArray()
        repeat(1200){i->values.put("key-$i");values.put("重复😀");values.put("Aa");values.put("BB")}
        values.put("quote\"slash\\newline\n");values.put("x".repeat(10000))
        assertEquals(StrictJson.render(values),StrictJson.render(StrictJson.parse(StrictJson.render(values))))
        assertEquals("😀",StrictJson.parse("\"\\ud83d\\ude00\""))
        for(wire in listOf("\"unterminated","\"raw\nline\"","\"\\uD800\"","{\"a\":null,\"\\u0061\":0}"))
            assertTrue(wire,runCatching{StrictJson.parse(wire)}.exceptionOrNull() is StateInputException)
    }
    @Test fun wireBudgetDoesNotInheritOldEightMiBLimit() {
        val size = 10 * 1024 * 1024
        val value = StrictJson.parse("\"" + "a".repeat(size) + "\"")
        assertEquals(size, (value as String).length)
        assertTrue(runCatching { StrictJson.parse("\"汉字\"", 5) }.exceptionOrNull() is StateInputException)
        assertTrue(runCatching { StrictJson.parse("[".repeat(98) + "0" + "]".repeat(98)) }.exceptionOrNull() is StateInputException)
    }
}
