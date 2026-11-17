package com.blockcolc.world

import java.util.concurrent.atomic.AtomicLong

data class OwnerToken(val generation: Long, val revision: Long)
data class OwnerUpdateResult(val accepted: Boolean, val retirementErrors: Int = 0)

/** Render-thread confined transaction. build owns every staged resource it
 * appends; publish must undo its scene attachments if it throws. Destruction
 * of retired resources is after publication, never a reason to replay a commit. */
class OwnerResources<T>(initial: Map<String, List<T>>, private val dispose: (T) -> Unit) {
    companion object { private val nextGeneration = AtomicLong(0) }
    private val generation = nextGeneration.getAndIncrement()
    private val live = initial.mapValues { it.value.toList() }.toMutableMap()
    private val versions = WorldRevision(initial.keys)
    private var busy = false
    private var closed = false
    fun token(owner: String): OwnerToken? = if (closed) null else versions.revision(owner)?.let { OwnerToken(generation, it) }
    fun snapshot(): Map<String, List<T>> = live.mapValues { it.value.toList() }

    fun replace(owner: String, expected: OwnerToken, build: (MutableList<T>) -> Unit,
                publish: (List<T>, List<T>) -> Unit): OwnerUpdateResult =
        replaceMany(mapOf(owner to expected),{_,staged->build(staged)},{old,next->publish(old.getValue(owner),next.getValue(owner))})

    fun replaceMany(expected:Map<String,OwnerToken>,build:(String,MutableList<T>)->Unit,
                    publish:(Map<String,List<T>>,Map<String,List<T>>)->Unit):OwnerUpdateResult {
        check(!busy) { "Reentrant world mutation" }
        val tickets=expected.toMap()
        require(tickets.isNotEmpty()&&tickets.size<=4096&&tickets.keys.all(PacketOwners::replaceable))
        if(tickets.any{token(it.key)!=it.value})return OwnerUpdateResult(false)
        val staged=tickets.keys.associateWith{mutableListOf<T>()}
        busy = true
        try {
            try { for((owner,items)in staged)build(owner,items);publish(tickets.keys.associateWith{live.getValue(it)},staged) }
            catch (error: Throwable) {
                for(resources in staged.values.toList().asReversed())for(resource in resources.asReversed())try{dispose(resource)}catch(cleanup:Throwable){error.addSuppressed(cleanup)}
                throw error
            }
            check(versions.replaceAll(versions.generation,tickets.mapValues{it.value.revision}))
            val previous=tickets.keys.map{live.put(it,staged.getValue(it).toList())!!}
            var errors = 0
            for(resources in previous.asReversed())for(resource in resources.asReversed())try{dispose(resource)}catch(_:Throwable){errors++}
            return OwnerUpdateResult(true, errors)
        } finally { busy = false }
    }

    fun close(): Int {
        check(!busy)
        if (closed) return 0
        closed = true
        var errors = 0
        for (resource in live.values.flatten().asReversed()) try { dispose(resource) } catch (_: Throwable) { errors++ }
        live.clear(); versions.rebuild(emptySet())
        return errors
    }
}

/** One pool per engine. A replacement can share the previous owner's assets
 * while staged, so retirement cannot destroy a still-live VBO or texture. */
class ResourcePool<K, V>(private val destroy: (V) -> Unit) {
    private data class Entry<V>(val value: V, var references: Int)
    private val entries = mutableMapOf<K, Entry<V>>()
    var created = 0; private set
    var destroyed = 0; private set
    fun acquire(key: K, create: () -> V): V {
        val existing = entries[key]
        if (existing != null) { existing.references++; return existing.value }
        return create().also { entries[key] = Entry(it, 1); created++ }
    }
    fun release(key: K) {
        val entry = entries[key] ?: error("Unowned resource release")
        check(entry.references > 0)
        entry.references--
        if (entry.references == 0) { entries.remove(key); destroyed++; destroy(entry.value) }
    }
    /** Borrow a live resource on the owning thread without changing its lifetime. */
    operator fun get(key: K): V? = entries[key]?.value
    fun snapshot(): Map<K, Pair<V, Int>> = entries.mapValues { it.value.value to it.value.references }
}
