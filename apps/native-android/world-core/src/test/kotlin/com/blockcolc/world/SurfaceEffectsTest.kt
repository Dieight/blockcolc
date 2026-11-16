package com.blockcolc.world

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SurfaceEffectsTest {
    @Test fun valleyCascadeAndFloatingSkyUseTheirActualCapturedPrograms(){
        val rows=JSONObject(javaClass.getResource("/reviewed-environment-programs.json")!!.readText()).getJSONArray("programs")
        for(i in 0 until rows.length()){
            val row=rows.getJSONObject(i);val definition=row.getJSONObject("definition");val uniforms=row.getJSONObject("uniforms")
            val result=ReviewedSurfacePrograms.resolve(definition,uniforms)
            assertTrue(result.pending.isEmpty())
            if(i==0){assertNotNull(result.optics.cascade);assertEquals(0f,result.optics.cascade!!.elapsed,0f)}
            else{assertTrue(result.optics.sky);assertTrue(result.optics.floatingSky)
                assertTrue(definition.getString("fragment").contains("outgoingLight += bcFloatingNightSky(vBcSkyDirection);"))}
            for(field in listOf("cacheKey","vertex","fragment","type")){
                val bad=JSONObject(definition.toString()).put(field,definition.getString(field)+" changed")
                assertEquals(listOf("unreviewed-program"),ReviewedSurfacePrograms.resolve(bad,uniforms).pending)
            }
        }
    }
    @Test fun cascadeClockCannotSilentlyCoerceOrAcceptInvalidValues(){
        for(value in listOf(-.1,1e10,"0.5"))assertThrows(IllegalArgumentException::class.java){
            SourceCascade.read(JSONObject().put("uCascadeClock",value))}
    }
    @Test fun capturedSkyAndMoonRequireTheExactReviewedIdentity() {
        val examples=JSONObject(javaClass.getResource("/reviewed-sky-programs.json")!!.readText()).getJSONArray("programs")
        for(i in 0 until examples.length()) {
            val row=examples.getJSONObject(i);val definition=row.getJSONObject("definition");val uniforms=row.getJSONObject("uniforms")
            val result=ReviewedSurfacePrograms.resolve(definition,uniforms)
            assertTrue(result.pending.isEmpty());assertEquals(1,result.applied.size)
            if(i==0){assertTrue(result.optics.sky);assertFalse(result.optics.floatingSky)}else {
                assertNotNull(result.optics.moon)
                assertEquals(listOf("source-moon-sprite-v1"),result.applied)
                // Actual Sprite shader has no color_fragment anchor: phase
                // uniforms alone must not enable an invented phase mask.
                assertFalse(definition.getString("fragment").contains("moonRadiusSq"))
            }
            for(field in listOf("cacheKey","vertex","fragment","type")) {
                val bad=JSONObject(definition.toString()).put(field,definition.getString(field)+" changed")
                assertEquals(listOf("unreviewed-program"),ReviewedSurfacePrograms.resolve(bad,uniforms).pending)
            }
        }
    }
    private fun fixture() = JSONObject(javaClass.getResource("/reviewed-program.json")!!.readText())
    @Test fun reviewedFaceAndNightOperationsUseExactProgramIdentity() {
        val f = fixture(); val result = ReviewedSurfacePrograms.resolve(f.getJSONObject("definition"), f.getJSONObject("uniforms"))
        assertEquals(listOf("night-sky-reflection-v6","face-and-edge-v1"), result.applied)
        assertTrue(result.pending.isEmpty());assertEquals(1f,result.optics.night.gain,0f)
        assertEquals(.25f, result.effects.strength, 1e-6f)
    }
    @Test fun changedShaderDefinesTypeOrCacheKeyCannotUseTheOldAdapter() {
        for (field in listOf("vertex", "fragment", "cacheKey", "type", "defines")) {
            val f = fixture(); val definition = f.getJSONObject("definition")
            if (field == "defines") definition.getJSONObject(field).put("UNREVIEWED", 1)
            else definition.put(field, definition.getString(field) + "\n// changed")
            val result = ReviewedSurfacePrograms.resolve(definition, f.getJSONObject("uniforms"))
            assertTrue(result.applied.isEmpty()); assertEquals(listOf("unreviewed-program"), result.pending)
            assertEquals(SurfaceEffects.NONE, result.effects)
        }
    }
    @Test fun noCustomProgramLeavesTheBaseMaterialUnchanged() {
        val result = ReviewedSurfacePrograms.resolve(null, null)
        assertTrue(result.applied.isEmpty()); assertTrue(result.pending.isEmpty())
        assertEquals(listOf(1f, 1f, 1f), result.effects.multiplier(listOf(.5f,.5f,.5f), listOf(0f,1f,0f)))
    }
    @Test fun invalidLiveUniformsFailInsteadOfBeingClampedOrCoerced() {
        val bad = listOf("blockcolcEffectStrength" to 1.1, "blockcolcEffectEdgeStrength" to .36,
            "blockcolcEffectStrength" to "0.25", "blockcolcEffectLightDirection" to JSONArray("[0,0,0]"),
            "blockcolcEffectLightTint" to JSONArray("[1,1]"), "blockcolcEffectShadowTint" to JSONArray("[-1,0,0]"))
        for ((key, value) in bad) {
            val f = fixture(); f.getJSONObject("uniforms").put(key, value)
            assertThrows(IllegalArgumentException::class.java) {
                ReviewedSurfacePrograms.resolve(f.getJSONObject("definition"), f.getJSONObject("uniforms"))
            }
        }
    }
    @Test fun shaderBoundaryAndStrengthVectorsMatchTheNumericOracle() {
        val cases = JSONArray(javaClass.getResource("/surface-cases.json")!!.readText())
        assertEquals(441, cases.length())
        fun vector(value: JSONArray) = (0..2).map { value.getDouble(it).toFloat() }
        for (index in 0 until cases.length()) {
            val item = cases.getJSONObject(index)
            val result = SurfaceEffects.read(item.getJSONObject("uniforms")).multiplier(
                vector(item.getJSONArray("position")), vector(item.getJSONArray("normal")))
            for (channel in 0..2) assertEquals("case $index channel $channel",
                item.getJSONArray("expected").getDouble(channel), result[channel].toDouble(), 2e-6)
        }
    }
}
