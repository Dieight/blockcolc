package com.blockcolc.world

/** Bounded synthetic fixtures only; never a path into user data. */
object WorldFixtures {
    val names=setOf("ocean","coast","valley","floating")
    fun requireName(name:String):String=name.also{require(it in names){"Unknown P1 world fixture"}}
    fun requireStem(stem:String):String=stem.also{
        requireName(if(it.endsWith("-update"))it.removeSuffix("-update")else it)
    }
}
