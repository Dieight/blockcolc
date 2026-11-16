package com.blockcolc.world

/** Dense membership uses one bit per voxel. Compilation visits indices in
 * ascending order, which is also this immutable set's iteration order. */
internal class NativeSourceIndexSet private constructor(private val words:LongArray,override val size:Int):AbstractSet<Int>() {
    override fun contains(element:Int)=element>=0&&element.toLong()<words.size*64L&&words[element ushr 6]and(1L shl(element and 63))!=0L
    override fun iterator():Iterator<Int> = object:Iterator<Int>{
        var word=0;var remaining=words.firstOrNull()?:0L
        override fun hasNext():Boolean {while(remaining==0L&&word+1<words.size){word++;remaining=words[word]};return remaining!=0L}
        override fun next():Int {if(!hasNext())throw NoSuchElementException();val bit=java.lang.Long.numberOfTrailingZeros(remaining);remaining=remaining and(remaining-1);return word*64+bit}
    }
    class Builder(private val bound:Int){
        init {require(bound>=0)}
        private val words=LongArray(((bound.toLong()+63)/64).toInt());private var count=0
        operator fun plusAssign(index:Int){require(index in 0 until bound);val slot=index ushr 6;val mask=1L shl(index and 63)
            if(words[slot]and mask==0L){words[slot]=words[slot]or mask;count++}}
        fun freeze()=NativeSourceIndexSet(words.copyOf(),count)
    }
}

object NativeSourceIndices {
    /** Short-lived read-only view over owner-confined sets; no second dense
     * collection just to add a few block-entity exclusions. */
    fun unionView(first:Set<Int>,second:Set<Int>):Set<Int> {
        if(second.isEmpty())return first
        if(first.isEmpty())return second
        return object:AbstractSet<Int>(){
            override val size:Int get()=first.size+second.count{it !in first}
            override fun contains(element:Int)=element in first||element in second
            override fun iterator():Iterator<Int> = sequence{yieldAll(first);for(value in second)if(value !in first)yield(value)}.iterator()
        }
    }
}
