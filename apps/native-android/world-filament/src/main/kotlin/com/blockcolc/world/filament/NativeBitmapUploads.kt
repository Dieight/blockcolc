package com.blockcolc.world.filament

import android.graphics.Bitmap
import java.nio.ByteBuffer

/** Android's pixel JNI requires a direct buffer or an accessible backing array.
 * Asset views are read-only heap buffers, so cross that boundary explicitly. */
object NativeBitmapUploads {
    fun rgba(width:Int,height:Int,input:ByteBuffer):Bitmap {
        require(width in 1..4096&&height in 1..4096&&input.remaining().toLong()==width.toLong()*height*4)
        val pixels=ByteBuffer.allocateDirect(input.remaining()).put(input.duplicate());pixels.flip()
        val bitmap=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888)
        try{bitmap.setPremultiplied(false);bitmap.copyPixelsFromBuffer(pixels);return bitmap}
        catch(error:Throwable){bitmap.recycle();throw error}
    }
}
