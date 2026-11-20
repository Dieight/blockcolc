package com.blockcolc.world.generation

internal data class ChairPart(
    val x: Double, val y: Double, val z: Double,
    val width: Double, val height: Double, val depth: Double,
    val colour: Int, val pattern: OriginalPattern,
)

/** Original furniture in local block units, facing negative Z. */
internal object OriginalChairs {
    private const val oak = 0x805439
    private const val endGrain = 0x604333
    private const val green = 0x6e8455
    private const val orange = 0xb66d40
    private const val orangeDeep = 0x995839

    val reading = buildList {
        fun timber(x: Double, y: Double, z: Double, w: Double, h: Double, d: Double) =
            add(ChairPart(x, y, z, w, h, d, oak, OriginalPattern.PLANKS))

        for (x in listOf(-.37, .37)) {
            timber(x, .20, -.33, .12, .40, .12)
            timber(x, .63, .37, .12, 1.26, .12)
            timber(x, .20, .02, .09, .08, .66)
        }
        timber(0.0, .39, 0.0, .88, .12, .84)
        timber(0.0, 1.19, .37, .81, .13, .12)
        for (x in listOf(-.20, 0.0, .20)) timber(x, .91, .37, .09, .45, .085)
        add(ChairPart(0.0, .49, -.018, .79, .09, .72, green, OriginalPattern.FABRIC))
    }

    val upholstered = buildList {
        for (x in listOf(-.48, .48)) for (z in listOf(-.42, .42))
            add(ChairPart(x, .088, z, .13, .176, .14, endGrain, OriginalPattern.PLANKS))
        fun fabric(x: Double, y: Double, z: Double, w: Double, h: Double, d: Double, colour: Int = orange) =
            add(ChairPart(x, y, z, w, h, d, colour, OriginalPattern.FABRIC))

        fabric(0.0, .28, 0.0, 1.23, .28, 1.10, orangeDeep)
        fabric(0.0, .47, -.07, .88, .14, .89)
        fabric(0.0, .76, .39, 1.11, .69, .33, orangeDeep)
        fabric(0.0, .89, .195, .86, .60, .18)
        fabric(0.0, 1.15, .37, .95, .09, .29)
        for (x in listOf(-.535, .535)) {
            fabric(x, .51, -.03, .22, .22, 1.02, orangeDeep)
            fabric(x, .66, -.055, .25, .12, .98)
        }
    }
}
