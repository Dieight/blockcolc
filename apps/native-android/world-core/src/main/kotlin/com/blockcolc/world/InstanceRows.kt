package com.blockcolc.world

import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Six RGBA32F texels per instance: matrix, tint and packed surface data. */
fun WorldPackets.instanceRows(packet:DrawPacket):ByteBuffer {
    require(packets.getOrNull(packet.id)===packet){"Packet belongs to another source"}
    val result=ByteBuffer.allocateDirect(packet.count*96).order(ByteOrder.nativeOrder())
    val base=section(packet.instances).asFloatBuffer()
    val aux=packet.aux?.let{section(it).asFloatBuffer()}
    repeat(packet.count){repeat(20){result.putFloat(base.get())};repeat(4){result.putFloat(aux?.get()?:0f)}}
    result.flip();return result
}
