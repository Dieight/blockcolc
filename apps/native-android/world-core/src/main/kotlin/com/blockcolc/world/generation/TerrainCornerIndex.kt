package com.blockcolc.world.generation

import kotlin.math.max
import kotlin.math.min

/** Insertion-ordered corner heights and side coverage used only while sealing
 * a terrain mesh. Primitive arrays replace coordinate keys, boxed heights,
 * per-corner lists and span objects. Coordinates are already source-rounded. */
internal class TerrainCornerIndex {
    private var xs=DoubleArray(256);private var zs=DoubleArray(256)
    private var lows=DoubleArray(256);private var highs=DoubleArray(256)
    private var heads=IntArray(256){-1};private var tails=IntArray(256){-1}
    private var slots=IntArray(512)
    private var bottoms=DoubleArray(256);private var tops=DoubleArray(256);private var next=IntArray(256)
    private var spans=0
    private var alongX=IntArray(0);private var alongZ=IntArray(0)
    var size=0;private set
    val storageBytes:Long get()=xs.size*40L+slots.size*4L+bottoms.size*20L+(alongX.size+alongZ.size)*4L
    fun x(i:Int)=xs[i]
    fun z(i:Int)=zs[i]
    fun high(i:Int)=highs[i]
    private fun twice(value:Int):Int{require(value<=Int.MAX_VALUE/2);return value*2}
    private fun bits(v:Double)=if(v==0.0)0L else v.toBits()
    private fun hash(x:Double,z:Double):Int {
        var h=bits(x)*-7046029254386353131L xor(bits(z)*-4658895280553007687L)
        h=(h xor(h ushr 30))*-4658895280553007687L;h=h xor(h ushr 31)
        return(h xor(h ushr 32)).toInt()
    }
    private fun slot(x:Double,z:Double):Int {
        var at=hash(x,z)and(slots.size-1)
        while(slots[at]!=0){val i=slots[at]-1;if(xs[i]==x&&zs[i]==z)break;at=(at+1)and(slots.size-1)}
        return at
    }
    fun addHeight(x:Double,z:Double,y:Double){
        var at=slot(x,z);val old=slots[at]-1
        if(old>=0){lows[old]=min(lows[old],y);highs[old]=max(highs[old],y);return}
        if(size==xs.size){
            val capacity=twice(size)
            xs=xs.copyOf(capacity);zs=zs.copyOf(capacity);lows=lows.copyOf(capacity);highs=highs.copyOf(capacity)
            heads=heads.copyOf(capacity).also{it.fill(-1,size,capacity)};tails=tails.copyOf(capacity).also{it.fill(-1,size,capacity)}
        }
        if((size+1)*2>=slots.size){
            slots=IntArray(twice(slots.size))
            for(i in 0 until size)slots[slot(xs[i],zs[i])]=i+1
            at=slot(x,z)
        }
        xs[size]=if(x==0.0)0.0 else x;zs[size]=if(z==0.0)0.0 else z;lows[size]=y;highs[size]=y;slots[at]=++size
    }
    fun prepareLines(){alongX=IntArray(size){it};alongZ=IntArray(size){it};sort(alongX,true);sort(alongZ,false)}
    // In-place heapsort avoids boxing every point just to sort two line views.
    private fun sort(order:IntArray,xMajor:Boolean){
        fun compare(a:Int,b:Int):Int {
            val first=if(xMajor)xs[a].compareTo(xs[b])else zs[a].compareTo(zs[b])
            return if(first!=0)first else if(xMajor)zs[a].compareTo(zs[b])else xs[a].compareTo(xs[b])
        }
        fun sift(start:Int,end:Int){
            var root=start
            while(root<end/2){var child=root*2+1;if(child+1<end&&compare(order[child],order[child+1])<0)child++
                if(compare(order[root],order[child])>=0)return
                val swap=order[root];order[root]=order[child];order[child]=swap;root=child}
        }
        for(i in order.size/2-1 downTo 0)sift(i,order.size)
        for(end in order.lastIndex downTo 1){val swap=order[0];order[0]=order[end];order[end]=swap;sift(0,end)}
    }
    private fun span(point:Int,bottom:Double,top:Double){
        val covered=lows[point]
        val high=highs[point]
        // Fold connected coverage into the endpoint immediately. Only
        // disconnected spans can contribute additional coverage at close.
        if(covered>=high-.011||top<=covered||bottom>high)return
        if(bottom<=covered+.011){lows[point]=min(high,top);return}
        if(spans==bottoms.size){val capacity=twice(spans);bottoms=bottoms.copyOf(capacity);tops=tops.copyOf(capacity);next=next.copyOf(capacity)}
        bottoms[spans]=bottom;tops[spans]=top;next[spans]= -1
        if(heads[point]<0)heads[point]=spans else next[tails[point]]=spans
        tails[point]=spans++
    }
    fun spanAt(x:Double,z:Double,bottom:Double,top:Double){val point=slots[slot(x,z)]-1;if(point>=0)span(point,bottom,top)}
    fun spansAlong(xMajor:Boolean,fixed:Double,low:Double,high:Double,bottom:Double,top:Double){
        val order=if(xMajor)alongX else alongZ
        var left=0;var right=order.size
        while(left<right){val mid=(left+right)ushr 1;val i=order[mid]
            val primary=if(xMajor)xs[i]else zs[i];val secondary=if(xMajor)zs[i]else xs[i]
            if(primary<fixed||primary==fixed&&secondary<low)left=mid+1 else right=mid}
        var at=left
        while(at<order.size){val i=order[at++];val primary=if(xMajor)xs[i]else zs[i];val secondary=if(xMajor)zs[i]else xs[i]
            if(primary!=fixed||secondary>high)break;span(i,bottom,top)}
    }
    /** Null means the existing side spans already close this corner. */
    fun uncoveredStart(point:Int):Double? {
        val high=highs[point];var cursor=lows[point];if(high==cursor)return null
        while(true){var candidate=cursor;var at=heads[point]
            while(at>=0){if(bottoms[at]<=cursor+.011)candidate=max(candidate,tops[at]);at=next[at]}
            if(candidate>=high-.011)return null
            if(candidate<=cursor)return cursor
            cursor=candidate
        }
    }
}
