package com.blockcolc.world

enum class DepthComparison { NEVER, ALWAYS, LESS, LESS_EQUAL, EQUAL, GREATER_EQUAL, GREATER, NOT_EQUAL }

/** Three's exported rule uses near=0 / far=1. Filament's reverse-Z camera and
 * zero-cleared depth buffer use near=1 / far=0; raw enum names are not portable. */
fun reversedDepthComparison(source: Int): DepthComparison = when(source) {
    0 -> DepthComparison.NEVER
    1 -> DepthComparison.ALWAYS
    2 -> DepthComparison.GREATER
    3 -> DepthComparison.GREATER_EQUAL
    4 -> DepthComparison.EQUAL
    5 -> DepthComparison.LESS_EQUAL
    6 -> DepthComparison.LESS
    7 -> DepthComparison.NOT_EQUAL
    else -> throw IllegalArgumentException("Unknown source depth comparison")
}
