package com.blockcolc.world.filament

import android.os.Handler
import android.os.Looper
import com.blockcolc.world.AnimalRig
import com.google.android.filament.Engine
import com.google.android.filament.Texture
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Bounded staging shared by small animated rigs. The driver completion,
 * rather than a guessed frame delay, returns each of the three buffers. */
internal class InstanceRowUploads(private val count:Int) {
    private val handler=Handler(checkNotNull(Looper.myLooper()))
    private val free=ArrayDeque<ByteBuffer>().apply{repeat(3){add(ByteBuffer.allocateDirect(count*96).order(ByteOrder.nativeOrder()))}}
    private var closed=false
    var uploads=0;private set
    val available get()=!closed&&free.isNotEmpty()
    fun upload(engine:Engine,texture:Texture,write:(ByteBuffer)->Unit){
        check(available);val data=free.removeFirst();data.clear()
        try{write(data);check(data.position()==count*96);data.flip()}catch(error:Throwable){free.addFirst(data);throw error}
        val descriptor=Texture.PixelBufferDescriptor(data,Texture.Format.RGBA,Texture.Type.FLOAT)
        descriptor.setCallback(handler,Runnable{if(!closed){data.clear();free.addLast(data)}})
        try{texture.setImage(engine,0,descriptor);uploads++}catch(error:Throwable){if(!closed)free.addFirst(data);throw error}
    }
    fun upload(engine:Engine,texture:Texture,rig:AnimalRig,kind:Int,slots:IntArray)=upload(engine,texture){rig.copySlots(kind,slots,it)}
    fun close(){closed=true;free.clear()}
}
