package com.blockcolc.domain

/** Opt-in, actor-local stage observations. No document, command or SQL values.
 * Disabled callers take the original path; observations never authorize work. */
object PipelineCost {
    private val observer = ThreadLocal<((String, Long, Long, Boolean) -> Unit)?>()
    fun <T> collect(sink: ((String, Long, Long, Boolean) -> Unit)?, work: () -> T): T {
        check(observer.get() == null) { "Nested pipeline measurements" }
        observer.set(sink)
        try { return work() } finally { observer.remove() }
    }
    fun <T> section(name: String, work: () -> T): T {
        val sink = observer.get() ?: return work()
        val start = System.nanoTime(); var ok = false
        try { return work().also { ok = true } }
        finally { sink(name, start, System.nanoTime(), ok) }
    }
}
