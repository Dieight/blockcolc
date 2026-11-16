package com.blockcolc.world.filament

/** Render-thread transaction. Preparation cannot touch visible bindings;
 * publication retains old targets until the enclosing scene update succeeds. */
class RenderTargetState<C:Any,T:Any>(private val create:(C)->T,private val bind:(T?)->Unit,private val dispose:(T)->Unit) {
    var current:T?=null;private set
    private var pending:Change?=null
    private var closed=false
    fun prepare(configuration:C):Change {
        check(!closed&&pending==null)
        return Change(create(configuration),current).also{pending=it}
    }
    inner class Change internal constructor(private val next:T,private val previous:T?) {
        private var state=0 // prepared, published, finished
        fun commit(){
            check(!closed&&pending===this&&state==0)
            try{bind(next)}catch(error:Throwable){
                try{bind(previous)}catch(rollback:Throwable){
                    current=next;state=1;error.addSuppressed(rollback);throw error
                }
                pending=null;state=2
                try{dispose(next)}catch(cleanup:Throwable){error.addSuppressed(cleanup)}
                throw error
            }
            current=next;state=1
        }
        fun rollback(){
            check(!closed&&pending===this&&state==1)
            // Failed rollback must not destroy a still-bound target. Keeping
            // the ticket allows close() to detach and retire both generations.
            bind(previous);current=previous;pending=null;state=2;dispose(next)
        }
        fun finish():Int {
            check(!closed&&pending===this&&state==1)
            pending=null;state=2
            return if(previous==null)0 else try{dispose(previous);0}catch(_:Throwable){1}
        }
        fun discard(){
            if(state==2)return
            if(state==1){rollback();return}
            check(!closed&&pending===this);pending=null;state=2;dispose(next)
        }
        internal fun retained():List<T> = if(state==2)emptyList()else listOfNotNull(next,previous)
    }
    fun close():Int {
        if(closed)return 0
        val all=(pending?.retained().orEmpty()+listOfNotNull(current)).fold(mutableListOf<T>()){values,item->values.apply{if(none{it===item})add(item)}}
        closed=true;pending=null;current=null
        var failures=0
        try{bind(null)}catch(_:Throwable){failures++}
        for(item in all.asReversed())try{dispose(item)}catch(_:Throwable){failures++}
        return failures
    }
}
