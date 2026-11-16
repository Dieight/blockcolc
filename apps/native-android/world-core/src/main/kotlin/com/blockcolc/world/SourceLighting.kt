package com.blockcolc.world

import org.json.JSONObject
import kotlin.math.*

data class SourceLight(val type: String, val color: List<Float>, val intensity: Float,
                       val direction: List<Float>, val position: List<Float>, val castShadow: Boolean,
                       val groundColor: List<Float>, val distance: Float, val shadowBiasWorld: Float)
data class SourceFog(val color:List<Float>,val near:Float,val far:Float) {
    fun factor(viewDepth:Float):Float {
        val t=((viewDepth-near)/(far-near)).coerceIn(0f,1f);return t*t*(3f-2f*t)
    }
}
data class SourceLighting(val exposure: Float, val clearColor: List<Float>, val lights: List<SourceLight>, val shadowsEnabled: Boolean,
                          val pending: List<String>,val fog:SourceFog?=null) {
    /** Filament's pre-scaled polynomial coefficients already include 1/pi.
     * Three's hemisphere is an irradiance linear in dot(normal, direction). */
    fun hemisphereCoefficients(): FloatArray {
        val result = FloatArray(12)
        for (light in lights.filter { it.type == "HemisphereLight" }) for (channel in 0..2) {
            val a = (light.color[channel] + light.groundColor[channel]) * .5 * light.intensity / PI
            val b = (light.color[channel] - light.groundColor[channel]) * .5 * light.intensity / PI
            result[channel] += a.toFloat()
            result[3 + channel] += (b * light.direction[1]).toFloat()
            result[6 + channel] += (b * light.direction[2]).toFloat()
            result[9 + channel] += (b * light.direction[0]).toFloat()
        }
        return result
    }
    companion object {
        fun read(value: JSONObject): SourceLighting {
            require(value.getInt("schema") == 1 && value.getString("colorSpace") == "linear-srgb")
            require(value.getString("outputColorSpace") == "srgb" && value.getInt("toneMapping") == 4) {
                "Unreviewed source color pipeline"
            }
            require(value.getJSONArray("gaps").length() == 0) { "Unported source lighting model" }
            fun number(parent: JSONObject, name: String, min: Double, max: Double): Float {
                val raw = parent.get(name); require(raw is Number)
                val number = raw.toDouble(); require(number.isFinite() && number in min..max)
                return number.toFloat()
            }
            fun vector(parent: JSONObject, name: String, min: Double, max: Double): List<Float> {
                val array = parent.getJSONArray(name); require(array.length() == 3)
                return (0..2).map { index ->
                    val raw = array.get(index); require(raw is Number)
                    val number = raw.toDouble(); require(number.isFinite() && number in min..max)
                    number.toFloat()
                }
            }
            fun flag(parent: JSONObject, name: String): Boolean {
                val raw = parent.get(name); require(raw is Boolean); return raw
            }
            val rawLights = value.getJSONArray("lights"); require(rawLights.length() in 1..32)
            val lights = (0 until rawLights.length()).mapNotNull { index ->
                val item = rawLights.getJSONObject(index)
                require(item.getString("type") in setOf("DirectionalLight", "HemisphereLight", "PointLight"))
                val visible = flag(item, "visible")
                val intensity = number(item, "intensity", 0.0, 10000.0)
                val color = vector(item, "color", 0.0, 1.0)
                val position = vector(item, "position", -1e6, 1e6)
                val type = item.getString("type")
                val direction = if (type != "PointLight") vector(item, "direction", -1.0, 1.0) else listOf(0f,0f,0f)
                if (type != "PointLight") require(abs(direction.sumOf { it.toDouble() * it } - 1.0) < .001)
                val ground = if (type == "HemisphereLight") vector(item, "groundColor", 0.0, 1.0) else List(3) { 0f }
                val distance = if (type == "PointLight") number(item, "distance", 0.0, 1e6) else 0f
                if (type == "PointLight") require(number(item, "decay", 0.0, 10.0) == 2f) { "Unported point falloff" }
                val shadows = if (type == "HemisphereLight") false else flag(item, "castShadow")
                val biasWorld = if (shadows && type == "DirectionalLight") {
                    val shadow = item.getJSONObject("shadow")
                    orthographicShadowBiasWorld(number(shadow,"bias",-1.0,0.0),
                        number(shadow,"near",.001,1e6),number(shadow,"far",.001,1e6))
                } else 0f
                if (!visible || intensity == 0f) null else SourceLight(type,color,intensity,direction,position,shadows,ground,distance,biasWorld)
            }
            require(lights.count { it.type == "DirectionalLight" } <= 1) { "Filament supports one dominant directional light" }
            require(number(value,"clearAlpha",0.0,1.0)==1f) { "Transparent source background is unported" }
            val fog=if(value.isNull("fog"))null else value.getJSONObject("fog").let{f->
                require(f.getString("type")=="linear"){"Unreviewed source fog"}
                val near=number(f,"near",0.0,1e6);val far=number(f,"far",0.0,1e6);require(far>near)
                SourceFog(vector(f,"color",0.0,1.0),near,far)
            }
            return SourceLighting(number(value,"exposure", .01, 100.0), vector(value,"clearColor",0.0,1.0), lights,
                flag(value.getJSONObject("shadow"),"enabled"),
                listOf("source-shadow-filter"),fog)
        }
        /** Three offsets normalized light depth; Filament offsets world units.
         * Copying the small normalized value (or its unrelated 1mm default)
         * produces self-shadow bands in worlds hundreds of blocks across. */
        fun orthographicShadowBiasWorld(bias: Float, near: Float, far: Float): Float {
            require(bias.isFinite() && bias in -1f..0f && near.isFinite() && near > 0f && far.isFinite() && far > near)
            return -bias * (far-near)
        }
    }
}
