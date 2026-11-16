package com.blockcolc.world.filament

import android.os.Handler
import android.os.Looper
import com.google.android.filament.Engine
import com.google.android.filament.Texture
import java.nio.ByteBuffer

/** Fixed staging buffers; lookup bytes stay non-premultiplied RGBA. */
internal class AtlasByteUploads(size:Int){
    private val handler=Handler(checkNotNull(Looper.myLooper()))
    private val free=ArrayDeque<ByteBuffer>().apply{repeat(3){add(ByteBuffer.allocateDirect(size))}}
    private var closed=false
    val available get()=!closed&&free.isNotEmpty()
    fun upload(engine:Engine,texture:Texture,bytes:ByteArray){
        check(available);val b=free.removeFirst();b.clear();b.put(bytes);b.flip()
        val d=Texture.PixelBufferDescriptor(b,Texture.Format.RGBA,Texture.Type.UBYTE)
        d.setCallback(handler,Runnable{if(!closed){b.clear();free.addLast(b)}})
        try{texture.setImage(engine,0,d)}catch(error:Throwable){if(!closed)free.addFirst(b);throw error}
    }
    fun close(){closed=true;free.clear()}
}
