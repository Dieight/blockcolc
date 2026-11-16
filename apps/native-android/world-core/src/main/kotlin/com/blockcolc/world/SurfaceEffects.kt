package com.blockcolc.world

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import kotlin.math.*

/** These values multiply the *lit result*, including specular and emissive.
 * Source local coordinates must be captured before instance transforms. */
data class SurfaceEffects(val direction: List<Float>, val lightTint: List<Float>,
                          val shadowTint: List<Float>, val strength: Float, val edgeStrength: Float) {
    fun multiplier(position: List<Float>, normal: List<Float>): List<Float> {
        require(position.size == 3 && normal.size == 3 && (position + normal).all { it.isFinite() })
        val length = sqrt(normal.sumOf { it.toDouble() * it })
        require(length > 1e-8)
        fun smooth(a: Double, b: Double, v: Double): Double {
            val t = ((v - a) / (b - a)).coerceIn(0.0, 1.0)
            return t * t * (3.0 - 2.0 * t)
        }
        val facing = smooth(-.45, .75, normal.indices.sumOf { normal[it] / length * direction[it] })
        val brightness = .84 + .21 * facing
        val axis = position.map { abs(it.toDouble()) }.sorted()
        val edge = 1.0 - smooth(.39, .475, axis[1]) * edgeStrength
        return (0..2).map { channel ->
            val tint = shadowTint[channel] * (1.0 - facing) + lightTint[channel] * facing
            ((1.0 + (tint * brightness - 1.0) * strength) * edge).toFloat()
        }
    }
    companion object {
        val NONE = SurfaceEffects(listOf(0f, 1f, 0f), List(3) { 1f }, List(3) { 1f }, 0f, 0f)
        fun read(uniforms: JSONObject): SurfaceEffects {
            fun number(name: String, min: Double, max: Double): Float {
                val raw = uniforms.get(name)
                require(raw is Number) { "Non-numeric surface uniform: $name" }
                val value = raw.toDouble()
                require(value.isFinite() && value in min..max) { "Invalid surface uniform: $name" }
                return value.toFloat()
            }
            fun vector(name: String, min: Double, max: Double): List<Float> {
                val value = uniforms.getJSONArray(name); require(value.length() == 3)
                return (0..2).map { index ->
                    val item = value.get(index); require(item is Number)
                    val number = item.toDouble(); require(number.isFinite() && number in min..max)
                    number.toFloat()
                }
            }
            val direction = vector("blockcolcEffectLightDirection", -1.0, 1.0)
            require(abs(direction.sumOf { it.toDouble() * it } - 1.0) < .001) { "Non-unit source effect direction" }
            return SurfaceEffects(direction, vector("blockcolcEffectLightTint", 0.0, 1.0),
                vector("blockcolcEffectShadowTint", 0.0, 1.0),
                number("blockcolcEffectStrength", 0.0, 1.0), number("blockcolcEffectEdgeStrength", 0.0, .35))
        }
    }
}

data class SurfaceCoverage(val effects: SurfaceEffects, val applied: List<String>, val pending: List<String>,
                           val optics:SurfaceOptics=SurfaceOptics.NONE)

/** An operation is never selected using a cache-key substring alone. Unknown
 * or changed shader text remains a gap even in diagnostic projection mode. */
object ReviewedSurfacePrograms {
    private val reviewed: JSONArray by lazy {
        val source = checkNotNull(javaClass.getResourceAsStream("/reviewed-surface-programs.json"))
            .bufferedReader().use { it.readText() }
        JSONObject(source).also { require(it.getInt("schema") == 1) }.getJSONArray("programs")
    }
    private fun sha(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 255) }
    private fun defines(value: JSONObject): Map<String, Any> = value.keys().asSequence().associateWith { value.get(it) }

    fun resolve(definition: JSONObject?, uniforms: JSONObject?): SurfaceCoverage {
        if (definition == null) return SurfaceCoverage(SurfaceEffects.NONE, emptyList(), emptyList())
        val vertex = sha(definition.getString("vertex")); val fragment = sha(definition.getString("fragment"))
        for (index in 0 until reviewed.length()) {
            val entry = reviewed.getJSONObject(index)
            if (entry.getString("type") != definition.getString("type") ||
                (if(entry.has("cacheKeySha256"))entry.getString("cacheKeySha256")!=sha(definition.getString("cacheKey"))
                    else entry.getString("cacheKey") != definition.getString("cacheKey")) ||
                entry.getString("vertexSha256") != vertex || entry.getString("fragmentSha256") != fragment ||
                defines(entry.getJSONObject("defines")) != defines(definition.getJSONObject("defines"))) continue
            val pending = entry.getJSONArray("pending").let { list -> (0 until list.length()).map { list.getString(it) } }
            val input=requireNotNull(uniforms)
            if(entry.optString("operation")=="cascade")return SurfaceCoverage(SurfaceEffects.NONE,listOf("source-valley-cascade-v1"),pending,
                SurfaceOptics(cascade=SourceCascade.read(input)))
            if(entry.optString("operation")=="precipitation")return SurfaceCoverage(SurfaceEffects.NONE,listOf("source-precipitation-v3"),pending,
                SurfaceOptics(precipitation=SourcePrecipitation.read(input,entry.getBoolean("snow"))))
            if(entry.optString("operation")=="cloud")return SurfaceCoverage(SurfaceEffects.NONE,listOf("cloud-advection-v1","source-lambert-v1"),pending,
                SurfaceOptics(cloud=SourceCloud.read(input)))
            // The captured Sprite shader has no <color_fragment> anchor. Its
            // producer's attempted phase injection is a no-op; preserve the
            // actual square Sprite rather than silently fixing production.
            if(entry.optString("operation")=="moon")return SurfaceCoverage(SurfaceEffects.NONE,listOf("source-moon-sprite-v1"),pending,
                SurfaceOptics(moon=MoonPhase.read(input)))
            if(entry.optString("operation")=="sky")return SurfaceCoverage(SurfaceEffects.NONE,listOf("night-sky-backdrop-v6"),pending,
                SurfaceOptics(night=NightField.read(input,false),sky=true,floatingSky=entry.optBoolean("floatingSky")))
            val hasNight=!entry.optBoolean("noNight",false)
            val applied=if(hasNight)mutableListOf("night-sky-reflection-v6")else mutableListOf()
            val effects=if(entry.getBoolean("faceEdges")){applied+="face-and-edge-v1";SurfaceEffects.read(input)}else SurfaceEffects.NONE
            val fluid=entry.optBoolean("fluidSurface",false)
            val distance=entry.optBoolean("distanceOpacity",false)
            if(fluid)applied+="fluid-surface-v1"
            if(distance)applied+="water-distance-opacity-v1"
            val clear=if(entry.optBoolean("weatherWater",false)){
                val raw=input.get("blockcolcWaterClearSky");require(raw is Number)
                val n=raw.toDouble();require(n.isFinite()&&n in 0.0..1.0)
                applied+="weather-water-v1";n.toFloat()
            }else null
            val atlas=if(entry.optBoolean("atlas",false)){applied+="source-atlas-prepared-v1";SourceAtlas.read(input,entry.getBoolean("atlasShape"))}else null
            return SurfaceCoverage(effects,applied,pending,SurfaceOptics(if(hasNight)NightField.read(input)else NightField.NONE,fluid,clear,distance,atlas=atlas))
        }
        return SurfaceCoverage(SurfaceEffects.NONE, emptyList(), listOf("unreviewed-program"))
    }
}
