package com.blockcolc.world.resource

import java.nio.ByteBuffer
import java.util.zip.CRC32
import java.util.zip.DataFormatException
import java.util.zip.Inflater
import kotlin.math.abs

data class ResourcePngDimensions(val width:Long,val height:Long)
data class ResourcePngLimits(val maxWidth:Int=4096,val maxHeight:Int=4096,val maxPixels:Int=1048576,val maxDecodedBytes:Int=4194304){
    init{require(listOf(maxWidth,maxHeight,maxPixels,maxDecodedBytes).all{it>0})}
}
class ResourcePngImage internal constructor(val width:Int,val height:Int,private val pixels:ByteArray){
    fun rgba():ByteBuffer=ByteBuffer.wrap(pixels).asReadOnlyBuffer()
}
/** Mirrors the existing bounded PNG decoder rather than platform colour
 * management. Scanlines are expanded one at a time; only two source rows and
 * the returned RGBA image are retained. */
object ResourcePng{
    private val signature=byteArrayOf(137.toByte(),80,78,71,13,10,26,10)
    private const val IHDR=0x49484452;private const val IDAT=0x49444154;private const val IEND=0x49454e44
    private const val PLTE=0x504c5445;private const val TRNS=0x74524e53
    private fun u32(bytes:ByteArray,at:Int):Long=(0..3).fold(0L){v,i->(v shl 8)or(bytes[at+i].toLong()and 255)}
    private fun u8(b:ByteArray,at:Int)=b[at].toInt()and 255
    private fun valid(ok:Boolean){require(ok){"Invalid or unsupported resource PNG"}}
    private data class Header(val width:Long,val height:Long,val depth:Int,val color:Int,val standard:Boolean,
        val paletteAt:Int,val paletteSize:Int,val alphaAt:Int,val alphaSize:Int,val idatBytes:Long)
    private fun header(bytes:ByteArray,cancelled:()->Boolean):Header{
        valid(bytes.size>=57&&signature.indices.all{signature[it]==bytes[it]});var at=8;var width=-1L;var height=-1L;var color=-1;var depth=-1;var standard=false
        var paletteAt=-1;var paletteSize=0;var alphaAt=-1;var alphaSize=0;var idatBytes=0L;var sawData=false;var ended=false
        while(at.toLong()+12<=bytes.size){checkpoint(cancelled);val len=u32(bytes,at);val end=at+12L+len;valid(end<=bytes.size)
            val size=len.toInt();val type=u32(bytes,at+4).toInt();val data=at+8
            val crc=CRC32();var copied=0;while(copied<size+4){checkpoint(cancelled);val n=minOf(65536,size+4-copied);crc.update(bytes,at+4+copied,n);copied+=n};valid(crc.value==u32(bytes,at+8+size))
            if(at==8){valid(type==IHDR&&size==13);width=u32(bytes,data);height=u32(bytes,data+4);depth=u8(bytes,data+8);color=u8(bytes,data+9)
                valid(width>0&&height>0&&depth in listOf(1,2,4,8,16)&&color in listOf(0,2,3,4,6));standard=u8(bytes,data+10)==0&&u8(bytes,data+11)==0&&u8(bytes,data+12)==0
            }else when(type){
                IHDR->valid(false)
                PLTE->{paletteAt=data;paletteSize=size}
                TRNS->{alphaAt=data;alphaSize=size}
                IDAT->{sawData=true;idatBytes+=size}
                IEND->{valid(size==0&&end==bytes.size.toLong());ended=true;break}
            };at=end.toInt()
        };valid(ended&&sawData&&width>0&&height>0);return Header(width,height,depth,color,standard,paletteAt,paletteSize,alphaAt,alphaSize,idatBytes)
    }
    fun inspect(bytes:ByteArray,cancelled:()->Boolean={false}):ResourcePngDimensions?=try{val h=header(bytes,cancelled);ResourcePngDimensions(h.width,h.height)}
        catch(e:java.util.concurrent.CancellationException){throw e}catch(_:IllegalArgumentException){null}
    fun decode(bytes:ByteArray,limits:ResourcePngLimits=ResourcePngLimits(),expectedWidth:Int?=null,expectedHeight:Int?=null,cancelled:()->Boolean={false}):ResourcePngImage{
        require(expectedWidth==null||expectedWidth>0);require(expectedHeight==null||expectedHeight>0)
        val h=header(bytes,cancelled);valid(h.standard&&h.width<=limits.maxWidth&&h.height<=limits.maxHeight)
        valid(expectedWidth==null||h.width==expectedWidth.toLong());valid(expectedHeight==null||h.height==expectedHeight.toLong())
        val pixels=h.width*h.height;valid(pixels<=limits.maxPixels&&pixels*4<=limits.maxDecodedBytes)
        val width=h.width.toInt();val height=h.height.toInt()
        val bits=when{
            h.color==6&&h.depth==8->32;h.color==4&&h.depth==8->16;h.color==2&&h.depth==8->24
            h.color==0&&h.depth in listOf(1,2,4,8)->h.depth
            h.color==3&&h.depth in listOf(1,2,4,8)&&h.paletteSize in 1..768&&h.paletteSize%3==0->h.depth
            else->throw IllegalArgumentException("Unsupported PNG colour/depth")
        }
        val rowBytes=(width*bits+7)/8;val bpp=maxOf(1,(bits+7)/8);valid((rowBytes+1L)*height<=limits.maxDecodedBytes.toLong()+height)
        val rgba=ByteArray((pixels*4).toInt());val row=ByteArray(rowBytes+1);val previous=ByteArray(rowBytes);val inflater=Inflater();var cursor=8
        fun feed(){if(!inflater.needsInput())return
            while(cursor+12<=bytes.size){val size=u32(bytes,cursor).toInt();val at=cursor;cursor+=size+12
                if(u32(bytes,at+4).toInt()==IDAT&&size>0){inflater.setInput(bytes,at+8,size);return}}
            valid(false)
        }
        fun inflate(out:ByteArray,offset:Int,count:Int):Int{
            checkpoint(cancelled);feed();val n=inflater.inflate(out,offset,count);valid(n>0||inflater.finished()||inflater.needsInput());return n
        }
        fun sample(x:Int):Int=if(h.depth==8)u8(row,x+1)else{val bit=x*h.depth;val shift=8-h.depth-(bit%8);(u8(row,bit/8+1)shr shift)and((1 shl h.depth)-1)}
        try{
            repeat(height){y->var written=0
                while(written<row.size){valid(!inflater.finished());written+=inflate(row,written,row.size-written)}
                val filter=u8(row,0);valid(filter<=4)
                for(x in 0 until rowBytes){val left=if(x>=bpp)u8(row,x+1-bpp)else 0;val up=if(y>0)u8(previous,x)else 0;val corner=if(y>0&&x>=bpp)u8(previous,x-bpp)else 0
                    val raw=u8(row,x+1);val predicted=when(filter){0->0;1->left;2->up;3->(left+up)/2;else->paeth(left,up,corner)};row[x+1]=(raw+predicted).toByte()}
                for(x in 0 until width){val at=(y*width+x)*4
                    when(h.color){
                        6->row.copyInto(rgba,at,x*4+1,x*4+5)
                        4->{val gray=row[x*2+1];rgba[at]=gray;rgba[at+1]=gray;rgba[at+2]=gray;rgba[at+3]=row[x*2+2]}
                        2->{val p=x*3+1;row.copyInto(rgba,at,p,p+3);rgba[at+3]=if(h.alphaSize==6&&u8(row,p)==u8(bytes,h.alphaAt+1)&&u8(row,p+1)==u8(bytes,h.alphaAt+3)&&u8(row,p+2)==u8(bytes,h.alphaAt+5))0 else 255.toByte()}
                        0->{val v=sample(x);val gray=(v*255/((1 shl h.depth)-1)).toByte();rgba[at]=gray;rgba[at+1]=gray;rgba[at+2]=gray
                            rgba[at+3]=if(h.alphaSize==2&&v==((u8(bytes,h.alphaAt)shl 8)or u8(bytes,h.alphaAt+1)))0 else 255.toByte()}
                        3->{val index=sample(x);valid(index*3+2<h.paletteSize);bytes.copyInto(rgba,at,h.paletteAt+index*3,h.paletteAt+index*3+3);rgba[at+3]=if(index<h.alphaSize)bytes[h.alphaAt+index]else 255.toByte()}
                    }
                };row.copyInto(previous,0,1,row.size)
            }
            val overflow=ByteArray(1);while(!inflater.finished())valid(inflate(overflow,0,1)==0)
            valid(inflater.bytesRead==h.idatBytes)
        }catch(e:DataFormatException){throw IllegalArgumentException("Invalid PNG zlib stream",e)}finally{inflater.end()}
        checkpoint(cancelled);return ResourcePngImage(width,height,rgba)
    }
    private fun paeth(left:Int,up:Int,corner:Int):Int{val p=left+up-corner;val a=abs(p-left);val b=abs(p-up);val c=abs(p-corner);return if(a<=b&&a<=c)left else if(b<=c)up else corner}
}
