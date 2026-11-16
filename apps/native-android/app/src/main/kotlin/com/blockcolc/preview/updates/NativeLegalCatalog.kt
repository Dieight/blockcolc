package com.blockcolc.preview.updates

data class NativeLegalEntry(val title:String,val asset:String,val upstream:String)

/** Complete bundled notices, also readable offline. The font derivatives keep
 * their individual notices rather than being relabelled as project Apache. */
object NativeLegalCatalog {
    val project=NativeLegalEntry("项目许可 · Apache-2.0","about-licenses/project-apache-2.0.txt","https://github.com/Dieight/blockcolc/blob/main/LICENSE")
    val entries=listOf(
        NativeLegalEntry("Kotlin / AndroidX Compose · Apache-2.0","about-licenses/kotlin-androidx.txt","https://developer.android.com/jetpack/androidx"),
        NativeLegalEntry("Filament 1.56.0 · Apache-2.0","about-licenses/filament-apache-2.0.txt","https://github.com/google/filament/tree/v1.56.0"),
        NativeLegalEntry("SunCalc · BSD-2-Clause","about-licenses/suncalc.txt","https://github.com/mourner/suncalc"),
        NativeLegalEntry("Three.js · MIT","about-licenses/three-mit.txt","https://github.com/mrdoob/three.js"),
        NativeLegalEntry("lunar-java · MIT","about-licenses/lunar-java-mit.txt","https://github.com/6tail/lunar-java"),
        NativeLegalEntry("JSON Canonicalization · Apache-2.0","about-licenses/json-canonicalization.txt","https://github.com/erdtman/java-json-canonicalization"),
        NativeLegalEntry("缝合像素 · OFL-1.1","licenses/fusion-pixel/OFL.txt","https://github.com/TakWolf/fusion-pixel-font"),
        NativeLegalEntry("Ark Pixel · OFL-1.1","licenses/fusion-pixel/LICENSES/ark-pixel/OFL.txt","https://github.com/TakWolf/ark-pixel-font"),
        NativeLegalEntry("Cubic 11 · OFL-1.1","licenses/fusion-pixel/LICENSES/cubic-11/OFL.txt","https://github.com/ACh-K/Cubic-11"),
        NativeLegalEntry("Galmuri · 许可","licenses/fusion-pixel/LICENSES/galmuri/LICENSE.txt","https://github.com/quiple/galmuri"),
        NativeLegalEntry("自然录音 · CC0","about-licenses/ambient-audio.txt","https://github.com/Dieight/blockcolc/blob/main/docs/assets/ambient-audio.md"),
    )
}
