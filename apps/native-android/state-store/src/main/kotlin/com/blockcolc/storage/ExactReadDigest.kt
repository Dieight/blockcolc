package com.blockcolc.storage

import java.nio.Buffer
import java.nio.ByteBuffer

/** Length-delimited exact text, including invalid UTF-16 from external edits.
 * A bounded scratch buffer avoids retaining archive-sized proof copies. */
internal class ExactReadDigest {
    private val digest=java.security.MessageDigest.getInstance("SHA-256")
    private val buffer=ByteArray(8192)
    private val characters by lazy(LazyThreadSafetyMode.NONE){CharArray(buffer.size/2)}
    private val bigEndian by lazy(LazyThreadSafetyMode.NONE){ByteBuffer.wrap(buffer).asCharBuffer()}
    private var position=0

    fun text(value:String){
        val size=value.length
        if(position+4>buffer.size)flush()
        buffer[position++]=(size ushr 24).toByte()
        buffer[position++]=(size ushr 16).toByte()
        buffer[position++]=(size ushr 8).toByte()
        buffer[position++]=size.toByte()
        if(size<64){
            if(position+size*2>buffer.size)flush()
            for(c in value){buffer[position++]=(c.code ushr 8).toByte();buffer[position++]=c.code.toByte()}
            return
        }
        // Transfer raw code units in bulk. A charset encoder would replace or
        // reject unmatched surrogate halves and change the existing proof.
        val view=bigEndian
        val chars=characters
        var offset=0
        while(offset<size){
            if(position==buffer.size)flush()
            val count=minOf((buffer.size-position)/2,size-offset)
            value.toCharArray(chars,0,offset,offset+count)
            (view as Buffer).position(position/2)
            view.put(chars,0,count)
            position+=count*2
            offset+=count
        }
    }
    private fun flush(){if(position!=0){digest.update(buffer,0,position);position=0}}
    fun table(rows:List<List<Any?>>){
        text(rows.size.toString())
        for(row in rows){text(row.size.toString());for(cell in row){
            text(when(cell){null->"null";is String->"text";is Number->"number";else->error("Unknown stored value")})
            if(cell!=null)text(cell.toString())
        }}
    }
    fun finish():String {flush();return com.blockcolc.domain.DigestHex.encode(digest.digest())}
}
