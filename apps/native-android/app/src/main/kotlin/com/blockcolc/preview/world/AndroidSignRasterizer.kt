package com.blockcolc.preview.world

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Looper
import com.blockcolc.world.NativePixelTexture
import com.blockcolc.world.NativeSignRasterizer
import com.blockcolc.world.NativeStaticBlockEntities
import com.blockcolc.world.generation.SignFace
import java.nio.ByteBuffer

/** The source display uses a system-font canvas approximation. Rasterization
 * belongs to the generation worker, never a Composable, GPU thread or DB writer.
 * Native fonts can differ in glyph metrics; no cross-platform pixel identity is
 * claimed. Opaque tiles are copied as explicit RGBA, independent of Bitmap byte order. */
class AndroidSignRasterizer:NativeSignRasterizer {
    override fun rasterize(face:SignFace):NativePixelTexture {
        check(Looper.myLooper()!=Looper.getMainLooper()){"Sign text must be prepared off the UI thread"}
        val image=Bitmap.createBitmap(128,64,Bitmap.Config.ARGB_8888)
        try {
            val canvas=Canvas(image);val paint=Paint(Paint.ANTI_ALIAS_FLAG)
            canvas.drawColor(Color.rgb(145,100,64))
            paint.color=Color.argb(43,54,33,22)
            repeat(5){i->val x=3f+(i%2)*7;val y=8f+i*12;canvas.drawRect(x,y,x+118,y+1,paint)}
            paint.style=Paint.Style.STROKE;paint.strokeWidth=2f;paint.color=Color.rgb(85,56,32);canvas.drawRect(1f,1f,127f,63f,paint)
            paint.strokeWidth=1f;paint.color=Color.argb(97,231,196,148);canvas.drawRect(4f,4f,124f,60f,paint)
            paint.typeface=Typeface.create("sans-serif",Typeface.BOLD);paint.textSize=12f;paint.textAlign=Paint.Align.CENTER
            paint.color=Color.BLACK or (NativeStaticBlockEntities.dyeColors[face.dyeColor]?:NativeStaticBlockEntities.dyeColors.getValue("black"))
            paint.strokeWidth=1.4f
            if(face.glowing)paint.setShadowLayer(5f,0f,0f,paint.color)
            val metrics=paint.fontMetrics;val middle=(metrics.ascent+metrics.descent)/2
            for((i,raw)in face.lines.take(4).withIndex()){
                val line=raw.filter{it.code !in 0..31&&it.code!=127};val width=paint.measureText(line);val scale=if(width>114)114/width else 1f
                val save=canvas.save();canvas.scale(scale,1f,64f,0f)
                if(face.glowing){paint.style=Paint.Style.STROKE;canvas.drawText(line,64f,10f+i*14-middle,paint)}
                paint.style=Paint.Style.FILL;canvas.drawText(line,64f,10f+i*14-middle,paint);canvas.restoreToCount(save)
            }
            val pixels=IntArray(128*64);image.getPixels(pixels,0,128,0,0,128,64)
            val rgba=ByteBuffer.allocate(pixels.size*4)
            for(color in pixels){rgba.put(Color.red(color).toByte());rgba.put(Color.green(color).toByte());rgba.put(Color.blue(color).toByte());rgba.put(255.toByte())}
            rgba.flip()
            return NativePixelTexture(128,64,rgba,srgb=true,mipmaps=false,wrapS=1001,wrapT=1001,minFilter=1006,magFilter=1006,anisotropy=1f)
        }finally{image.recycle()}
    }
}
