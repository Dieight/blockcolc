package com.blockcolc.preview

import com.blockcolc.storage.SqlDatabase
import com.blockcolc.storage.SqlSession
import com.blockcolc.domain.PipelineCost
import org.json.JSONArray
import org.json.JSONObject

/** Debug-host observations only. No task contents or SQL arguments are retained.
 * A successful transaction return is an engine acknowledgement, not a claim
 * that SQLite and IndexedDB use identical fsync/durability policies. */
internal class P2OperationCost(private val clock: () -> Long = System::nanoTime) {
    private val marks = linkedMapOf<String, Long>()
    private val spans = arrayListOf<JSONObject>()
    private val transactions = arrayListOf<JSONObject>()
    fun now() = clock()
    fun mark(name: String) { check(name !in marks); marks[name] = now() }
    fun <T> section(name: String, work: () -> T): T {
        val begin = now(); var ok = false
        try { return work().also { ok = true } }
        finally { spans.add(JSONObject().put("name", name).put("beginNs", begin.toString()).put("endNs", now().toString()).put("ok", ok)) }
    }
    fun transaction(begin: Long, bodyEnd: Long, end: Long, writes: Int, queries: Int, queryNs: Long, executeNs: Long, facts: Boolean, ok: Boolean) {
        transactions.add(JSONObject().put("beginNs", begin.toString()).put("bodyEndNs", bodyEnd.toString()).put("endNs", end.toString())
            .put("writeCalls", writes).put("queryCalls", queries).put("queryNs", queryNs.toString()).put("executeNs", executeNs.toString()).put("facts", facts).put("ok", ok))
    }
    fun json() = JSONObject().put("schema", 2).put("backend", "native").put("marks", JSONObject(marks.mapValues { it.value.toString() }))
        .put("spans", JSONArray(spans)).put("transactions", JSONArray(transactions))
    companion object {
        private val current = ThreadLocal<P2OperationCost?>()
        fun active() = current.get()
        fun <T> collect(cost: P2OperationCost?, work: () -> T): T {
            check(current.get() == null) { "Nested operation measurements would mix actor boundaries" }
            current.set(cost)
            val sink: ((String, Long, Long, Boolean) -> Unit)? = cost?.let { value -> { name, begin, end, ok ->
                value.spans.add(JSONObject().put("name", "core/$name").put("beginNs", begin.toString()).put("endNs", end.toString()).put("ok", ok))
            } }
            try { return PipelineCost.collect(sink,work) } finally { current.remove() }
        }
        fun <T> section(name: String, work: () -> T): T {
            val cost=current.get();return if(cost==null)work() else cost.section(name,work)
        }
    }
}

/** Uses the real adapter and its commit; does not substitute an in-memory DB. */
internal class P2MeasuredDatabase(private val delegate: SqlDatabase): SqlDatabase {
    override fun <T> transaction(block: (SqlSession) -> T): T {
        val cost = P2OperationCost.active() ?: return delegate.transaction(block)
        val begin = cost.now(); var bodyEnd = begin; var writes = 0; var queries = 0
        var queryNs = 0L; var executeNs = 0L; var facts = false; var ok = false
        try {
            return delegate.transaction { sql ->
                val measured = object: SqlSession {
                    override fun execute(sqlText: String, args: List<Any?>): Int {
                        val at = cost.now(); writes++
                        if (sqlText.startsWith("UPDATE state_meta ")) facts = true
                        try { return sql.execute(sqlText, args) } finally { executeNs += cost.now() - at }
                    }
                    override fun query(sqlText: String, args: List<Any?>): List<List<Any?>> {
                        val at = cost.now(); queries++
                        try { return sql.query(sqlText, args) } finally { queryNs += cost.now() - at }
                    }
                    override fun largeTextRows(sqlText:String,args:List<Any?>):List<List<String>> {
                        val at=cost.now();queries++
                        try{return sql.largeTextRows(sqlText,args)}finally{queryNs+=cost.now()-at}
                    }
                    override fun largeText(sqlText:String,args:List<Any?>):String {
                        val at=cost.now();queries++
                        try{return sql.largeText(sqlText,args)}finally{queryNs+=cost.now()-at}
                    }
                    override fun blueprintBody(sha:String):String {
                        val at=cost.now();queries++
                        try{return sql.blueprintBody(sha)}finally{queryNs+=cost.now()-at}
                    }
                    override fun readStamp()=sql.readStamp()
                }
                try { block(measured) } finally { bodyEnd = cost.now() }
            }.also { ok = true }
        } finally { cost.transaction(begin, bodyEnd, cost.now(), writes, queries, queryNs, executeNs, facts, ok) }
    }
    override fun close() = delegate.close()
}
