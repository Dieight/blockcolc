package com.blockcolc.world.importing

import java.io.DataInputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.concurrent.CancellationException

data class NativeNbtLimits(val depth:Int=64,val tags:Int=1_000_000,val collectionLength:Int=2_097_152,
    val stringBytes:Int=65_535,val retainedBytes:Long=256L*1024*1024) {
    init {require(depth>0&&tags>0&&collectionLength>0&&stringBytes>0&&retainedBytes>0)}
}

/** One big-endian Java NBT document. Primitive arrays stay primitive, and
 * numeric tag kinds survive for the piston pose contract. No JavaScript engine,
 * reflection, class loading, or executable payload comes from an import. */
internal class NativeJavaNbt(input:InputStream,private val limits:NativeNbtLimits,private val cancelled:()->Boolean) {
    private val data=DataInputStream(input)
    private var tags=0
    private var retained=0L
    private val decoder=Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
    private fun check(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Blueprint import cancelled")}
    private fun charge(bytes:Long){require(bytes>=0&&retained<=limits.retainedBytes-bytes){"NBT retained collection budget exceeded"};retained+=bytes;check()}
    private fun tag(){require(++tags<=limits.tags){"NBT tag limit exceeded"};if(tags%128==0)check()}
    fun root():Map<String,Any> {
        check();require(data.readUnsignedByte()==10){"NBT root must be a compound"};tag();string()
        val result=compound(0);require(data.read()==-1){"Trailing bytes after NBT root"};check();return result
    }
    private fun string():String {
        val n=data.readUnsignedShort();require(n<=limits.stringBytes){"NBT string budget exceeded"};charge(n*3L+40)
        val bytes=ByteArray(n);data.readFully(bytes);return decoder.reset().decode(ByteBuffer.wrap(bytes)).toString()
    }
    private fun length(maximum:Int=limits.collectionLength):Int=data.readInt().also{require(it in 0..maximum){"NBT collection length exceeded"}}
    private fun compound(depth:Int):Map<String,Any> {
        charge(64);val values=linkedMapOf<String,Any>()
        while(true){val type=data.readUnsignedByte();if(type==0)return values
            require(type in 1..12);tag();val name=string();require(!values.containsKey(name)){"Duplicate NBT compound tag"}
            charge(64);values[name]=payload(type,depth+1)
        }
    }
    private fun payload(type:Int,depth:Int):Any {
        require(depth<=limits.depth){"NBT nesting depth exceeded"}
        return when(type){
            1->data.readByte();2->data.readShort();3->data.readInt();4->data.readLong();5->data.readFloat();6->data.readDouble()
            7->{val n=length();charge(n.toLong());ByteArray(n).also{data.readFully(it)}}
            8->string()
            9->{val item=data.readUnsignedByte();val n=length();require(item in 1..12||(item==0&&n==0));require(n<=limits.tags-tags)
                charge(n*8L+32);List(n){tag();payload(item,depth+1)}}
            10->compound(depth)
            11->{val n=length();charge(n*4L);IntArray(n){if(it%4096==0)check();data.readInt()}}
            12->{val n=length();charge(n*8L);LongArray(n){if(it%4096==0)check();data.readLong()}}
            else->error("Invalid NBT payload kind")
        }
    }
}
