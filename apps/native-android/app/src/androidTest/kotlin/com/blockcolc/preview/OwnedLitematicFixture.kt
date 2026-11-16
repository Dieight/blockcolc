package com.blockcolc.preview

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.util.zip.GZIPOutputStream

/** Synthetic signed-axis document. No user's imported blueprint is packaged. */
internal fun ownedLitematicFixture():ByteArray {
    val output=ByteArrayOutputStream()
    DataOutputStream(GZIPOutputStream(output)).use{out->
        fun tag(type:Int,name:String){out.writeByte(type);out.writeUTF(name)}
        fun int(name:String,value:Int){tag(3,name);out.writeInt(value)}
        fun string(name:String,value:String){tag(8,name);out.writeUTF(value)}
        fun point(name:String,x:Int,y:Int,z:Int){tag(10,name);int("x",x);int("y",y);int("z",z);out.writeByte(0)}
        tag(10,"");int("Version",6);int("MinecraftDataVersion",4671)
        tag(10,"Metadata");string("Name","Owned reversed blueprint");string("Author","P3 fixture");out.writeByte(0)
        tag(10,"Regions");tag(10,"owned")
        point("Position",0,0,0);point("Size",-2,2,2)
        tag(9,"BlockStatePalette");out.writeByte(10);out.writeInt(3)
        for(block in listOf("minecraft:air","minecraft:stone","minecraft:glass")){string("Name",block);out.writeByte(0)}
        tag(12,"BlockStates");out.writeInt(1)
        val states=intArrayOf(1,2,1,1,2,1,1,2);var packed=0L
        states.forEachIndexed{i,state->packed=packed or(state.toLong() shl (i*2))};out.writeLong(packed)
        out.writeByte(0);out.writeByte(0);out.writeByte(0)
    }
    return output.toByteArray()
}
