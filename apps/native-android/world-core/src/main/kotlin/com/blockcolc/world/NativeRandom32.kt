package com.blockcolc.world

/** The formal renderer's unsigned 32-bit LCG. Keep the integer state so a
 * worker or a GPU descriptor can resume without rounding a random fraction. */
class NativeRandom32(seed:Long,zeroToOne:Boolean=true) {
    private var bits=if(seed==0L&&zeroToOne)1 else seed.toInt()
    val state:Long get()=bits.toLong()and 0xffffffffL
    fun next():Double {bits=bits*1_664_525+1_013_904_223;return state/4294967296.0}
}
