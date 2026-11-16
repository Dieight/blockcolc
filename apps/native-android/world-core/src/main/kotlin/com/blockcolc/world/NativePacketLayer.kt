package com.blockcolc.world

enum class NativePacketLayer(val wire:String){STATIC("static"),CLOUDS("clouds"),PRECIPITATION("precipitation"),SKY("sky"),LIGHTNING("lightning"),ANIMALS("animals")}

object PacketOwners {
    const val INTERIOR="interior:study"
    const val CLOUDS="atmosphere:clouds"
    const val PRECIPITATION="atmosphere:precipitation"
    const val SKY="atmosphere:sky"
    const val LIGHTNING="atmosphere:lightning"
    const val ANIMALS="wildlife:animals"
    fun valid(owner:String)=owner.length in 1..256&&(owner=="world"||replaceable(owner))
    fun replaceable(owner:String)=owner.startsWith("building:")||owner.startsWith("reward:")||owner==CLOUDS||owner==PRECIPITATION||owner==SKY||owner==LIGHTNING||owner==ANIMALS||owner==INTERIOR
}
