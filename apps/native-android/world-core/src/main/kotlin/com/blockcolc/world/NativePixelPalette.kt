package com.blockcolc.world

import kotlin.math.abs

/** Local and location-based skies both supply the same sun direction here. */
data class NativePixelPalette(val tint: LinearRgb, val fill: LinearRgb, val sky: NativeSkyGradient, val lamps: Float) {
    companion object {
        private val day = NativeSkyGradient(ink(0x659cc4), ink(0xb3d1dc), ink(0x92afb5))
        private val dusk = NativeSkyGradient(ink(0x53618e), ink(0xe69a81), ink(0x9a7584))
        private val night = NativeSkyGradient(ink(0x131e39), ink(0x294660), ink(0x18263d))

        fun from(sky: NativeSkyState, surface: NativeSurfaceState, storm: Boolean): NativePixelPalette {
            val dark = surface.nightFactor
            val warm = (1f - abs(sky.sunDirection.y.toFloat() - .02f) / .29f).coerceIn(0f, 1f)
            val cover = 1f - surface.clearSky
            val weatherBlend = if (storm) .82f else .22f + .42f * cover
            fun band(day: LinearRgb, dusk: LinearRgb, night: LinearRgb, weather: LinearRgb): LinearRgb =
                mix(mix(mix(day, dusk, warm), night, dark), weather, weatherBlend)
            val colors = NativeSkyGradient(
                band(day.zenith, dusk.zenith, night.zenith, sky.gradient.zenith),
                band(day.horizon, dusk.horizon, night.horizon, sky.gradient.horizon),
                band(day.lower, dusk.lower, night.lower, sky.gradient.lower),
            )
            val light = mix(mix(LinearRgb(1f, .98f, .90f), LinearRgb(1f, .79f, .63f), warm),
                LinearRgb(.29f, .39f, .63f), dark)
            val weatherTint = if (storm) .73f else 1f - cover * .10f
            val fill = mix(LinearRgb(.004f, .008f, .013f), LinearRgb(.014f, .026f, .055f), dark)
            return NativePixelPalette(LinearRgb(light.red * weatherTint, light.green * weatherTint, light.blue * weatherTint),
                fill, colors, (.65f * dark + .13f * warm + if (storm) .1f else 0f).coerceIn(0f, 1f))
        }

        private fun ink(rgb: Int) = LinearRgb.fromSrgb(rgb)
        private fun mix(a: LinearRgb, b: LinearRgb, t: Float) = LinearRgb(
            a.red * (1f - t) + b.red * t,
            a.green * (1f - t) + b.green * t,
            a.blue * (1f - t) + b.blue * t,
        )
    }
}
