package com.blockcolc.domain

import java.security.MessageDigest
import java.util.Arrays

/** May overlap SHA with detached blueprint validation. The SHA can only be
 * attached to the fully validated canonical wire if every character matches. */
class CanonicalReadCandidate private constructor(private val wire:CanonicalWire,private val sha:String){
    internal fun exactSha(actual:CanonicalWire)=sha.takeIf{wire.sameAs(actual)}
    companion object {
        fun digest(parts:List<String>):CanonicalReadCandidate {
            // Per-segment UTF-8 must produce the same bytes as encoding the
            // full wire. Reject boundaries inside a supplementary code point.
            require(parts.all{it.isEmpty()||!it.first().isLowSurrogate()&&!it.last().isHighSurrogate()})
            return CanonicalWire(parts).let{CanonicalReadCandidate(it,it.sha256())}
        }
    }
}

/** Immutable canonical JSON. A storage checkpoint can retain the exact SQL
 * strings as segments and materialize the complete wire only when requested. */
internal class CanonicalWire(parts:List<String>) {
    private val chunks=parts.filter(String::isNotEmpty).toTypedArray()
    private val ends=IntArray(chunks.size)
    val length:Int

    init {
        var length=0
        for(index in chunks.indices){
            length=Math.addExact(length,chunks[index].length)
            ends[index]=length
        }
        this.length=length
    }

    constructor(text:String):this(listOf(text))

    val text:String get() = if(chunks.size==1)chunks[0] else StringBuilder(length).also{out->chunks.forEach{out.append(it)}}.toString()

    private fun index(at:Int):Int {
        check(at in 0 until length)
        val position=Arrays.binarySearch(ends,at+1)
        return if(position>=0)position else -position-1
    }

    private fun start(index:Int)=if(index==0)0 else ends[index-1]

    operator fun get(at:Int):Char {
        val part=index(at)
        return chunks[part][at-start(part)]
    }

    private fun pieces(from:Int,to:Int):Sequence<String> = sequence {
        require(from in 0..to&&to<=length)
        if(from==to)return@sequence
        var part=index(from)
        var offset=from
        while(offset<to){
            val end=minOf(to,ends[part])
            val beginning=start(part)
            yield(if(offset==beginning&&end==ends[part])chunks[part]else chunks[part].substring(offset-beginning,end-beginning))
            offset=end
            part++
        }
    }

    fun substring(from:Int,to:Int):String {
        if(from==to)return ""
        val part=index(from)
        if(from==start(part)&&to==ends[part])return chunks[part]
        if(to<=ends[part])return chunks[part].substring(from-start(part),to-start(part))
        return pieces(from,to).joinToString("")
    }

    fun matches(from:Int,value:String):Boolean {
        if(from<0||from>length-value.length)return false
        if(value.isEmpty())return true
        var part=index(from)
        var at=from
        var compared=0
        while(compared<value.length){
            val count=minOf(ends[part]-at,value.length-compared)
            if(compared==0&&count==value.length&&at==start(part)&&chunks[part]===value)return true
            if(!chunks[part].regionMatches(at-start(part),value,compared,count))return false
            at+=count
            compared+=count
            part++
        }
        return true
    }

    fun sameAs(other:CanonicalWire):Boolean {
        if(this===other)return true
        if(length!=other.length)return false
        if(chunks.size==1&&other.chunks.size==1)return chunks[0]==other.chunks[0]
        var at=0
        for(part in other.chunks){
            if(!matches(at,part))return false
            at+=part.length
        }
        return true
    }

    fun replace(from:Int,to:Int,value:String):CanonicalWire {
        if(chunks.size==1)return CanonicalWire(StringBuilder(length-(to-from)+value.length)
            .append(chunks[0],0,from).append(value).append(chunks[0],to,length).toString())
        return CanonicalWire(pieces(0,from).toList()+value+pieces(to,length).toList())
    }

    // Segments are split only at complete JSON tokens, outside quoted text.
    fun sha256():String {
        if(chunks.size==1)return StrictJson.sha(chunks[0])
        return PipelineCost.section("json.sha"){
            val sha=MessageDigest.getInstance("SHA-256")
            for(part in chunks)sha.update(part.toByteArray(Charsets.UTF_8))
            DigestHex.encode(sha.digest())
        }
    }
}
